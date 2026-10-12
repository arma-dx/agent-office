import type {
  GithubCommit,
  GithubIssue,
  GithubLists,
  GithubPullRequest,
  LinkedRepository,
  ProjectDetail,
  ProjectGithub as ProjectGithubAnswer,
} from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { GithubLink } from '@/components/github-link';
import { InlineBanner } from '@/components/inline-banner';
import { RepositoryDialog } from '@/components/projects/repository-dialog';
import { ErrorMessage, LoadingRows } from '@/components/states';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { formatClock, formatFull, formatWhen } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import {
  canChangeRepository,
  LISTS,
  openedText,
  REMOVE_REPOSITORY,
  shortSha,
  TAB_TEXT,
  tabUnavailableText,
  wroteText,
} from '@/lib/github/labels';
import {
  fetchProjectGithub,
  projectGithubKey,
  projectGithubQueryOptions,
  removeProjectRepository,
} from '@/lib/github/query';
import { useStoreProject } from '@/lib/projects/store';
import { useBackgroundRefresh } from '@/lib/refresh';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/** The tab reads GitHub again by itself this often while it is on screen (docs/SONRA.md P5-e). */
export const GITHUB_TAB_REFRESH_MS = 5 * 60 * 1000;

const HELP = 'text-sm text-ink-secondary';
const BOX = 'flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-6 text-sm';

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatFull(iso)}>
      {formatWhen(iso)}
    </time>
  );
}

/** The facts of a row as one line of words, separated by commas. */
function Facts({ parts }: { parts: readonly (ReactNode | null)[] }) {
  const shown = parts.filter((part) => part !== null);
  return (
    <span className="block text-sm break-words text-ink-secondary tabular-nums">
      {shown.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? ', ' : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * The title of a row: what a person wrote on GitHub, shown as plain text and never interpreted.
 * It is a link when GitHub gave an address on github.com for it.
 */
function Title({ href, children }: { href: string | null; children: string }) {
  return (
    <GithubLink href={href} className="text-sm font-medium break-words">
      <span dir="auto">{children}</span>
    </GithubLink>
  );
}

const ROW = 'flex flex-col gap-0.5 border-b border-line px-4 py-2.5 last:border-b-0';

function CommitRow({ commit }: { commit: GithubCommit }) {
  return (
    <li className={ROW}>
      <Title href={commit.url}>{commit.title}</Title>
      {/* A commit that is tied to no GitHub account names nobody (docs/SONRA.md P5-v). */}
      <Facts
        parts={[
          commit.author !== null ? wroteText(commit.author) : null,
          commit.date !== null ? <When iso={commit.date} /> : null,
          shortSha(commit.sha),
        ]}
      />
    </li>
  );
}

function PullRequestRow({ pullRequest }: { pullRequest: GithubPullRequest }) {
  return (
    <li className={ROW}>
      <Title href={pullRequest.url}>{pullRequest.title}</Title>
      <Facts
        parts={[
          `#${String(pullRequest.number)}`,
          pullRequest.author !== null ? openedText(pullRequest.author) : null,
          <When iso={pullRequest.createdAt} />,
          pullRequest.draft ? TAB_TEXT.draft : null,
        ]}
      />
    </li>
  );
}

function IssueRow({ issue }: { issue: GithubIssue }) {
  return (
    <li className={ROW}>
      <Title href={issue.url}>{issue.title}</Title>
      <Facts
        parts={[
          `#${String(issue.number)}`,
          issue.author !== null ? openedText(issue.author) : null,
          <When iso={issue.createdAt} />,
        ]}
      />
    </li>
  );
}

/**
 * One of the three lists. Each stands by itself: a list that could not be read says so and the
 * other two still show.
 */
function ListSection<T>({
  text,
  list,
  repository,
  keyOf,
  row,
}: {
  text: { heading: string; empty: string };
  list: { items: T[]; more: boolean } | null;
  repository: LinkedRepository;
  keyOf: (item: T) => string;
  row: (item: T) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h4 id={headingId} className="text-sm font-semibold">
        {text.heading}
      </h4>
      {list === null ? (
        <p className={HELP}>{TAB_TEXT.listNotRead}</p>
      ) : list.items.length === 0 ? (
        <p className={HELP}>{text.empty}</p>
      ) : (
        <ul aria-labelledby={headingId} className="rounded-lg border border-line">
          {list.items.map((item) => (
            <Fragment key={keyOf(item)}>{row(item)}</Fragment>
          ))}
        </ul>
      )}
      {list?.more === true ? (
        <p className="text-sm">
          <GithubLink href={repository.url}>{TAB_TEXT.more}</GithubLink>
        </p>
      ) : null}
    </section>
  );
}

function Lists({ lists, repository }: { lists: GithubLists; repository: LinkedRepository }) {
  return (
    <>
      <ListSection
        text={LISTS.commits}
        list={lists.commits}
        repository={repository}
        keyOf={(commit) => commit.sha}
        row={(commit) => <CommitRow commit={commit} />}
      />
      <ListSection
        text={LISTS.pullRequests}
        list={lists.pullRequests}
        repository={repository}
        keyOf={(pullRequest) => String(pullRequest.number)}
        row={(pullRequest) => <PullRequestRow pullRequest={pullRequest} />}
      />
      <ListSection
        text={LISTS.issues}
        list={lists.issues}
        repository={repository}
        keyOf={(issue) => String(issue.number)}
        row={(issue) => <IssueRow issue={issue} />}
      />
    </>
  );
}

/** Which repository the tab is about, and when its lists were read. */
function RepositoryLine({
  repository,
  lists,
}: {
  repository: LinkedRepository;
  lists: GithubLists | null;
}) {
  return (
    <p className="text-sm break-words">
      <GithubLink href={repository.url} className="font-medium">
        {repository.fullName}
      </GithubLink>
      {lists?.archived === true ? ` ${TAB_TEXT.archived}` : null}
      {lists !== null ? (
        <span className="text-ink-secondary tabular-nums">
          {'. '}
          {TAB_TEXT.lastRead}{' '}
          <time dateTime={lists.fetchedAt} title={formatFull(lists.fetchedAt)}>
            {formatClock(lists.fetchedAt)}
          </time>
        </span>
      ) : null}
    </p>
  );
}

/**
 * Takes the repository of the project away after a plain confirmation. Nothing on GitHub is
 * touched, and the API needs no GitHub for it.
 */
function RemoveDialog({
  project,
  onClose,
  onRemoved,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onRemoved: (project: ProjectDetail) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const remove = useMutation({
    mutationFn: () => removeProjectRepository(company.companyId, project.id),
    onSuccess: (updated) => {
      onRemoved(updated);
      toast.success(REMOVE_REPOSITORY.done);
      onClose();
    },
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogTitle>{REMOVE_REPOSITORY.title}</AlertDialogTitle>
        <AlertDialogDescription>{REMOVE_REPOSITORY.description}</AlertDialogDescription>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {userMessage(remove.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            autoFocus
            {...busyProps(remove.isPending)}
            onClick={(event) => {
              if (remove.isPending) event.preventDefault();
            }}
          >
            Vazgeç
          </AlertDialogCancel>
          <Button
            variant="destructive"
            size="lg"
            {...busyProps(remove.isPending)}
            onClick={() => {
              if (!remove.isPending) remove.mutate();
            }}
          >
            {REMOVE_REPOSITORY.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The repository of an answer that has one. */
function repositoryOf(answer: ProjectGithubAnswer): LinkedRepository | null {
  return answer.state === 'not_connected' || answer.state === 'no_repository'
    ? null
    : answer.repository;
}

/**
 * The "GitHub" tab of a project (8 October 2026, decision 17; 12 October decisions 14 to 17):
 * the last commits of the default branch, the open pull requests and the open issues of the one
 * repository the project was given, read only. Every reader of the project sees them, with the
 * GitHub user names of the people who wrote them (decision 16); the owner, the managers and the
 * founder give the project its repository, change it and take it away (decision 17).
 *
 * Everything here is an answer of the API: the panel loads nothing from GitHub, and the only
 * thing that leads there is a link the person presses. What cannot be shown is a state of the
 * answer, said in a sentence: the company is not connected, the project has no repository, the
 * customer's contract closes the reading (rule 12), GitHub cannot be asked. Titles and messages
 * are plain text.
 *
 * The lists are read when the tab opens and on "Yenile", and every five minutes while the tab is
 * on screen, with a background request that does not extend the session's idle time (rule 3).
 * Nothing is refreshed while a dialog of the tab is open.
 */
export function ProjectGithub({ project }: { project: ProjectDetail }): ReactNode {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const key = projectGithubKey(company.companyId, project.id);
  const query = useQuery(projectGithubQueryOptions(company.companyId, project.id));
  const [choosing, setChoosing] = useState(false);
  const chooseFocus = useReturnFocus();
  const [removing, setRemoving] = useState(false);
  const removeFocus = useReturnFocus();
  useBackgroundRefresh({
    queryKey: key,
    fetch: (signal) =>
      fetchProjectGithub(company.companyId, project.id, { signal, background: true }),
    intervalMs: GITHUB_TAB_REFRESH_MS,
    paused: () => choosing || removing,
  });

  // The dialog that is closing gave the project a repository or took it away: the button that
  // opened it ("Depo bağla", "Depoyu kaldır") is still on screen, and goes when the tab has read
  // again. The focus must not be on it then, or it would fall to the page.
  const openerGoes = useRef(false);

  /** The project's repository changed: the page shows the answer, and the tab reads again. */
  function changed(updated: ProjectDetail, linkedBefore: boolean) {
    openerGoes.current = linkedBefore !== (updated.repository !== null);
    store(updated);
    void queryClient.invalidateQueries({ queryKey: key });
  }
  /**
   * Where the focus goes when a dialog of the tab has closed: back to the button that opened it,
   * or to the heading when that button is gone or about to go with the state it stood in.
   */
  function focusAfter(dialog: { onCloseAutoFocus: (event: Event) => void }, event: Event) {
    if (openerGoes.current) {
      openerGoes.current = false;
    } else {
      dialog.onCloseAutoFocus(event);
    }
    if (!event.defaultPrevented) {
      event.preventDefault();
      heading.current?.focus();
    }
  }

  const answer = query.data;
  const repository = answer ? repositoryOf(answer) : null;
  const canLink = answer?.canLink === true;
  // Another repository can be chosen while the list of repositories can be asked for.
  const mayChange =
    canLink &&
    (answer.state === 'ok' ||
      (answer.state === 'unavailable' && canChangeRepository(answer.reason)));
  const mayRemove = canLink && repository !== null;
  const openChooser = () => {
    chooseFocus.remember();
    setChoosing(true);
  };

  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingRows rows={5} />;
  } else if (answer === undefined) {
    body = (
      <ErrorMessage
        message={userMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (answer.state === 'not_connected') {
    body = (
      <div className={BOX}>
        <p>{answer.disconnected ? TAB_TEXT.disconnected : TAB_TEXT.notConnected}</p>
        {/* The first step is the founder's, and the page that takes it is one press away. */}
        {company.role === 'founder' ? (
          <Link
            to="/c/$company/settings/connections"
            params={{ company: company.code }}
            className="font-medium text-brand underline underline-offset-4"
          >
            {TAB_TEXT.openConnections}
          </Link>
        ) : null}
      </div>
    );
  } else if (answer.state === 'no_repository') {
    body = (
      <div className={BOX}>
        <p>{TAB_TEXT.noRepository}</p>
        {!answer.canLink ? (
          <p className="text-ink-secondary">{TAB_TEXT.whoLinks}</p>
        ) : answer.allowed ? (
          <div className="pt-1">
            <Button onClick={openChooser}>{TAB_TEXT.link}</Button>
          </div>
        ) : (
          <p className="text-ink-secondary">{TAB_TEXT.linkNotAllowed}</p>
        )}
      </div>
    );
  } else if (answer.state === 'not_allowed') {
    body = (
      <>
        <RepositoryLine repository={answer.repository} lists={null} />
        <InlineBanner tone="info">{TAB_TEXT.notAllowed}</InlineBanner>
      </>
    );
  } else if (answer.state === 'unavailable') {
    body = (
      <>
        <RepositoryLine repository={answer.repository} lists={answer.last} />
        <InlineBanner tone="warning">
          {tabUnavailableText(
            answer.reason,
            answer.retryAt !== null ? formatClock(answer.retryAt) : null,
          )}
        </InlineBanner>
        {/* The last lists the API still holds, shown only while GitHub itself cannot be asked. */}
        {answer.last !== null ? <Lists lists={answer.last} repository={answer.repository} /> : null}
      </>
    );
  } else {
    body = (
      <>
        <RepositoryLine repository={answer.repository} lists={answer.lists} />
        <Lists lists={answer.lists} repository={answer.repository} />
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* The heading takes the focus when the button that held it goes away with its state. */}
        <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[0.9375rem] font-semibold">
          {TAB_TEXT.heading}
        </h3>
        {answer !== undefined ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* The same button while it reads: the focus stays on it. */}
            <Button
              variant="outline"
              {...busyProps(query.isFetching)}
              onClick={() => {
                if (!query.isFetching) void query.refetch();
              }}
            >
              {query.isFetching ? TAB_TEXT.reading : TAB_TEXT.refresh}
            </Button>
            {mayChange ? (
              <Button variant="outline" onClick={openChooser}>
                {TAB_TEXT.change}
              </Button>
            ) : null}
            {mayRemove ? (
              <Button
                variant="outline"
                onClick={() => {
                  removeFocus.remember();
                  setRemoving(true);
                }}
              >
                {TAB_TEXT.remove}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {body}
      {/* Mounted only while open: every opening starts from the repository as it is now. */}
      {choosing ? (
        <RepositoryDialog
          project={project}
          current={repository}
          onClose={() => {
            setChoosing(false);
          }}
          onSaved={(updated) => {
            changed(updated, repository !== null);
          }}
          onCloseAutoFocus={(event) => {
            focusAfter(chooseFocus, event);
          }}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          project={project}
          onClose={() => {
            setRemoving(false);
          }}
          onRemoved={(updated) => {
            changed(updated, true);
          }}
          onCloseAutoFocus={(event) => {
            focusAfter(removeFocus, event);
          }}
        />
      ) : null}
    </section>
  );
}
