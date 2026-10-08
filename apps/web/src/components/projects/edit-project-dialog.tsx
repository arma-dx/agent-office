import type { ProjectDetail } from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ProjectFields } from '@/components/projects/project-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError, userMessage } from '@/lib/api';
import {
  projectChanges,
  projectFormSchema,
  projectValues,
  type ProjectFormValues,
} from '@/lib/projects/form';
import {
  customersKey,
  customersQueryOptions,
  projectKey,
  updateProject,
} from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * "Projeyi düzenle": name, description, customer, status, colour and icon, target date, by a
 * member or the founder. Members and the AI permission are changed on the page, not here. Closing
 * and opening a project again is the status field: there is no other button, and nothing is ever
 * deleted.
 *
 * Only the fields that differ from the project are sent; with nothing changed the dialog closes
 * without a request. A customer added here starts with both contract permissions closed, for the
 * founder too. While the project's AI permission is open its customer cannot change (rule 12
 * reads which customer a project has): the customer is then text, with the sentence that says who
 * does what first.
 *
 * The form is filled once, from the project as it was when the dialog opened, and the fields that
 * differ are counted against that same project. The page may read the project again under the
 * open dialog (the person comes back to the tab, or a refusal asks for it): what another member
 * changed meanwhile is then not sent back as if this person had chosen the old values. Only
 * whether the customer is locked follows the project as it is now.
 */
export function EditProjectDialog({
  project,
  onClose,
  onCloseAutoFocus,
}: {
  project: ProjectDetail;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const isFounder = company.role === 'founder';
  // Made once: a send that is repeated names the same new customer.
  const [newCustomerId] = useState(() => crypto.randomUUID());
  // The project the form was filled from.
  const [opened] = useState(project);
  const customers = useQuery(customersQueryOptions(company.companyId));
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: projectValues(opened),
  });

  const save = useMutation({
    mutationFn: (changes: NonNullable<ReturnType<typeof projectChanges>>) =>
      updateProject(company.companyId, project.id, changes),
    onSuccess: (updated) => {
      store(updated);
      onClose();
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      if (error.code === 'customer_exists') {
        // The name is the person's to change: the sentence stands under it, with the focus.
        form.setError('customerName', { message: error.message }, { shouldFocus: true });
        void queryClient.invalidateQueries({ queryKey: customersKey(company.companyId) });
      } else if (error.code === 'customer_not_found') {
        // The list the choice came from is stale: it is read again, and a customer that is gone
        // gives way to the one the form was opened with.
        form.setValue('customerChoice', projectValues(opened).customerChoice);
        void queryClient.invalidateQueries({ queryKey: customersKey(company.companyId) });
      } else if (error.code === 'project_customer_locked') {
        // The permission was opened while the dialog stood open: the project is read again and
        // the dialog shows the customer as text.
        void queryClient.invalidateQueries({
          queryKey: projectKey(company.companyId, project.id),
        });
      }
    },
  });
  const fieldError = save.error instanceof ApiError && save.error.code === 'customer_exists';

  const submit = form.handleSubmit((values) => {
    if (save.isPending) return;
    const changes = projectChanges(
      { ...opened, aiAllowed: project.aiAllowed },
      values,
      newCustomerId,
    );
    if (changes === null) {
      onClose();
      return;
    }
    save.mutate(changes);
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
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
        <DialogTitle>Projeyi düzenle</DialogTitle>
        <DialogDescription>
          Üyeler ve yapay zekâ izni proje sayfasından değiştirilir.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <ProjectFields
            form={form}
            customers={{ list: customers.data ?? [], failed: customers.isError }}
            // The select always offers the customer the form was filled with.
            currentCustomer={opened.customer}
            closingNote
            {...(project.aiAllowed
              ? {
                  lockedCustomer: {
                    name: project.customer?.name ?? null,
                    sentence: isFounder
                      ? 'Yapay zekâ izni açıkken müşteri değiştirilemez. Önce proje sayfasından izni kapatın; müşteriyi değiştirdikten sonra izni yeniden açabilirsiniz.'
                      : 'Yapay zekâ izni açıkken müşteri değiştirilemez. Kurucunun önce izni kapatması gerekir.',
                  },
                }
              : {})}
            customerNote={({ isNew }) =>
              isNew ? (
                <p className="text-sm text-ink-secondary">
                  {isFounder
                    ? 'Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri proje sayfasından işaretleyebilirsiniz.'
                    : 'Yeni müşterinin sözleşme izinleri kapalı başlar. İzinleri kurucu işaretler.'}
                </p>
              ) : null
            }
          />
          {save.isError && !fieldError ? (
            <p role="alert" className="text-sm text-destructive">
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
              {save.isPending ? 'Kaydediliyor' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
