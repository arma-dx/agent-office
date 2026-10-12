import {
  PROJECT_FILE_ACCEPT,
  projectFileNameSchema,
  projectFileProblem,
  projectFileTypeOf,
  type ProjectDetail,
  type ProjectFile,
} from '@agent-office/shared';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { InlineBanner } from '@/components/inline-banner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { userMessage } from '@/lib/api';
import {
  FILE_DIALOG_TEXT,
  FILE_PROBLEM,
  FILE_TYPES_SENTENCE,
  fileFactsLine,
  uploadProjectFile,
  type FileUpload,
} from '@/lib/projects/files';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/** The kind and the size of a file that can be sent, as its row will write them. */
function chosenFacts(file: File): string | null {
  const name = projectFileNameSchema.safeParse(file.name);
  const type = name.success ? projectFileTypeOf(name.data) : null;
  return type ? fileFactsLine({ kind: type.kind, sizeBytes: file.size }) : null;
}

/**
 * "Dosya ekle": sends one file to a project (8 October 2026, decisions 11 and 20). Mounted only
 * while open, so every opening starts empty.
 *
 * What the panel can tell before sending (the name, the type by the extension, an empty file, one
 * over 25 MB) is said at once, in the API's own words for the same refusal; the API decides again
 * and reads the bytes. Nothing is shown as added before the API has stored it.
 *
 * The file gets an id when it is chosen and keeps it for every retry: the API answers a file it
 * already stored with the first record. Another choice is another id.
 *
 * While the bytes are on their way the dialog does not close (Escape, a click outside); "Yüklemeyi
 * durdur" stops the send and leaves the dialog open with the file still chosen. Leaving the page
 * stops it too. After a stop and after a refusal the list is read again: bytes that had all left
 * may have been stored.
 *
 * Two sentences are rules: no file with personal data until the lawyer has answered (decision 21),
 * and that agents will read the files of a project whose AI permission is open (11 October
 * decision 3). The first is part of the file field's description, because the dialog opens with
 * the focus on that field and a screen reader reads a field's description with it.
 */
export function AddFileDialog({
  project,
  onClose,
  onStored,
  onChanged,
  onCloseAutoFocus,
}: {
  project: Pick<ProjectDetail, 'id' | 'name'>;
  onClose: () => void;
  /** The API has stored the file; called before the dialog closes. */
  onStored: (file: ProjectFile) => void;
  /** The list must be read again: a send was stopped or refused, and a file may have been stored. */
  onChanged: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactNode {
  const company = useCompany();
  const id = useId();
  const inputId = `${id}-file`;
  const warningId = `${id}-warning`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const [file, setFile] = useState<File | null>(null);
  // A new id with every choice, the same id for every retry of the same file.
  const [fileId, setFileId] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<'idle' | 'sending' | 'storing'>('idle');
  const [fraction, setFraction] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);
  const upload = useRef<FileUpload | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Leaving the page stops the upload.
  useEffect(
    () => () => {
      upload.current?.abort();
    },
    [],
  );

  const problem = file ? projectFileProblem(file) : null;
  const refused = problem !== null || (missing && file === null);
  const facts = file && problem === null ? chosenFacts(file) : null;
  const percent = Math.min(100, Math.round(fraction * 100));

  function choose(next: File | null) {
    setFile(next);
    setFileId(crypto.randomUUID());
    setError(null);
    setMissing(false);
  }

  function start() {
    if (phase !== 'idle') return;
    if (file === null) {
      setMissing(true);
      input.current?.focus();
      return;
    }
    if (problem !== null) {
      // Its sentence is already shown.
      input.current?.focus();
      return;
    }
    setError(null);
    setFraction(0);
    setPhase('sending');
    const sent = uploadProjectFile({
      companyId: company.companyId,
      projectId: project.id,
      fileId,
      file,
      onProgress: (value) => {
        if (upload.current !== sent) return;
        setFraction(value);
        if (value >= 1) setPhase('storing');
      },
    });
    upload.current = sent;
    sent.done.then(
      (stored) => {
        if (upload.current !== sent) return;
        upload.current = null;
        toast.success(`${stored.name} eklendi.`);
        onStored(stored);
        onClose();
      },
      (reason: unknown) => {
        if (upload.current !== sent) return;
        upload.current = null;
        setPhase('idle');
        // Stopped by the person: no sentence. Anything else is said, and the file stays chosen.
        const stopped = reason instanceof DOMException && reason.name === 'AbortError';
        if (!stopped) setError(reason);
        // Bytes that were all sent may have been stored; a closed session shows itself there.
        onChanged();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && phase === 'idle') onClose();
      }}
    >
      <DialogContent
        // A slip of the pointer beside the dialog would lose the choice, or an upload under way.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>Dosya ekle</DialogTitle>
        <DialogDescription>
          {project.name} projesine bir dosya ekleyin. Dosyayı proje üyeleri ve kurucu görür.{' '}
          {FILE_DIALOG_TEXT.agentsWillRead}
        </DialogDescription>
        {/* InlineBanner takes no id; the wrapper is what the file field is described by. */}
        <div id={warningId}>
          <InlineBanner tone="warning" compact>
            {FILE_DIALOG_TEXT.personalData}
          </InlineBanner>
        </div>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-medium">
              Dosya
            </label>
            <input
              ref={input}
              id={inputId}
              type="file"
              accept={PROJECT_FILE_ACCEPT}
              // The one control that is disabled while busy: the focus is on a button then.
              disabled={phase !== 'idle'}
              aria-invalid={refused}
              aria-describedby={
                refused ? `${warningId} ${helpId} ${errorId}` : `${warningId} ${helpId}`
              }
              className="text-sm"
              onChange={(event) => {
                choose(event.target.files?.[0] ?? null);
              }}
            />
            <p id={helpId} className="text-sm text-ink-secondary">
              {FILE_TYPES_SENTENCE} {FILE_DIALOG_TEXT.sizeLimit}
            </p>
            {facts ? <p className="text-sm text-ink-secondary tabular-nums">{facts}</p> : null}
            {refused ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {problem !== null ? FILE_PROBLEM[problem] : FILE_DIALOG_TEXT.chooseFirst}
              </p>
            ) : null}
          </div>
          {phase !== 'idle' ? (
            <div className="flex flex-col gap-1">
              {/* A native bar: a progress bar to a screen reader as it is, and it moves only
                  because the person's file is leaving. */}
              <progress
                className="h-2 w-full accent-brand"
                max={100}
                value={percent}
                aria-label="Yükleme"
              />
              {/* For the eye. A screen reader has the bar's value and the live sentence below, so
                  this line is not read a second time. */}
              <p aria-hidden="true" className="text-sm text-ink-secondary tabular-nums">
                {phase === 'storing' ? FILE_DIALOG_TEXT.stored : `Yükleniyor: %${String(percent)}`}
              </p>
              {/* The percent is not in the live region: a screen reader hears two sentences,
                  not every number. */}
              <span role="status" className="sr-only">
                {phase === 'storing'
                  ? FILE_DIALOG_TEXT.stored
                  : FILE_DIALOG_TEXT.sendingForScreenReader}
              </span>
            </div>
          ) : null}
          {error !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (phase === 'idle') onClose();
                else upload.current?.abort();
              }}
            >
              {phase === 'idle' ? 'Vazgeç' : 'Yüklemeyi durdur'}
            </Button>
            <Button type="submit" size="lg" {...busyProps(phase !== 'idle')}>
              {phase === 'sending' ? 'Yükleniyor' : phase === 'storing' ? 'Kaydediliyor' : 'Yükle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
