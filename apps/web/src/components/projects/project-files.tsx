import type { ProjectDetail, ProjectFile, ProjectFileList } from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';
import { InlineBanner } from '@/components/inline-banner';
import { AddFileDialog } from '@/components/projects/add-file-dialog';
import { EmptyState, ErrorMessage, LoadingRows } from '@/components/states';
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
import { formatFull, formatWhen } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import { notifyError } from '@/lib/notify';
import {
  deleteProjectFile,
  downloadProjectFile,
  fileAddedBy,
  fileAgentLine,
  fileFactsLine,
  FILES_TEXT,
  projectFilesKey,
  projectFilesQueryOptions,
} from '@/lib/projects/files';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * One file: its name, what it is and how large, who added it and when; "İndir" and, where the API
 * says the reader may delete it, "Sil". Built like a member row: a group named after the file, so
 * a screen reader names the row before its buttons. The name is cut with an ellipsis and whole in
 * its title; the line of facts wraps. A file agents cannot read (its type, or its size) says so
 * in a line of its own, whatever the project's AI permission: plain words, no icon and no colour
 * of a status.
 */
function FileRow({
  projectId,
  file,
  actions,
  onDelete,
  onGone,
}: {
  projectId: string;
  file: ProjectFile;
  /** False where the storage is not set up: the row then has no button. */
  actions: boolean;
  onDelete: () => void;
  /** The API answered that the file, or its content, is gone: the list is read again. */
  onGone: () => void;
}) {
  const company = useCompany();
  const nameId = useId();
  const agentLine = fileAgentLine(file);
  // The browser shows its own download; nothing is said on success.
  const download = useMutation({
    mutationFn: () => downloadProjectFile(company.companyId, projectId, file),
    onError: (error) => {
      notifyError(error);
      if (error instanceof ApiError && error.status === 404) onGone();
    },
  });
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div
        role="group"
        aria-labelledby={nameId}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex min-w-0 flex-col">
          <span id={nameId} dir="auto" title={file.name} className="truncate text-sm font-medium">
            {file.name}
          </span>
          {/* The words of fileFactsLine and fileAddedLine; the time alone is a <time>. */}
          <span className="text-sm break-words text-ink-secondary">
            <span className="tabular-nums">{fileFactsLine(file)}</span>
            {'. '}
            {fileAddedBy(file)}
            {', '}
            <time dateTime={file.createdAt} title={formatFull(file.createdAt)}>
              {formatWhen(file.createdAt)}
            </time>
            .
          </span>
          {agentLine ? <span className="text-sm text-ink-secondary">{agentLine}.</span> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              {...busyProps(download.isPending)}
              onClick={() => {
                if (!download.isPending) download.mutate();
              }}
            >
              {download.isPending ? 'İndiriliyor' : 'İndir'}
            </Button>
            {file.deletable ? (
              <Button variant="outline" onClick={onDelete}>
                Sil
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Deletes a file after a plain confirmation: no passkey (docs/SONRA.md P4-v). Deleting cannot be
 * taken back, so "Vazgeç" has the focus first. The row is taken off the list only when the API
 * has answered. After any refusal the list is read again: somebody else may have deleted the
 * file, and the list then says so. A confirmation that is given up returns the focus to the "Sil"
 * button; when that button is gone (the file was deleted here, and its row with it, or by
 * somebody else meanwhile) the heading of the section takes it.
 */
function DeleteFileDialog({
  projectId,
  file,
  onClose,
  onDeleted,
  onRefused,
  onCloseAutoFocus,
  heading,
}: {
  projectId: string;
  file: ProjectFile;
  onClose: () => void;
  onDeleted: () => void;
  onRefused: () => void;
  onCloseAutoFocus: (event: Event) => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const company = useCompany();
  const remove = useMutation({
    mutationFn: () => deleteProjectFile(company.companyId, projectId, file.id),
    onSuccess: () => {
      // The row leaves the list before the dialog closes.
      onDeleted();
      toast.success(`${file.name} silindi.`);
      onClose();
    },
    onError: onRefused,
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus(event);
          // The button that asked is gone with its row.
          if (!event.defaultPrevented) {
            event.preventDefault();
            heading.current?.focus();
          }
        }}
      >
        <AlertDialogTitle className="break-words">
          <span dir="auto">{file.name}</span> silinsin mi?
        </AlertDialogTitle>
        <AlertDialogDescription>{FILES_TEXT.deleteDescription}</AlertDialogDescription>
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
            Dosyayı sil
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The "Dosyalar" tab of a project (8 October 2026, decisions 11 and 20): the files people added
 * to it. The founder and the members of the project see them and add one; who may delete a file
 * is the API's answer (`deletable`: the person who added it, the owner and the managers of the
 * project, the founder; 11 October decision 2). A file is never shown by the panel: it is always
 * a download. Under the list the tab says what agents do with the files of this project (8
 * October decision 21): they read PDF, image and text files while they may work in it, and none
 * otherwise.
 *
 * Nothing is shown as added or deleted before the API has answered. The list is not refreshed on
 * a timer (docs/SONRA.md P4-s): it is read again after every change the person makes, after a
 * refusal, and when they come back to the window.
 *
 * Where the file storage is not set up (`storageAvailable` false) the list is still shown, and
 * nothing that would need the storage is offered.
 */
export function ProjectFiles({ project }: { project: ProjectDetail }): ReactNode {
  const company = useCompany();
  const queryClient = useQueryClient();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useQuery(projectFilesQueryOptions(company.companyId, project.id));
  const [adding, setAdding] = useState(false);
  const addFocus = useReturnFocus();
  const [deleting, setDeleting] = useState<ProjectFile | null>(null);
  const deleteFocus = useReturnFocus();

  const key = projectFilesKey(company.companyId, project.id);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };
  const openDialog = () => {
    addFocus.remember();
    setAdding(true);
  };

  const files = list.data?.files ?? [];
  const storage = list.data?.storageAvailable ?? false;
  const add = <Button onClick={openDialog}>Dosya ekle</Button>;

  let body: ReactNode;
  if (list.isPending) {
    body = <LoadingRows rows={4} />;
  } else if (list.isError) {
    body = (
      <ErrorMessage
        message={userMessage(list.error)}
        onRetry={() => {
          void list.refetch();
        }}
      />
    );
  } else if (files.length === 0 && storage) {
    body = (
      <EmptyState
        title={FILES_TEXT.emptyTitle}
        description={FILES_TEXT.emptyDescription}
        action={add}
      />
    );
  } else {
    body = (
      <>
        {storage ? null : <InlineBanner tone="info">{FILES_TEXT.noStorage}</InlineBanner>}
        {files.length > 0 ? (
          <>
            <ul className="rounded-lg border border-line">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  projectId={project.id}
                  file={file}
                  actions={storage}
                  onGone={refresh}
                  onDelete={() => {
                    deleteFocus.remember();
                    setDeleting(file);
                  }}
                />
              ))}
            </ul>
            <p className="text-sm text-ink-secondary">{FILES_TEXT.whoDoesWhat}</p>
            {/* The two values the page already uses for "Ajanlar çalışamaz". */}
            <p className="text-sm text-ink-secondary">
              {project.agentsMayWork && !project.spendingLimitReached
                ? FILES_TEXT.agentsRead
                : FILES_TEXT.agentsDoNotRead}
            </p>
          </>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-4">
        {/* The heading takes the focus when the control that held it goes away: the row of a
            deleted file, the empty state's button after the first file was added. */}
        <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[0.9375rem] font-semibold">
          Dosyalar{' '}
          {list.data ? (
            <span className="font-normal text-ink-secondary tabular-nums">{files.length}</span>
          ) : null}
        </h3>
        {/* With no file the empty state carries the button: there is one "Dosya ekle". */}
        {files.length > 0 && storage ? add : null}
      </div>
      {body}
      {/* Mounted only while open: every opening starts empty. */}
      {adding ? (
        <AddFileDialog
          project={project}
          onClose={() => {
            setAdding(false);
          }}
          onStored={(stored) => {
            // The API has stored it: the row is there at once (newest first), before the dialog
            // closes, and the list is read again.
            queryClient.setQueryData<ProjectFileList>(key, (previous) =>
              previous
                ? {
                    ...previous,
                    files: [stored, ...previous.files.filter((file) => file.id !== stored.id)],
                  }
                : previous,
            );
            refresh();
          }}
          onChanged={refresh}
          onCloseAutoFocus={(event) => {
            addFocus.onCloseAutoFocus(event);
            // The control that opened the dialog is gone: the empty state's button, once the
            // first file was added.
            if (!event.defaultPrevented) {
              event.preventDefault();
              heading.current?.focus();
            }
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteFileDialog
          projectId={project.id}
          file={deleting}
          heading={heading}
          onClose={() => {
            setDeleting(null);
          }}
          onDeleted={() => {
            // The API has deleted it: the row goes at once, and the list is read again.
            const gone = deleting.id;
            queryClient.setQueryData<ProjectFileList>(key, (previous) =>
              previous
                ? { ...previous, files: previous.files.filter((file) => file.id !== gone) }
                : previous,
            );
            refresh();
          }}
          onRefused={refresh}
          onCloseAutoFocus={deleteFocus.onCloseAutoFocus}
        />
      ) : null}
    </section>
  );
}
