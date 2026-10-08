// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/ProjectDetail.tsx (the header: tile, name, status) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: no tabs, no inline editing, no star, no plugin slots, no budget chip; the properties go
// to the shell's panel; members and the AI permission are ours; Turkish texts.
import type { MembershipSummary, ProjectDetail } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { ProjectMembers } from '@/components/projects/project-members';
import { ProjectProperties } from '@/components/projects/project-properties';
import { ProjectTile } from '@/components/projects/project-tile';
import { PageLabel } from '@/components/shell/page-label';
import { PropertiesPanel } from '@/components/shell/properties-panel';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { ApiError, userMessage } from '@/lib/api';
import { useWideWindow } from '@/lib/office/use-wide-window';
import { agentsSentence, UNAVAILABLE } from '@/lib/projects/labels';
import { projectQueryOptions } from '@/lib/projects/query';
import { useCompany } from '@/lib/session';

/**
 * One project (8 October 2026, decision 17): its name and status, whether agents may work in it,
 * its description and its members; the properties are in the shell's panel. Everything on the page
 * comes from one answer of the API, already cut to what the reader may read: a project the reader
 * cannot see is the same screen as one that does not exist.
 */
export const Route = createFileRoute('/_authed/c/$company/projects_/$projectId')({
  // The list the project belongs to. It is named as text until the menu has the row of the list.
  staticData: { location: { label: 'Proje', parent: 'Projeler' } },
  component: ProjectScreen,
});

function NotFound({ company }: { company: string }) {
  return (
    <section className="flex flex-col items-start gap-3">
      <h2 className="text-xl font-semibold">Proje bulunamadı</h2>
      <p className="text-sm text-ink-secondary">Bu proje yok ya da size açık değil.</p>
      <Button asChild variant="outline">
        <Link to="/c/$company/projects" params={{ company }}>
          Projelere dön
        </Link>
      </Button>
    </section>
  );
}

function ProjectScreen() {
  const company = useCompany();
  // No request is sent where the section is not offered: the API would refuse it.
  if (company.role === 'external') {
    return <EmptyState variant="page" {...UNAVAILABLE.external} />;
  }
  if (company.kind !== 'company') {
    return <EmptyState variant="page" {...UNAVAILABLE.privateSpace} />;
  }
  return <ProjectForCompany company={company} />;
}

function ProjectForCompany({ company }: { company: MembershipSummary }) {
  const { projectId } = Route.useParams();
  const valid = z.uuid().safeParse(projectId).success;
  const query = useQuery({ ...projectQueryOptions(company.companyId, projectId), enabled: valid });

  if (!valid || (query.error instanceof ApiError && query.error.status === 404)) {
    return <NotFound company={company.code} />;
  }
  if (query.isPending) return <LoadingRows rows={6} />;
  if (!query.data) {
    return (
      <ErrorMessage
        message={userMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return <ProjectPage project={query.data} />;
}

function ProjectPage({ project }: { project: ProjectDetail }) {
  // From 1280 px the panel shows beside the page without being asked for: the page is its
  // properties, and the status, the customer and the permission must not sit behind a button
  // nobody pressed yet. In a narrower window it follows the person's own choice (the toggle in the
  // top bar); the body alone always says the status and whether agents may work.
  const wide = useWideWindow();
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageLabel>{project.name}</PageLabel>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectTile color={project.color} icon={project.icon} size="md" />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="min-w-0 text-lg font-semibold break-words">{project.name}</h2>
            <StatusBadge kind="project" status={project.status} />
          </div>
        </div>
      </header>

      {/* Said once when it changes; the same words are on screen, never a color alone. */}
      <p role="status" className="text-sm">
        {agentsSentence(project)}
      </p>
      {project.closed ? (
        <p className="text-sm text-ink-secondary">
          Bu proje kapalı. Yeniden açmak için Projeyi düzenle ile durumunu Beklemede, Planlandı ya
          da Sürüyor yapın.
        </p>
      ) : null}

      <section className="flex flex-col gap-1">
        <h3 className="text-[0.9375rem] font-semibold">Açıklama</h3>
        {project.description ? (
          <p dir="auto" className="text-sm break-words whitespace-pre-wrap">
            {project.description}
          </p>
        ) : (
          <p className="text-sm text-ink-secondary">Açıklama yazılmamış.</p>
        )}
      </section>

      <ProjectMembers project={project} />

      <PropertiesPanel open={wide}>
        <ProjectProperties project={project} />
      </PropertiesPanel>
    </article>
  );
}
