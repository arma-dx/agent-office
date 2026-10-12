// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/ProjectDetail.tsx (the header: tile, name, status) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: tabs of our own (the requests of the project, its files, its GitHub repository, its
// milestones, its agent runs, its approvals, its settings) in the address; no inline editing, no
// star, no plugin slots; the
// budget is in the properties panel; the AI spending limit is in the "Çalışmalar" tab; the
// properties go to the shell's panel; members and the AI permission are ours; Turkish texts.
import type { MembershipSummary, ProjectDetail } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { EditProjectDialog } from '@/components/projects/edit-project-dialog';
import { ProjectApprovals } from '@/components/projects/project-approvals';
import { ProjectFiles } from '@/components/projects/project-files';
import { ProjectGithub } from '@/components/projects/project-github';
import { ProjectMembers } from '@/components/projects/project-members';
import { ProjectMilestones } from '@/components/projects/project-milestones';
import { ProjectProperties } from '@/components/projects/project-properties';
import { ProjectRequests } from '@/components/projects/project-requests';
import { ProjectRuns } from '@/components/projects/project-runs';
import { ProjectTile } from '@/components/projects/project-tile';
import { PageLabel } from '@/components/shell/page-label';
import { PropertiesPanel } from '@/components/shell/properties-panel';
import { InlineBanner } from '@/components/inline-banner';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status';
import { TabBar } from '@/components/tab-bar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ApiError, userMessage } from '@/lib/api';
import { useReturnFocus } from '@/lib/focus';
import { useWideWindow } from '@/lib/office/use-wide-window';
import { agentsSentence, LIMIT_REACHED, UNAVAILABLE } from '@/lib/projects/labels';
import { projectQueryOptions } from '@/lib/projects/query';
import { useCompany } from '@/lib/session';

/**
 * One project (8 October 2026, decision 17): its name and status and whether agents may work in
 * it, then its tabs. "Talepler" (shown first) lists the requests of the project and opens a new
 * one in it; "Dosyalar" holds the files people added to it (decision 20; the base tabs keep the
 * order decision 17 names them in); "GitHub" shows what GitHub lists of the repository the project
 * was given (decision 19; the third base tab of decision 17); "Kilometre taşları" keeps its
 * milestones; "Çalışmalar" lists its agent runs;
 * "Onaylar" lists the results of its requests as the unit's approver decided them; "Ayarlar"
 * holds its description and its members. The properties are in the shell's panel on all of them. The project comes from one
 * answer of the API, already cut to what the reader may read: a project the reader cannot see is
 * the same screen as one that does not exist.
 *
 * The tab is in the address: "Talepler" has no search parameter, so every link to a project opens
 * it; `?tab=files`, `?tab=github`, `?tab=milestones`, `?tab=runs`, `?tab=approvals` and
 * `?tab=settings` open the others and survive a reload.
 * A value the page does not know opens "Talepler".
 *
 * The notes of a project (decision 17 names them) come with the Notes work: until then the page
 * has no tab, no link and no empty section for them.
 */
const tabSchema = z.enum([
  'requests',
  'files',
  'github',
  'milestones',
  'runs',
  'approvals',
  'settings',
]);
const searchSchema = z.object({ tab: tabSchema.optional().catch(undefined) });

export const Route = createFileRoute('/_authed/c/$company/projects_/$projectId')({
  validateSearch: (search) => searchSchema.parse(search),
  // The list the project belongs to: the top bar links back to it, and a change of company opens
  // it there (a project of one company does not exist in the other).
  staticData: {
    location: { label: 'Proje', parent: { label: 'Projeler', to: '/c/$company/projects' } },
  },
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
  const [editing, setEditing] = useState(false);
  const editFocus = useReturnFocus();
  const { tab = 'requests' } = Route.useSearch();
  const navigate = Route.useNavigate();
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
        {project.actions.edit ? (
          <Button
            variant="outline"
            onClick={() => {
              editFocus.remember();
              setEditing(true);
            }}
          >
            Projeyi düzenle
          </Button>
        ) : null}
      </header>

      {/* Said once when it changes; the same words are on screen, never a color alone. */}
      <p role="status" className="text-sm">
        {agentsSentence(project)}
      </p>
      {/* The AI spending limit is reached (decision 17): said to every reader of the project,
          above every tab; who raises it is said in the reader's own voice. Never an amount. */}
      {project.spendingLimitReached ? (
        <InlineBanner tone="warning" compact>
          {LIMIT_REACHED[project.actions.setAiSpendingLimit ? 'founder' : 'others']}
        </InlineBanner>
      ) : null}
      {project.closed ? (
        <p className="text-sm text-ink-secondary">
          Bu proje kapalı. Yeniden açmak için Projeyi düzenle ile durumunu Beklemede, Planlandı ya
          da Sürüyor yapın.
        </p>
      ) : null}

      {/* The selected tab is marked by the accent line and by aria-selected, never by colour
          alone; changing the tab moves no focus and replaces the address, so that Back leaves the
          project instead of walking through its tabs. */}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = tabSchema.parse(value);
          void navigate({ search: next === 'requests' ? {} : { tab: next }, replace: true });
        }}
      >
        <TabBar
          label="Proje bölümleri"
          items={[
            { value: 'requests', label: 'Talepler' },
            { value: 'files', label: 'Dosyalar' },
            { value: 'github', label: 'GitHub' },
            { value: 'milestones', label: 'Kilometre taşları' },
            { value: 'runs', label: 'Çalışmalar' },
            { value: 'approvals', label: 'Onaylar' },
            { value: 'settings', label: 'Ayarlar' },
          ]}
        />
        <TabsContent value="requests">
          <ProjectRequests project={project} />
        </TabsContent>
        <TabsContent value="files">
          <ProjectFiles project={project} />
        </TabsContent>
        <TabsContent value="github">
          <ProjectGithub project={project} />
        </TabsContent>
        <TabsContent value="milestones">
          <ProjectMilestones project={project} />
        </TabsContent>
        <TabsContent value="runs">
          <ProjectRuns project={project} />
        </TabsContent>
        <TabsContent value="approvals">
          <ProjectApprovals project={project} />
        </TabsContent>
        <TabsContent value="settings" className="flex flex-col gap-5">
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
        </TabsContent>
      </Tabs>

      <PropertiesPanel open={wide}>
        <ProjectProperties project={project} />
      </PropertiesPanel>
      {/* Mounted only while open: every opening starts from the project as it is now. */}
      {editing ? (
        <EditProjectDialog
          project={project}
          onClose={() => {
            setEditing(false);
          }}
          onCloseAutoFocus={editFocus.onCloseAutoFocus}
        />
      ) : null}
    </article>
  );
}
