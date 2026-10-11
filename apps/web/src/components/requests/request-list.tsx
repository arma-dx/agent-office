import type { RequestSummary } from '@agent-office/shared';
import { linkOptions } from '@tanstack/react-router';
import { useId, type ReactNode } from 'react';
import { ListRow } from '@/components/list-row';
import { StatusIcon } from '@/components/status';
import { formatWhen } from '@/lib/dates';
import { dueText, rowSentence, stageText, turnText } from '@/lib/requests/labels';
import { cn } from '@/lib/utils';

/**
 * The list form of requests (flow A): three groups by whose turn it is. Used by the Talepler
 * screen and by the "Talepler" tab of a project's page, so that a request reads the same in both.
 * Nothing in a row is a control: nobody sets a status, a unit or an agent by hand (7 October
 * decisions 2 and 7).
 */

function RequestRow({
  request,
  company,
  showProject,
}: {
  request: RequestSummary;
  company: string;
  showProject: boolean;
}) {
  const turn = turnText(request.turn, request.waitingForMe);
  const due = dueText(request);
  const project = showProject ? request.project : null;
  return (
    <ListRow
      leading={<StatusIcon kind="task" status={request.status} labelled />}
      title={request.title}
      meta={
        project || due ? (
          <>
            {/* The project's name gives way to the title below 1280 px, like the unit code and the
                time; it is on the request's page and in the row's own sentence. Next to a due day
                it shows only from 1440 px: at 1280 px the two together would leave the title, the
                one thing that tells two rows apart, a few letters (lib/requests/labels.test.ts
                holds the widths). No `title` attribute: the text lies under the row's link. */}
            {project ? (
              <span
                className={cn(
                  'hidden max-w-40 truncate text-xs text-ink-secondary',
                  due ? 'min-[1440px]:block' : 'xl:block',
                )}
              >
                {project.name}
              </span>
            ) : null}
            {due ? (
              // The words carry the meaning, not a colour: the status language has no "overdue". A
              // day that has passed is the same text in the normal ink and a heavier weight.
              <span
                className={
                  request.overdue
                    ? 'text-xs font-medium'
                    : // Below 1280 px a day that has not passed gives way to the title too.
                      'hidden text-xs text-ink-secondary xl:inline'
                }
              >
                {due}
              </span>
            ) : null}
          </>
        ) : undefined
      }
      link={linkOptions({
        to: '/c/$company/requests/$requestId',
        params: { company, requestId: request.id },
        'aria-label': rowSentence(request, showProject),
      })}
      trailing={
        <>
          {/* Below 1280 px the fixed columns give way to the title, the one thing that tells two
              rows apart: the unit code and the time are dropped (both are on the request's page)
              and the stage gets a narrower column. */}
          <span
            className="hidden w-14 text-xs text-ink-secondary xl:block"
            title={request.unit?.name}
          >
            {request.unit?.code ?? ''}
          </span>
          <span
            className={cn('w-44 truncate xl:w-64', !request.waitingForMe && 'text-ink-secondary')}
            title={stageText(request)}
          >
            {stageText(request)}
          </span>
          <span className={cn('w-24 truncate xl:w-32', request.waitingForMe && 'font-semibold')}>
            {turn ?? ''}
          </span>
          <time
            dateTime={request.updatedAt}
            className="hidden w-20 text-right text-xs text-ink-secondary tabular-nums xl:block"
          >
            {formatWhen(request.updatedAt)}
          </time>
        </>
      }
    />
  );
}

function Group({
  title,
  requests,
  company,
  showProject,
}: {
  title: string;
  requests: RequestSummary[];
  company: string;
  showProject: boolean;
}) {
  const headingId = useId();
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="px-2 text-sm font-semibold">
        {title}{' '}
        <span className="font-normal text-ink-secondary tabular-nums">{requests.length}</span>
      </h2>
      <ul className="flex flex-col">
        {requests.map((request) => (
          <RequestRow
            key={request.id}
            request={request}
            company={company}
            showProject={showProject}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * The hidden line that says how many requests wait for the reader, and the three groups: what
 * waits for the reader (the one that has waited longest on top), what is under way, what is closed.
 * An empty group is not drawn. The caller owns the loading, error and empty states and the line
 * of a list that was cut.
 */
export function RequestGroups({
  requests,
  company,
  showProject,
}: {
  requests: readonly RequestSummary[];
  /** The company's short code, for the links. */
  company: string;
  /** False on a project's own page, where every row is of that project. */
  showProject: boolean;
}): ReactNode {
  const waiting = requests
    .filter((request) => request.waitingForMe)
    // The one that has waited longest is on top.
    .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const closed = requests.filter(
    (request) => request.stage === 'done' || request.stage === 'cancelled',
  );
  const running = requests.filter(
    (request) => !request.waitingForMe && request.stage !== 'done' && request.stage !== 'cancelled',
  );
  const groups = { company, showProject };
  return (
    <>
      <p role="status" className="sr-only">
        {waiting.length > 0 ? `${String(waiting.length)} talep sizden bekleniyor.` : ''}
      </p>
      <Group title="Sizden beklenenler" requests={waiting} {...groups} />
      <Group title="Sürenler" requests={running} {...groups} />
      <Group title="Bitenler" requests={closed} {...groups} />
    </>
  );
}
