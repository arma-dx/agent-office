import { BUDGET_CURRENCIES, type BudgetCurrency, type ProjectDetail } from '@agent-office/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError, userMessage } from '@/lib/api';
import {
  budgetFormSchema,
  budgetOf,
  budgetValues,
  type BudgetFormValues,
} from '@/lib/projects/form';
import { projectKey, setProjectBudget } from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';

const LABEL = 'text-sm font-medium';
const HELP = 'text-sm text-ink-secondary';
const PROBLEM = 'text-sm text-destructive';
const FIELD = 'flex flex-col gap-1.5';

/** The three currencies by name; the code stands beside it, as it will on the page. */
const CURRENCY_NAME: Record<BudgetCurrency, string> = {
  TRY: 'Türk lirası (TRY)',
  USD: 'ABD doları (USD)',
  EUR: 'Avro (EUR)',
};

/**
 * "Proje bütçesi": the money of a project, an amount and a currency. The owner of the project,
 * its managers and the founder see it and change it (12 October 2026, decision 2); no passkey:
 * the budget is a record, not an approval. The currency is chosen with every amount and nothing
 * is chosen for the person (docs/SONRA.md P3-c).
 *
 * The description says what the panel does today and states no rule about what a budget
 * includes: the cost of AI is shown to the founder on the "Çalışmalar" tab and is not taken off
 * this amount (docs/SONRA.md P3-d).
 *
 * "Bütçeyi kaldır" sends at once, without a second question: the amount can be typed again, and
 * the audit log keeps the change. A refusal of the API is read in the dialog, and the project is
 * read again, so that the row goes away for a reader who has lost the right meanwhile.
 */
export function BudgetDialog({
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
  const id = useId();
  // The budget the form was filled from.
  const [opened] = useState(project.budget.visible ? project.budget.value : null);
  const form = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: budgetValues(opened),
  });
  const errors = form.formState.errors;

  const save = useMutation({
    mutationFn: (budget: ReturnType<typeof budgetOf> | null) =>
      setProjectBudget(company.companyId, project.id, budget),
    onSuccess: (updated) => {
      store(updated);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        void queryClient.invalidateQueries({
          queryKey: projectKey(company.companyId, project.id),
        });
      }
    },
  });

  const submit = form.handleSubmit((values) => {
    if (!save.isPending) save.mutate(budgetOf(values));
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent
        // A slip of the pointer beside the dialog would lose what was typed.
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          form.setFocus('amount');
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>Proje bütçesi</DialogTitle>
        <DialogDescription>
          Bütçe projenin parasıdır. Yapay zekâ harcaması bu tutardan düşülmüyor. Bütçeyi yalnızca
          projenin sahibi, yöneticileri ve kurucu görür ve değiştirir.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
          <div className={FIELD}>
            <label htmlFor={`${id}-amount`} className={LABEL}>
              Tutar
            </label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              className="w-56 tabular-nums"
              aria-required="true"
              aria-invalid={errors.amount !== undefined}
              aria-describedby={
                errors.amount ? `${id}-amount-help ${id}-amount-error` : `${id}-amount-help`
              }
              {...form.register('amount')}
            />
            {errors.amount ? (
              <p id={`${id}-amount-error`} role="alert" className={PROBLEM}>
                {errors.amount.message}
              </p>
            ) : null}
            <p id={`${id}-amount-help`} className={HELP}>
              Örnek: 125.000,50
            </p>
          </div>
          <div className={FIELD}>
            <label htmlFor={`${id}-currency`} className={LABEL}>
              Para birimi
            </label>
            <NativeSelect
              id={`${id}-currency`}
              className="w-56"
              aria-required="true"
              aria-invalid={errors.currency !== undefined}
              aria-describedby={errors.currency ? `${id}-currency-error` : undefined}
              {...form.register('currency')}
            >
              <option value="">Seçin</option>
              {BUDGET_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {CURRENCY_NAME[currency]}
                </option>
              ))}
            </NativeSelect>
            {errors.currency ? (
              <p id={`${id}-currency-error`} role="alert" className={PROBLEM}>
                {errors.currency.message}
              </p>
            ) : null}
          </div>
          {save.isError ? (
            <p role="alert" className={PROBLEM}>
              {userMessage(save.error)}
            </p>
          ) : null}
          <DialogFooter>
            {opened ? (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                {...busyProps(save.isPending)}
                onClick={() => {
                  if (!save.isPending) save.mutate(null);
                }}
              >
                Bütçeyi kaldır
              </Button>
            ) : null}
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
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
