import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  PROJECT_STATUSES,
  isClosedProjectStatus,
  type CustomerOption,
  type GithubRepositories,
} from '@agent-office/shared';
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { REPOSITORY_FIELD } from '@/lib/github/labels';
import {
  NEW_CUSTOMER,
  NO_CUSTOMER,
  NO_REPOSITORY,
  type ProjectFormValues,
} from '@/lib/projects/form';
import { COLOR_NAME, ICON_NAME, PROJECT_FILL, PROJECT_ICON } from '@/lib/projects/labels';
import { PROJECT_STATUS } from '@/lib/status';
import { cn } from '@/lib/utils';

const LABEL = 'text-sm font-medium';
const HELP = 'text-sm text-ink-secondary';
const PROBLEM = 'text-sm text-destructive';
const FIELD = 'flex flex-col gap-1.5';
// The keyboard ring of a radio that is hidden behind its mark is drawn on the mark.
const MARK_RING =
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring';

const byName = new Intl.Collator('tr');

/** The ids of a field's help text and error, as one aria-describedby value. */
function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

/**
 * The customer of the project (8 October 2026, decision 16): none, one of the company's customers
 * by name, or a new one by name. Choosing "Yeni müşteri ekle" does not move the focus: a native
 * select fires `change` while a keyboard user walks its options, and a focus that jumped would
 * take them out of the select on the way past. The help text says where the name goes instead,
 * and the name field is the next Tab stop.
 */
function CustomerFields({
  form,
  customers,
  current,
  children,
}: {
  form: UseFormReturn<ProjectFormValues>;
  customers: { list: readonly CustomerOption[]; failed: boolean };
  /** The customer the project has now: always offered, whatever the list says. */
  current: { id: string; name: string } | null;
  /** What is said or offered under the name of a new customer. */
  children?: (choice: { isNew: boolean; existing: CustomerOption | null }) => ReactNode;
}) {
  const id = useId();
  const choice = useWatch({ control: form.control, name: 'customerChoice' });
  const nameError = form.formState.errors.customerName?.message;
  const options = [...customers.list];
  if (current && !options.some((customer) => customer.id === current.id)) {
    options.push({ ...current, aiAllowed: null, automatedProcessingAllowed: null });
  }
  options.sort((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id));
  const isNew = choice === NEW_CUSTOMER;
  const existing = options.find((customer) => customer.id === choice) ?? null;
  return (
    <>
      <div className={FIELD}>
        <label htmlFor={`${id}-choice`} className={LABEL}>
          Müşteri
        </label>
        <NativeSelect
          id={`${id}-choice`}
          aria-describedby={describedBy(`${id}-help`, customers.failed && `${id}-failed`)}
          {...form.register('customerChoice')}
        >
          <option value={NO_CUSTOMER}>Müşteri yok</option>
          {options.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
          <option value={NEW_CUSTOMER}>Yeni müşteri ekle</option>
        </NativeSelect>
        <p id={`${id}-help`} className={HELP}>
          {isNew ? 'İsteğe bağlı. Müşteri adını aşağıya yazın.' : 'İsteğe bağlı.'}
        </p>
        {customers.failed ? (
          <p id={`${id}-failed`} role="alert" className={PROBLEM}>
            Müşteri listesi alınamadı. Müşteriyi sonra proje sayfasından seçebilirsiniz.
          </p>
        ) : null}
      </div>
      {isNew ? (
        <div className={FIELD}>
          <label htmlFor={`${id}-name`} className={LABEL}>
            Müşteri adı
          </label>
          <Input
            id={`${id}-name`}
            aria-required="true"
            aria-invalid={nameError !== undefined}
            aria-describedby={describedBy(nameError !== undefined && `${id}-name-error`)}
            {...form.register('customerName')}
          />
          {nameError !== undefined ? (
            <p id={`${id}-name-error`} role="alert" className={PROBLEM}>
              {nameError}
            </p>
          ) : null}
        </div>
      ) : null}
      {children?.({ isNew, existing })}
    </>
  );
}

/**
 * The GitHub repository of a new project (8 October 2026, decision 19): optional, one of the
 * repositories of the organisation the company is connected to. Drawn only while the API offers
 * the list. Every repository is listed by its name and by nothing beside it (12 October decision
 * 15; docs/SONRA.md P5-w); a long organisation makes a long select (P5-u).
 */
export function RepositoryField({
  form,
  list,
}: {
  form: UseFormReturn<ProjectFormValues>;
  list: Extract<GithubRepositories, { state: 'ok' }>;
}) {
  const id = useId();
  return (
    <div className={FIELD}>
      <label htmlFor={`${id}-repository`} className={LABEL}>
        {REPOSITORY_FIELD.label}
      </label>
      <NativeSelect
        id={`${id}-repository`}
        aria-describedby={describedBy(`${id}-help`, list.truncated && `${id}-truncated`)}
        {...form.register('repositoryId')}
      >
        <option value={NO_REPOSITORY}>{REPOSITORY_FIELD.none}</option>
        {list.repositories.map((repository) => (
          <option key={repository.id} value={String(repository.id)}>
            {repository.fullName}
          </option>
        ))}
      </NativeSelect>
      <p id={`${id}-help`} className={HELP}>
        {REPOSITORY_FIELD.help}
      </p>
      {list.truncated ? (
        <p id={`${id}-truncated`} className={HELP}>
          {REPOSITORY_FIELD.truncated}
        </p>
      ) : null}
    </div>
  );
}

/** A contract permission of a customer that is added with the project; the founder's to mark. */
export function ContractSwitch({
  form,
  name,
  label,
  help,
}: {
  form: UseFormReturn<ProjectFormValues>;
  name: 'customerAiAllowed' | 'customerAutomatedAllowed';
  label: string;
  help: string;
}) {
  const id = useId();
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className="flex items-start gap-3">
          <Switch
            id={id}
            className="mt-0.5"
            aria-describedby={`${id}-help`}
            name={field.name}
            ref={field.ref}
            checked={field.value}
            onBlur={field.onBlur}
            onCheckedChange={field.onChange}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <label htmlFor={id} className={LABEL}>
              {label}
            </label>
            <p id={`${id}-help`} className={HELP}>
              {help}
            </p>
          </div>
        </div>
      )}
    />
  );
}

/**
 * One choice out of a small fixed set, as native radios: the arrow keys move inside the group and
 * Tab leaves it. Each option is a label that holds the radio (hidden, named in Turkish) and the
 * mark a person sees. The chosen one is told by a sign on the mark and by the words "Seçili: ...",
 * never by colour alone; the label's title names the mark for a person who sees it and cannot
 * tell two apart.
 */
function ChoiceGroup<T extends string>({
  legend,
  name,
  options,
  nameOf,
  value,
  onChange,
  mark,
}: {
  legend: string;
  name: string;
  options: readonly T[];
  nameOf: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  mark: (option: T, checked: boolean) => ReactNode;
}) {
  const legendId = useId();
  return (
    <fieldset role="radiogroup" aria-labelledby={legendId} className="min-w-0">
      {/* Floated, so that the name of the choice stands beside it on one line. */}
      <legend id={legendId} className={cn(LABEL, 'float-left mr-2')}>
        {legend}
      </legend>
      {/* The visible name of the choice; a screen reader hears it from the checked radio. */}
      <span aria-hidden="true" className={HELP}>
        Seçili: {nameOf[value]}
      </span>
      <div className="clear-left flex flex-wrap gap-2 pt-1.5">
        {options.map((option) => (
          <label key={option} title={nameOf[option]} className="relative">
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={option}
              aria-label={nameOf[option]}
              checked={option === value}
              onChange={() => {
                onChange(option);
              }}
            />
            {mark(option, option === value)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The fields "Yeni proje" and "Projeyi düzenle" share: name, description, customer, status, colour
 * and icon, target date. Every error stands under its field as an alert and is tied to it; the
 * first field that is wrong takes the focus when the form is sent (react-hook-form does that).
 */
export function ProjectFields({
  form,
  customers,
  currentCustomer = null,
  lockedCustomer,
  customerNote,
  afterCustomer,
  closingNote = false,
}: {
  form: UseFormReturn<ProjectFormValues>;
  customers: { list: readonly CustomerOption[]; failed: boolean };
  currentCustomer?: { id: string; name: string } | null;
  /**
   * Set while the customer cannot change (the project's AI permission is open): the customer is
   * shown as text with this sentence, and no customer field is drawn.
   */
  lockedCustomer?: { name: string | null; sentence: string };
  customerNote?: (choice: { isNew: boolean; existing: CustomerOption | null }) => ReactNode;
  /** Fields that stand between the customer and the status (the members of a new project). */
  afterCustomer?: ReactNode;
  /** Say under the status that "Tamamlandı" and "İptal" close the project. */
  closingNote?: boolean;
}) {
  const id = useId();
  const errors = form.formState.errors;
  const status = useWatch({ control: form.control, name: 'status' });
  return (
    <>
      <div className={FIELD}>
        <label htmlFor={`${id}-name`} className={LABEL}>
          Proje adı
        </label>
        <Input
          id={`${id}-name`}
          aria-required="true"
          aria-invalid={errors.name !== undefined}
          aria-describedby={describedBy(errors.name && `${id}-name-error`)}
          {...form.register('name')}
        />
        {errors.name ? (
          <p id={`${id}-name-error`} role="alert" className={PROBLEM}>
            {errors.name.message}
          </p>
        ) : null}
      </div>

      <div className={FIELD}>
        <label htmlFor={`${id}-description`} className={LABEL}>
          Açıklama
        </label>
        <Textarea
          id={`${id}-description`}
          rows={3}
          className="max-h-60"
          aria-invalid={errors.description !== undefined}
          aria-describedby={describedBy(
            `${id}-description-help`,
            errors.description && `${id}-description-error`,
          )}
          {...form.register('description')}
        />
        {errors.description ? (
          <p id={`${id}-description-error`} role="alert" className={PROBLEM}>
            {errors.description.message}
          </p>
        ) : null}
        <p id={`${id}-description-help`} className={HELP}>
          İsteğe bağlı. Projenin ne olduğunu kısaca yazın.
        </p>
      </div>

      {lockedCustomer ? (
        <div className={FIELD}>
          <span className={LABEL}>Müşteri</span>
          <p className="text-sm">{lockedCustomer.name ?? 'Müşteri yok'}</p>
          <p className={HELP}>{lockedCustomer.sentence}</p>
        </div>
      ) : (
        <CustomerFields form={form} customers={customers} current={currentCustomer}>
          {customerNote}
        </CustomerFields>
      )}

      {afterCustomer}

      <div className={FIELD}>
        <label htmlFor={`${id}-status`} className={LABEL}>
          Durum
        </label>
        <NativeSelect
          id={`${id}-status`}
          aria-describedby={describedBy(
            closingNote && isClosedProjectStatus(status) && `${id}-status-help`,
          )}
          {...form.register('status')}
        >
          {PROJECT_STATUSES.map((option) => (
            <option key={option} value={option}>
              {PROJECT_STATUS[option].label}
            </option>
          ))}
        </NativeSelect>
        {closingNote && isClosedProjectStatus(status) ? (
          <p id={`${id}-status-help`} className={HELP}>
            Tamamlandı ve İptal projeyi kapatır; proje silinmez ve yeniden açılabilir.
          </p>
        ) : null}
      </div>

      <Controller
        control={form.control}
        name="color"
        render={({ field }) => (
          <ChoiceGroup
            legend="Renk"
            name={field.name}
            options={PROJECT_COLORS}
            nameOf={COLOR_NAME}
            value={field.value}
            onChange={field.onChange}
            mark={(color, checked) => (
              // The swatch keeps its fill when the system replaces colours (Windows high
              // contrast): eight empty squares would be no choice at all.
              <span
                className={cn(
                  'flex size-7 forced-color-adjust-none items-center justify-center rounded-md text-surface',
                  PROJECT_FILL[color],
                  MARK_RING,
                )}
              >
                {checked ? <Check aria-hidden="true" className="size-4" /> : null}
              </span>
            )}
          />
        )}
      />

      <Controller
        control={form.control}
        name="icon"
        render={({ field }) => (
          <ChoiceGroup
            legend="Simge"
            name={field.name}
            options={PROJECT_ICONS}
            nameOf={ICON_NAME}
            value={field.value}
            onChange={field.onChange}
            mark={(icon, checked) => {
              const Icon = PROJECT_ICON[icon];
              return (
                <span
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg border',
                    checked ? 'border-brand bg-row-hover' : 'border-line',
                    MARK_RING,
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </span>
              );
            }}
          />
        )}
      />

      <div className={FIELD}>
        <label htmlFor={`${id}-date`} className={LABEL}>
          Hedef tarih
        </label>
        <Input
          id={`${id}-date`}
          type="date"
          className="w-44"
          aria-invalid={errors.targetDate !== undefined}
          aria-describedby={describedBy(`${id}-date-help`, errors.targetDate && `${id}-date-error`)}
          {...form.register('targetDate')}
        />
        {errors.targetDate ? (
          <p id={`${id}-date-error`} role="alert" className={PROBLEM}>
            {errors.targetDate.message}
          </p>
        ) : null}
        <p id={`${id}-date-help`} className={HELP}>
          İsteğe bağlı.
        </p>
      </div>
    </>
  );
}
