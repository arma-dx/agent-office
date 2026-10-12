import {
  githubConnectionDetails,
  type GithubConnection,
  type MembershipSummary,
} from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { GithubLink } from '@/components/github-link';
import { InlineBanner } from '@/components/inline-banner';
import { ErrorMessage, LoadingRows } from '@/components/states';
import { StepUpDialog } from '@/components/step-up';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ApiError, userMessage } from '@/lib/api';
import { formatFull } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import { installHref, newInstallState, startInstall } from '@/lib/github/install';
import {
  canRefreshList,
  connectDialogText,
  connectedLead,
  connectedSelection,
  CONNECTION_DONE,
  CONNECTION_PROBLEM,
  CONNECTION_UNAVAILABLE,
  disconnectDialogText,
  INSTALLED_SELECTION,
  installedText,
  invalidText,
  linkedProjectsText,
  missingPermissionsText,
  NO_INSTALL_LINK,
  NOT_INSTALLED_HINT,
  notConfiguredText,
  notInstalledText,
  WAS_CONNECTED,
  whatConnectingDoes,
} from '@/lib/github/labels';
import {
  connectGithub,
  disconnectGithub,
  fetchGithubRepositories,
  githubConnectionKey,
  githubConnectionQueryOptions,
  githubKey,
  githubRepositoriesKey,
} from '@/lib/github/query';
import { projectPagesKey } from '@/lib/projects/query';
import { companyLabel } from '@/lib/session';
import { formatDate } from '@/lib/users';
import { busyProps } from '@/lib/utils';

type In<S extends GithubConnection['state']> = Extract<GithubConnection, { state: S }>;

const HELP = 'text-sm text-ink-secondary';

/**
 * The app is not installed on the company's organisation: the link to GitHub's install page. It
 * is the one link to GitHub that opens in the same tab: the state that brings the founder back to
 * this company's page lives in the tab's session storage (lib/github/install.ts), and a new tab
 * would start with an empty one. The state is kept only when the link is pressed.
 */
function NotInstalled({
  company,
  view,
}: {
  company: MembershipSummary;
  view: In<'not_installed'>;
}) {
  const [state] = useState(newInstallState);
  const href = installHref(view.installUrl, state);
  return (
    <>
      <p className="text-sm">{notInstalledText(view.organization)}</p>
      {href !== null ? (
        <div>
          <Button asChild>
            <a
              href={href}
              onClick={() => {
                startInstall(company.code, state);
              }}
            >
              GitHub&apos;da kur
            </a>
          </Button>
        </div>
      ) : (
        <p className="text-sm">{NO_INSTALL_LINK}</p>
      )}
      <p className={HELP}>{NOT_INSTALLED_HINT}</p>
    </>
  );
}

function Invalid({ company, view }: { company: MembershipSummary; view: In<'invalid'> }) {
  return (
    <>
      <InlineBanner tone="danger">{invalidText(view, companyLabel(company))}</InlineBanner>
      {view.manageUrl !== null ? (
        <p className="text-sm">
          <GithubLink href={view.manageUrl}>GitHub&apos;da düzenle</GithubLink>
        </p>
      ) : null}
    </>
  );
}

/** Installed and acceptable, not connected: what connecting leads to, and the button. */
function Installed({
  company,
  view,
  onConnect,
}: {
  company: MembershipSummary;
  view: In<'installed'>;
  onConnect: () => void;
}) {
  const missing = missingPermissionsText(view.permissions);
  return (
    <>
      <p className="text-sm">
        {installedText(view.organization)} {INSTALLED_SELECTION[view.repositorySelection]}
      </p>
      {missing !== null ? <InlineBanner tone="warning">{missing}</InlineBanner> : null}
      {view.wasConnected ? <p className="text-sm">{WAS_CONNECTED}</p> : null}
      <p className={HELP}>{whatConnectingDoes(companyLabel(company))}</p>
      <div>
        <Button onClick={onConnect}>GitHub&apos;ı bağla</Button>
      </div>
    </>
  );
}

/**
 * Connected: to which organisation, by whom and when, what the app reaches, how many projects
 * hang on it, and what does not work just now. A read never changes the connection: one whose app
 * was removed stays "connected" with its problem named, until the founder disconnects.
 */
function Connected({
  company,
  view,
  onDisconnect,
}: {
  company: MembershipSummary;
  view: In<'connected'>;
  onDisconnect: () => void;
}) {
  const queryClient = useQueryClient();
  // "Listeyi yenile": the API reads the list from GitHub again now; the page then reads the
  // connection again, whose count comes from that list.
  const refresh = useMutation({
    mutationFn: () => fetchGithubRepositories(company.companyId, { refresh: true }),
    onSuccess: async (list) => {
      await queryClient.invalidateQueries({ queryKey: githubKey(company.companyId) });
      if (list.state === 'ok') toast.success(CONNECTION_DONE.listRead);
      else toast.error(CONNECTION_DONE.listNotRead);
    },
    onError: (error) => {
      toast.error(userMessage(error));
    },
  });
  const missing = missingPermissionsText(view.permissions);
  return (
    <>
      <p className="text-sm">
        {connectedLead(view.organization, view.connectedBy)}{' '}
        <time dateTime={view.connectedAt} title={formatFull(view.connectedAt)}>
          {formatDate(view.connectedAt)}
        </time>
        .
      </p>
      {view.repositorySelection !== null && view.repositoryCount !== null ? (
        <p className="text-sm tabular-nums">
          {connectedSelection(view.repositorySelection, view.repositoryCount)}
        </p>
      ) : null}
      <p className="text-sm tabular-nums">{linkedProjectsText(view.linkedProjectCount)}</p>
      {missing !== null ? <InlineBanner tone="warning">{missing}</InlineBanner> : null}
      {view.problem !== null ? (
        <InlineBanner tone="danger">{CONNECTION_PROBLEM[view.problem]}</InlineBanner>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {canRefreshList(view.problem) ? (
          <Button
            variant="outline"
            {...busyProps(refresh.isPending)}
            onClick={() => {
              if (!refresh.isPending) refresh.mutate();
            }}
          >
            {refresh.isPending ? 'Liste okunuyor' : 'Listeyi yenile'}
          </Button>
        ) : null}
        <Button variant="destructive" onClick={onDisconnect}>
          Bağlantıyı kes
        </Button>
        {view.manageUrl !== null ? (
          <GithubLink href={view.manageUrl} className="text-sm">
            GitHub&apos;da depoları düzenle
          </GithubLink>
        ) : null}
      </div>
    </>
  );
}

/**
 * Switches the connection of this company off after a plain confirmation: no passkey, because it
 * only takes access away (docs/SONRA.md P5-c). The other company's connection is not touched.
 */
function DisconnectDialog({
  company,
  onClose,
  onDone,
  onCloseAutoFocus,
}: {
  company: MembershipSummary;
  onClose: () => void;
  onDone: (answer: GithubConnection) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const text = disconnectDialogText(companyLabel(company));
  const disconnect = useMutation({
    mutationFn: () => disconnectGithub(company.companyId),
    onSuccess: (answer) => {
      onDone(answer);
      onClose();
    },
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !disconnect.isPending) onClose();
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogTitle>{text.title}</AlertDialogTitle>
        <AlertDialogDescription>{text.description}</AlertDialogDescription>
        {disconnect.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {userMessage(disconnect.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            autoFocus
            {...busyProps(disconnect.isPending)}
            onClick={(event) => {
              if (disconnect.isPending) event.preventDefault();
            }}
          >
            Vazgeç
          </AlertDialogCancel>
          <Button
            variant="destructive"
            size="lg"
            {...busyProps(disconnect.isPending)}
            onClick={() => {
              if (!disconnect.isPending) disconnect.mutate();
            }}
          >
            {text.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The "GitHub" section of Ayarlar > Bağlantılar (8 October 2026, decisions 19 and 22; 12 October
 * decisions 12 to 15): the founder connects the GitHub organisation of the company the page
 * belongs to, once, with a passkey, and switches the connection off. The other company has its
 * own page and its own connection; nothing here names it.
 *
 * The page tells the API nothing about GitHub: the API asks GitHub itself, with the app of this
 * company, and the page shows what it answers. Connecting is confirmed for exactly the
 * organisation and the installation the page shows; when either changes while the confirmation
 * is open, the confirmation closes and the page shows the new state.
 *
 * The state is not refreshed on a timer: it is read when the page opens, when the person comes
 * back to the window (for example from GitHub's install page) and after every change made here.
 */
export function GithubConnectionSection({ company }: { company: MembershipSummary }): ReactNode {
  const queryClient = useQueryClient();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery(githubConnectionQueryOptions(company.companyId));
  // The installation the confirmation was opened for; null while it is closed.
  const [connectingTo, setConnectingTo] = useState<number | null>(null);
  const connectFocus = useReturnFocus();
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnectFocus = useReturnFocus();
  const key = githubConnectionKey(company.companyId);

  /** The connection changed: everything read through it is read again. */
  function changed(answer: GithubConnection) {
    // The answer is the connection as it is now; the repository list is read again.
    queryClient.setQueryData(key, answer);
    void queryClient.invalidateQueries({ queryKey: githubRepositoriesKey(company.companyId) });
    void queryClient.invalidateQueries({ queryKey: projectPagesKey(company.companyId) });
  }
  /** The button that opened a confirmation is gone with the state it stood in. */
  function focusHeadingUnlessReturned(event: Event) {
    if (!event.defaultPrevented) {
      event.preventDefault();
      heading.current?.focus();
    }
  }

  const view = query.data;
  const installed = view?.state === 'installed' ? view : null;
  const confirming = installed?.installationId === connectingTo ? installed : null;
  const label = companyLabel(company);

  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingRows rows={3} />;
  } else if (view === undefined) {
    body = (
      <ErrorMessage
        message={userMessage(query.error)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (view.state === 'not_configured') {
    body = <p className="text-sm">{notConfiguredText(label)}</p>;
  } else if (view.state === 'unavailable') {
    body = (
      <ErrorMessage
        message={CONNECTION_UNAVAILABLE[view.reason]}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (view.state === 'not_installed') {
    body = <NotInstalled company={company} view={view} />;
  } else if (view.state === 'invalid') {
    body = <Invalid company={company} view={view} />;
  } else if (view.state === 'installed') {
    body = (
      <Installed
        company={company}
        view={view}
        onConnect={() => {
          connectFocus.remember();
          setConnectingTo(view.installationId);
        }}
      />
    );
  } else {
    body = (
      <Connected
        company={company}
        view={view}
        onDisconnect={() => {
          disconnectFocus.remember();
          setDisconnecting(true);
        }}
      />
    );
  }

  const connectText = connectDialogText(confirming?.organization ?? '', label);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* The heading takes the focus when the button that held it goes away with its state. */}
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-base font-semibold">
        GitHub
      </h2>
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">{body}</div>
      <StepUpDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConnectingTo(null);
        }}
        request={
          confirming !== null
            ? {
                purpose: 'github_connection',
                companyId: company.companyId,
                subjectId: company.companyId,
                details: githubConnectionDetails(
                  confirming.organization,
                  confirming.installationId,
                ),
              }
            : null
        }
        action={(stepUp) =>
          connectGithub(company.companyId, stepUp).catch((error: unknown) => {
            // A refusal may mean that GitHub's side changed: the page behind reads it again.
            if (error instanceof ApiError) void queryClient.invalidateQueries({ queryKey: key });
            throw error;
          })
        }
        onSuccess={(answer) => {
          changed(answer);
          setConnectingTo(null);
          toast.success(CONNECTION_DONE.connected);
        }}
        title={connectText.title}
        description={connectText.description}
        confirmLabel={connectText.confirmLabel}
        onCloseAutoFocus={(event) => {
          connectFocus.onCloseAutoFocus(event);
          focusHeadingUnlessReturned(event);
        }}
      />
      {disconnecting ? (
        <DisconnectDialog
          company={company}
          onClose={() => {
            setDisconnecting(false);
          }}
          onDone={(answer) => {
            changed(answer);
            toast.success(CONNECTION_DONE.disconnected);
          }}
          onCloseAutoFocus={(event) => {
            disconnectFocus.onCloseAutoFocus(event);
            focusHeadingUnlessReturned(event);
          }}
        />
      ) : null}
    </section>
  );
}
