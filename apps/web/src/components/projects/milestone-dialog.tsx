import type { Milestone, ProjectDetail, UpdateMilestone } from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, userMessage } from '@/lib/api';
import { milestoneFormSchema, type MilestoneFormValues } from '@/lib/projects/form';
import { addMilestone, projectKey, updateMilestone } from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

const LABEL = 'text-sm font-medium';
const HELP = 'text-sm text-ink-secondary';
const PROBLEM = 'text-sm text-destructive';
const FIELD = 'flex flex-col gap-1.5';

/** The API's answers that say the list on the page is not the project's any more. */
const STALE_LIST = new Set(['milestone_limit', 'milestone_not_found', 'not_found']);

/**
 * "Kilometre taşı ekle" and "Kilometre taşını düzenle" (8 October 2026, decision 17): a name and
 * an optional day. The day is information only: nothing warns when it has passed (docs/SONRA.md
 * P3-e). Whether a milestone is done is not in this dialog; it is the checkbox of its row.
 *
 * An add carries an id made when the dialog opens, so a send that is repeated adds one entry. A
 * change sends only the fields that differ from the milestone the dialog was opened with; with
 * nothing changed it closes without a request. The dialog cannot be closed while its request is on
 * its way. A refusal of the API is read in the dialog; when it says that the list has changed
 * (the entry was removed, the list is full) the project is read again.
 */
export function MilestoneDialog({
  project,
  milestone,
  onClose,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  /** The milestone to change; absent for a new one. */
  milestone?: Milestone;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const id = useId();
  // Made once: a send that is repeated names the same new milestone.
  const [newId] = useState(() => crypto.randomUUID());
  // The milestone the form was filled from.
  const [opened] = useState(milestone);
  const form = useForm<MilestoneFormValues>({
    resolver: zodResolver(milestoneFormSchema),
    defaultValues: { name: opened?.name ?? '', date: opened?.date ?? '' },
  });
  const errors = form.formState.errors;

  const save = useMutation({
    mutationFn: (send: () => Promise<ProjectDetail>) => send(),
    onSuccess: (updated) => {
      store(updated);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code !== undefined && STALE_LIST.has(error.code)) {
        void queryClient.invalidateQueries({
          queryKey: projectKey(company.companyId, project.id),
        });
      }
    },
  });

  const submit = form.handleSubmit((values) => {
    if (save.isPending) return;
    const day = values.date || null;
    if (!opened) {
      save.mutate(() =>
        addMilestone(company.companyId, project.id, { id: newId, name: values.name, date: day }),
      );
      return;
    }
    const changes: UpdateMilestone = {
      ...(values.name !== opened.name ? { name: values.name } : {}),
      ...(day !== opened.date ? { date: day } : {}),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    save.mutate(() => updateMilestone(company.companyId, project.id, opened.id, changes));
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        // The dialog says everything in its title and its fields.
        aria-describedby={undefined}
        // A slip of the pointer beside the dialog would lose what was typed.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          form.setFocus('name');
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>{opened ? 'Kilometre taşını düzenle' : 'Kilometre taşı ekle'}</DialogTitle>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <div className={FIELD}>
            <label htmlFor={`${id}-name`} className={LABEL}>
              Ad
            </label>
            <Input
              id={`${id}-name`}
              aria-required="true"
              aria-invalid={errors.name !== undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              {...form.register('name')}
            />
            {errors.name ? (
              <p id={`${id}-name-error`} role="alert" className={PROBLEM}>
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <div className={FIELD}>
            <label htmlFor={`${id}-date`} className={LABEL}>
              Tarih
            </label>
            <Input
              id={`${id}-date`}
              type="date"
              className="w-44"
              aria-invalid={errors.date !== undefined}
              aria-describedby={
                errors.date ? `${id}-date-help ${id}-date-error` : `${id}-date-help`
              }
              {...form.register('date')}
            />
            {errors.date ? (
              <p id={`${id}-date-error`} role="alert" className={PROBLEM}>
                {errors.date.message}
              </p>
            ) : null}
            <p id={`${id}-date-help`} className={HELP}>
              İsteğe bağlı. Tarih yalnızca bilgidir; günü geçince uyarı çıkmaz.
            </p>
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
              {opened ? 'Kaydet' : 'Ekle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
