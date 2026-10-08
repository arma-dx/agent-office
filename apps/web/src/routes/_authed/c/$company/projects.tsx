// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/Projects.tsx (the list: sections with a count; a row of tile, name, target
// date and status; the empty state with the add button) at commit
// dd868ed125cd709506dd9b29fca640a44d580501. License text: THIRD_PARTY_NOTICES.md.
// Changes: our list row and status badge; the sections are open and closed projects instead of
// joined and left ones; no sorting menu, no star, no join and leave (membership decides who sees
// a project here); customer, member count and AI permission in the row; Turkish texts.
import type { MembershipSummary, ProjectSummary } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, linkOptions } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { ListRow } from '@/components/list-row';
import { NewProjectDialog } from '@/components/projects/new-project-dialog';
import { ProjectTile } from '@/components/projects/project-tile';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import {
  agentsWord,
  memberCountText,
  projectRowSentence,
  UNAVAILABLE,
} from '@/lib/projects/labels';
import { projectsQueryOptions } from '@/lib/projects/query';
import { useCompany } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * "Projeler" (8 October 2026, decisions 14 and 17): the projects of the selected company the
 * person may read. The founder reads all of them, an employee the ones they are a member of; the
 * API decides, the panel only shows the answer. Open projects first, closed ones after them.
 * Nothing in a row is a control: a project is changed on its page.
 */
export const Route = createFileRoute('/_authed/c/$company/projects')({
  staticData: { location: { label: 'Projeler' } },
  component: ProjectsScreen,
});

const byName = new Intl.Collator('tr');

function ProjectRow({ project, company }: { project: ProjectSummary; company: string }) {
  return (
    <ListRow
      // The tile is the project's identity and leads the row; its status is the badge at the end,
      // always with its word (a request row leads with its status icon instead).
      leading={<ProjectTile color={project.color} icon={project.icon} />}
      title={project.name}
      link={linkOptions({
        to: '/c/$company/projects/$projectId',
        params: { company, projectId: project.id },
        'aria-label': projectRowSentence(project),
      })}
      trailing={
        <>
          {/* Below 1280 px the customer and the member count give way to the name; both are on
              the project's page and in the row's sentence. A long customer name is cut here and
              has no title: the cell lies under the row's link, where a tooltip never shows. */}
          <span className="hidden w-40 truncate text-ink-secondary xl:block">
            {project.customer?.name ?? ''}
          </span>
          <span className="hidden w-14 text-ink-secondary tabular-nums xl:block">
            {memberCountText(project.memberCount)}
          </span>
          <span className={cn('w-36', !project.agentsMayWork && 'text-ink-secondary')}>
            {agentsWord(project.agentsMayWork)}
          </span>
          <span className="w-20 text-right text-xs text-ink-secondary tabular-nums">
            {project.targetDate ? (
              <time dateTime={project.targetDate}>{formatDay(project.targetDate)}</time>
            ) : null}
          </span>
          <span className="flex w-32 justify-end">
            <StatusBadge kind="project" status={project.status} />
          </span>
        </>
      }
    />
  );
}

function Group({
  title,
  projects,
  company,
  empty,
}: {
  title: string;
  projects: ProjectSummary[];
  company: string;
  /** What the group says when it has no project; without it an empty group is not shown. */
  empty?: string;
}) {
  const headingId = useId();
  if (projects.length === 0 && empty === undefined) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="px-2 text-sm font-semibold">
        {title}{' '}
        <span className="font-normal text-ink-secondary tabular-nums">{projects.length}</span>
      </h2>
      {projects.length === 0 ? (
        <p className="px-2 text-sm text-ink-secondary">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} company={company} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectsScreen() {
  const company = useCompany();
  // No request is sent where the section is not offered: the API would refuse it.
  if (company.role === 'external') {
    return <EmptyState variant="page" {...UNAVAILABLE.external} />;
  }
  if (company.kind !== 'company') {
    return <EmptyState variant="page" {...UNAVAILABLE.privateSpace} />;
  }
  return <ProjectList company={company} />;
}

function ProjectList({ company }: { company: MembershipSummary }) {
  const list = useQuery(projectsQueryOptions(company.companyId));
  const [creating, setCreating] = useState(false);
  // The dialog is opened from state: the button that opened it takes the focus back.
  const focus = useReturnFocus();

  const newProject = (
    <Button
      size="lg"
      onClick={() => {
        focus.remember();
        setCreating(true);
      }}
    >
      Yeni proje
    </Button>
  );
  // Mounted only while open: every opening starts with an empty form and new ids.
  const dialog = creating ? (
    <NewProjectDialog
      onClose={() => {
        setCreating(false);
      }}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    />
  ) : null;

  const sorted = (list.data?.projects ?? []).toSorted(
    (a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id),
  );
  const open = sorted.filter((project) => !project.closed);
  const closed = sorted.filter((project) => project.closed);

  if (list.isSuccess && sorted.length === 0) {
    // The first step, in the words of who reads it: the founder sees every project of the
    // company, an employee the ones they are a member of. The button stands in the empty state;
    // the bar's own is not shown beside it.
    return (
      <>
        <EmptyState
          variant="page"
          {...(company.role === 'founder'
            ? {
                title: 'Henüz proje yok',
                description:
                  'İlk projeyi Yeni proje düğmesiyle açın. Bir projeyi ve ona bağlı kayıtları yalnızca üyeleri ve kurucu görür.',
              }
            : {
                title: 'Üyesi olduğunuz proje yok',
                description:
                  'Yeni proje düğmesiyle bir proje açabilirsiniz; açtığınız projenin üyesi olursunuz. Var olan bir projeye sizi o projenin bir üyesi ya da kurucu ekler.',
              })}
          action={newProject}
        />
        {dialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">{newProject}</div>
      {list.isPending ? (
        <LoadingRows rows={5} />
      ) : list.isError ? (
        <ErrorMessage
          message={userMessage(list.error)}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : (
        <>
          <Group
            title="Açık projeler"
            projects={open}
            company={company.code}
            empty="Açık proje yok."
          />
          <Group title="Kapalı projeler" projects={closed} company={company.code} />
          {list.data.truncated ? (
            <p className="px-2 text-sm text-ink-secondary">Liste ilk 500 projeyi gösteriyor.</p>
          ) : null}
        </>
      )}
      {dialog}
    </div>
  );
}
