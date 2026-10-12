import type { LinkedRepository, ProjectDetail } from '@agent-office/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError, userMessage } from '@/lib/api';
import { REPOSITORY_DIALOG } from '@/lib/github/labels';
import { githubRepositoriesQueryOptions, setProjectRepository } from '@/lib/github/query';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

const LABEL = 'text-sm font-medium';
const HELP = 'text-sm text-ink-secondary';
const PROBLEM = 'text-sm text-destructive';

/** A refusal that says the list the person chose from is no longer what the connection sees. */
const LIST_REFUSALS = [
  'github_repository_not_available',
  'github_not_connected',
  'github_not_configured',
];

/**
 * "Depo bağla" and "Depoyu değiştir" (12 October 2026, decision 17): the owner of a project, a
 * manager of it or the founder gives the project one repository of the organisation the company
 * is connected to, or another one. No passkey: connecting the company was the passkey's act
 * (docs/SONRA.md P5-l).
 *
 * The list is the API's, read from GitHub: every repository by its name and by nothing else
 * (decision 15; P5-w). The request names the repository by GitHub's number alone. Nothing is
 * shown as changed before the API has stored it; a refusal stays in the dialog, and when it says
 * the list is stale the list is read again and a choice that is gone is taken back.
 */
export function RepositoryDialog({
  project,
  current,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  /** The repository the project has now, as the tab reads it; null when it has none. */
  current: LinkedRepository | null;
  onClose: () => void;
  onSaved: (project: ProjectDetail) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const id = useId();
  const select = useRef<HTMLSelectElement>(null);
  const text = current ? REPOSITORY_DIALOG.change : REPOSITORY_DIALOG.link;
  const list = useQuery(githubRepositoriesQueryOptions(company.companyId));
  const offered = list.data?.state === 'ok' ? list.data : null;
  // What the person chose; until then the project's own repository, while the list offers it.
  const [picked, setPicked] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const isOffered = (value: string) =>
    offered?.repositories.some((repository) => String(repository.id) === value) ?? false;
  const wanted = picked ?? (current ? String(current.id) : '');
  const choice = isOffered(wanted) ? wanted : '';

  const save = useMutation({
    mutationFn: (repositoryId: number) =>
      setProjectRepository(company.companyId, project.id, repositoryId),
    onSuccess: (updated) => {
      onSaved(updated);
      toast.success(text.done);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && LIST_REFUSALS.includes(error.code ?? '')) {
        void list.refetch();
      }
    },
  });

  function submit() {
    if (save.isPending) return;
    if (choice === '') {
      setMissing(true);
      select.current?.focus();
      return;
    }
    // The repository the project already has: there is nothing to store.
    if (current !== null && Number(choice) === current.id) {
      onClose();
      return;
    }
    save.mutate(Number(choice));
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>{text.title}</DialogTitle>
        <DialogDescription>{REPOSITORY_DIALOG.help}</DialogDescription>
        {list.isPending ? (
          <div className="flex flex-col gap-2">
            <p className={HELP}>{REPOSITORY_DIALOG.loading}</p>
            <LoadingRows rows={1} />
          </div>
        ) : offered === null || offered.repositories.length === 0 ? (
          <>
            <p role="alert" className="text-sm">
              {list.isError
                ? userMessage(list.error)
                : offered !== null
                  ? REPOSITORY_DIALOG.empty
                  : list.data.state === 'not_connected'
                    ? REPOSITORY_DIALOG.notConnected
                    : REPOSITORY_DIALOG.unavailable}
            </p>
            <DialogFooter>
              {list.data?.state !== 'not_connected' ? (
                <Button
                  type="button"
                  variant="outline"
                  {...busyProps(list.isFetching)}
                  onClick={() => {
                    if (!list.isFetching) void list.refetch();
                  }}
                >
                  Yeniden dene
                </Button>
              ) : null}
              <Button type="button" variant="ghost" onClick={onClose}>
                Kapat
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-repository`} className={LABEL}>
                {REPOSITORY_DIALOG.label}
              </label>
              <NativeSelect
                ref={select}
                id={`${id}-repository`}
                value={choice}
                aria-required="true"
                aria-invalid={missing && choice === ''}
                aria-describedby={
                  [
                    missing && choice === '' ? `${id}-problem` : null,
                    offered.truncated ? `${id}-truncated` : null,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onChange={(event) => {
                  setPicked(event.target.value);
                }}
              >
                <option value="">{REPOSITORY_DIALOG.choose}</option>
                {offered.repositories.map((repository) => (
                  <option key={repository.id} value={String(repository.id)}>
                    {repository.fullName}
                  </option>
                ))}
              </NativeSelect>
              {missing && choice === '' ? (
                <p id={`${id}-problem`} role="alert" className={PROBLEM}>
                  {REPOSITORY_DIALOG.chooseProblem}
                </p>
              ) : null}
              {offered.truncated ? (
                <p id={`${id}-truncated`} className={HELP}>
                  {REPOSITORY_DIALOG.truncated}
                </p>
              ) : null}
            </div>
            {save.isError ? (
              <p role="alert" className={PROBLEM}>
                {userMessage(save.error)}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                {...busyProps(save.isPending)}
                onClick={() => {
                  if (!save.isPending) onClose();
                }}
              >
                Vazgeç
              </Button>
              <Button type="submit" size="lg" {...busyProps(save.isPending)}>
                {text.confirm}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
