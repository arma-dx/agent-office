import type { ProjectDetail, ProjectRun, RunUsage } from '@agent-office/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SpendingLimit } from '@/components/projects/spending-limit';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { userMessage } from '@/lib/api';
import { formatFull, formatWhen } from '@/lib/dates';
import { runDurationText, runResultReason } from '@/lib/projects/labels';
import { formatCount, formatMoney } from '@/lib/projects/money';
import { fetchProjectRuns, projectRunsKey, projectRunsQueryOptions } from '@/lib/projects/query';
import { useBackgroundRefresh } from '@/lib/refresh';
import { useCompany } from '@/lib/session';

const NUMBER = 'text-right tabular-nums';

/** The four token counts of a run as one sentence: the cell's title, and a screen reader's text. */
function tokenBreakdown(usage: RunUsage): string {
  return `Girdi ${formatCount(usage.inputTokens)}, çıktı ${formatCount(usage.outputTokens)}, önbelleğe yazılan ${formatCount(usage.cacheWriteTokens)}, önbellekten okunan ${formatCount(usage.cacheReadTokens)}`;
}

function tokenSum(usage: RunUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
}

/**
 * The founder's figures above the table: what all runs of the project cost and used, also the
 * ones the list no longer shows.
 */
function Totals({ usage }: { usage: RunUsage }) {
  const figures: [string, string][] = [
    ['Toplam maliyet', formatMoney(usage.costUsd, 'USD')],
    ['Girdi tokeni', formatCount(usage.inputTokens)],
    ['Çıktı tokeni', formatCount(usage.outputTokens)],
    ['Önbelleğe yazılan', formatCount(usage.cacheWriteTokens)],
    ['Önbellekten okunan', formatCount(usage.cacheReadTokens)],
  ];
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {figures.map(([name, value]) => (
        <div key={name} className="flex flex-col gap-0.5">
          <dt className="text-xs text-ink-secondary">{name}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunRow({ run, company, costs }: { run: ProjectRun; company: string; costs: boolean }) {
  const reason = runResultReason(run.status, run.errorCode);
  return (
    <TableRow>
      {/* The first cell takes the room the fixed columns leave, and cuts a long title. */}
      <TableCell className="w-full max-w-0">
        {run.request ? (
          <Link
            to="/c/$company/requests/$requestId"
            params={{ company, requestId: run.request.id }}
            className="block truncate font-medium text-brand underline underline-offset-4"
          >
            {run.request.title}
          </Link>
        ) : (
          <span className="block truncate text-ink-secondary">Talebe bağlı değil</span>
        )}
        <span className="block truncate text-xs text-ink-secondary">
          {run.agent.code} {run.agent.name}
        </span>
      </TableCell>
      <TableCell className="w-[6.5rem] text-ink-secondary">
        <time dateTime={run.startedAt} title={formatFull(run.startedAt)}>
          {formatWhen(run.startedAt)}
        </time>
      </TableCell>
      <TableCell className={`w-14 ${NUMBER}`}>{runDurationText(run.durationMs)}</TableCell>
      <TableCell className="w-40 whitespace-normal">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge kind="run" status={run.status} />
          {reason ? <span className="text-xs text-ink-secondary">{reason}</span> : null}
        </span>
      </TableCell>
      {costs ? (
        <>
          {/* The breakdown is text a screen reader reads after the number: an aria-label on a
              table cell is not read reliably, and where it is read it replaces the number. */}
          <TableCell
            className={`w-[4.5rem] ${NUMBER}`}
            title={run.usage ? tokenBreakdown(run.usage) : undefined}
          >
            {run.usage ? (
              <>
                {formatCount(tokenSum(run.usage))}
                <span className="sr-only">. {tokenBreakdown(run.usage)}</span>
              </>
            ) : null}
          </TableCell>
          <TableCell className={`w-20 ${NUMBER}`}>
            {run.usage ? formatMoney(run.usage.costUsd, 'USD', 4) : null}
          </TableCell>
        </>
      ) : null}
    </TableRow>
  );
}

/**
 * The "Çalışmalar" tab of a project's page (8 October 2026, decision 17): the newest 200 agent
 * runs of the project, one row each, and how many there are in all. Every reader of the project
 * gets the list; tokens and cost are the founder's (docs/SONRA.md P-t): the two columns and the
 * figures are drawn when the API's answer carries them, and the page never asks for the role.
 *
 * No text of an agent is here and none is in the answer (docs/SONRA.md V-c): a row is the title of
 * its request, which a person wrote, the agent's code and name, times, and the result as the
 * status word with a fixed reason. Whoever wants the story of a run opens its request.
 *
 * Runs move by themselves, so the list is refreshed every half minute with a background request,
 * which does not extend the session's idle time (rule 3).
 *
 * Above the list, whatever its state, stands the founder's block: what the project's agents have
 * spent and the AI spending limit (components/projects/spending-limit.tsx). Its figures come with
 * the project, so it is there while the runs are still being read, and when they cannot be.
 */
export function ProjectRuns({ project }: { project: ProjectDetail }): ReactNode {
  return (
    <div className="flex flex-col gap-5">
      <SpendingLimit project={project} />
      <RunList project={project} />
    </div>
  );
}

function RunList({ project }: { project: ProjectDetail }): ReactNode {
  const company = useCompany();
  const list = useQuery(projectRunsQueryOptions(company.companyId, project.id));
  useBackgroundRefresh({
    queryKey: projectRunsKey(company.companyId, project.id),
    fetch: (signal) =>
      fetchProjectRuns(company.companyId, project.id, { signal, background: true }),
  });

  if (list.isPending) return <LoadingRows rows={5} />;
  if (list.isError) {
    return (
      <ErrorMessage
        message={userMessage(list.error)}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  }
  const { runs, totals, truncated } = list.data;
  if (totals.runCount === 0 && runs.length === 0) {
    return (
      <EmptyState
        title="Bu projede henüz ajan çalışması yok"
        description="Bu projede bir talep açıldığında ajanların çalışmaları burada listelenir."
      />
    );
  }
  const costs = totals.usage !== null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-secondary tabular-nums">
        Bu projede {totals.runCount} ajan çalışması var.
      </p>
      {totals.usage ? <Totals usage={totals.usage} /> : null}
      {/* The browser sizes the columns: each fixed column keeps the width its content needs
          ("Sürüyor" is wider than a duration), and the first one takes the rest. */}
      <Table>
        <TableCaption className="sr-only">
          Bu projedeki ajan çalışmaları, en yenisi üstte
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Talep</TableHead>
            <TableHead scope="col" className="w-[6.5rem]">
              Başladı
            </TableHead>
            <TableHead scope="col" className={`w-14 ${NUMBER}`}>
              Süre
            </TableHead>
            <TableHead scope="col" className="w-40">
              Sonuç
            </TableHead>
            {costs ? (
              <>
                <TableHead scope="col" className={`w-[4.5rem] ${NUMBER}`}>
                  Token
                </TableHead>
                <TableHead scope="col" className={`w-20 ${NUMBER}`}>
                  Maliyet
                </TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} company={company.code} costs={costs} />
          ))}
        </TableBody>
      </Table>
      {truncated ? (
        <p className="text-sm text-ink-secondary">
          Liste en yeni 200 çalışmayı gösteriyor; toplamlar bütün çalışmaları kapsar.
        </p>
      ) : null}
    </div>
  );
}
