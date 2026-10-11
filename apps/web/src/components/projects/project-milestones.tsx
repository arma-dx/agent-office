import {
  MILESTONE_MAX,
  sortedMilestones,
  type Milestone,
  type ProjectDetail,
} from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { MilestoneDialog } from '@/components/projects/milestone-dialog';
import { EmptyState } from '@/components/states';
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
import { formatDay } from '@/lib/dates';
import { useReturnFocus } from '@/lib/focus';
import { notifyError } from '@/lib/notify';
import { projectKey, removeMilestone, updateMilestone } from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * One milestone: the checkbox that says whether it is reached, its name, its day and, for a
 * reader who may change the project, the two buttons. The checkbox never moves by the click: it
 * shows the saved value, is marked busy while its request is on its way (a second click does
 * nothing then) and moves with the answer. The line through the name of a reached milestone only
 * repeats what the tick says.
 */
function MilestoneRow({
  project,
  milestone,
  mayEdit,
  onEdit,
  onRemove,
}: {
  project: ProjectDetail;
  milestone: Milestone;
  mayEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const tick = useMutation({
    mutationFn: (done: boolean) =>
      updateMilestone(company.companyId, project.id, milestone.id, { done }),
    onSuccess: store,
    onError: (error) => {
      notifyError(error);
      // Somebody removed it meanwhile: the list on the page is not the project's any more.
      if (error instanceof ApiError && error.code === 'milestone_not_found') {
        void queryClient.invalidateQueries({
          queryKey: projectKey(company.companyId, project.id),
        });
      }
    },
  });
  return (
    <li className="flex min-h-9 items-center gap-3 border-b border-line px-2 last:border-b-0">
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-(--brand)"
        aria-label={`${milestone.name}: tamamlandı`}
        aria-busy={tick.isPending || undefined}
        checked={milestone.done}
        disabled={!mayEdit}
        onChange={(event) => {
          if (!tick.isPending) tick.mutate(event.target.checked);
        }}
      />
      <span
        dir="auto"
        className={
          milestone.done
            ? 'min-w-0 flex-1 truncate text-sm text-ink-secondary line-through'
            : 'min-w-0 flex-1 truncate text-sm'
        }
      >
        {milestone.name}
      </span>
      <span className="w-28 shrink-0 text-right text-sm text-ink-secondary tabular-nums">
        {milestone.date ? (
          <time dateTime={milestone.date}>{formatDay(milestone.date)}</time>
        ) : (
          'Tarih yok'
        )}
      </span>
      {mayEdit ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${milestone.name}: düzenle`}
            onClick={onEdit}
          >
            Düzenle
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${milestone.name}: sil`}
            onClick={onRemove}
          >
            Sil
          </Button>
        </>
      ) : null}
    </li>
  );
}

/**
 * Removes a milestone after a plain confirmation; the safe button has the focus. The dialog
 * cannot be closed while its request is on its way.
 */
function RemoveMilestoneDialog({
  project,
  milestone,
  onClose,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  milestone: Milestone;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const store = useStoreProject(company.companyId);
  const remove = useMutation({
    mutationFn: () => removeMilestone(company.companyId, project.id, milestone.id),
    onSuccess: (updated) => {
      store(updated);
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
        <AlertDialogTitle>&quot;{milestone.name}&quot; silinsin mi?</AlertDialogTitle>
        <AlertDialogDescription>
          Kilometre taşı listeden kalkar. Bu işlem geri alınamaz.
        </AlertDialogDescription>
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
            Sil
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The dialog that is open: a new milestone, or one of the list that is changed or removed. */
type Asked = { kind: 'add' } | { kind: 'edit' | 'remove'; milestone: Milestone };

/**
 * The "Kilometre taşları" tab of a project's page (8 October 2026, decision 17): the important
 * steps of the project, each a name, an optional day and whether it is reached, sorted by day
 * with the ones without a day last. Every member of the project and the founder keep the list,
 * as they keep the other fields of the project (docs/SONRA.md P3-f); a project holds at most 50.
 *
 * The list is the project's own answer: there is no query of its own, and every change answers
 * the whole project, which the page then shows. A change somebody else made shows when the
 * project is read again, like the rest of the page.
 *
 * The focus: a dialog that is given up returns it to the button that opened it. When that button
 * is gone (the row was removed, or the first milestone replaced the empty screen and its button)
 * it goes to "Kilometre taşı ekle", and to the list when the list is full and has no such button.
 */
export function ProjectMilestones({ project }: { project: ProjectDetail }): ReactNode {
  const mayEdit = project.actions.edit;
  const milestones = sortedMilestones(project.milestones);
  const [asked, setAsked] = useState<Asked | null>(null);
  const opener = useReturnFocus();
  const addButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const ask = (next: Asked) => {
    opener.remember();
    setAsked(next);
  };
  const close = () => {
    setAsked(null);
  };
  const returnFocus = (event: Event) => {
    opener.onCloseAutoFocus(event);
    if (event.defaultPrevented) return;
    const next = addButton.current ?? list.current;
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  // One button, in one of two places: under the empty screen's sentence, or above the list.
  const add = mayEdit ? (
    <Button
      ref={addButton}
      onClick={() => {
        ask({ kind: 'add' });
      }}
    >
      Kilometre taşı ekle
    </Button>
  ) : null;

  let dialog: ReactNode = null;
  if (asked?.kind === 'add') {
    dialog = <MilestoneDialog project={project} onClose={close} onCloseAutoFocus={returnFocus} />;
  } else if (asked?.kind === 'edit') {
    dialog = (
      <MilestoneDialog
        project={project}
        milestone={asked.milestone}
        onClose={close}
        onCloseAutoFocus={returnFocus}
      />
    );
  } else if (asked?.kind === 'remove') {
    dialog = (
      <RemoveMilestoneDialog
        project={project}
        milestone={asked.milestone}
        onClose={close}
        onCloseAutoFocus={returnFocus}
      />
    );
  }

  const done = milestones.filter((milestone) => milestone.done).length;
  const full = milestones.length >= MILESTONE_MAX;
  // The dialog keeps its place whatever stands above it: a list that empties or fills under an
  // open dialog (the project was read again) does not throw away what was typed.
  return (
    <div className="flex flex-col gap-3">
      {milestones.length === 0 ? (
        <EmptyState
          title="Bu projede henüz kilometre taşı yok"
          description={
            mayEdit
              ? 'Projenin önemli adımlarını adı ve tarihiyle ekleyin; tamamlananı işaretleyin.'
              : 'Kilometre taşlarını proje üyeleri ekler.'
          }
          action={add ?? undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex min-h-8 items-center justify-between gap-4">
            <p className="text-sm text-ink-secondary tabular-nums">
              Tamamlanan: {done} / {milestones.length}
            </p>
            {full && mayEdit ? (
              <p className="text-sm text-ink-secondary">
                Bir projede en çok 50 kilometre taşı olabilir.
              </p>
            ) : (
              add
            )}
          </div>
          <ul
            ref={list}
            tabIndex={-1}
            aria-label="Kilometre taşları"
            className="rounded-lg border border-line outline-none focus-visible:outline-2 focus-visible:outline-ring"
          >
            {milestones.map((milestone) => (
              <MilestoneRow
                key={milestone.id}
                project={project}
                milestone={milestone}
                mayEdit={mayEdit}
                onEdit={() => {
                  ask({ kind: 'edit', milestone });
                }}
                onRemove={() => {
                  ask({ kind: 'remove', milestone });
                }}
              />
            ))}
          </ul>
        </div>
      )}
      {dialog}
    </div>
  );
}
