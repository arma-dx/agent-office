import {
  CUSTOMER_NAME_MAX,
  DEFAULT_PROJECT_COLOR,
  DEFAULT_PROJECT_ICON,
  DEFAULT_PROJECT_STATUS,
  hasHiddenCharacter,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_MEMBER_MAX,
  PROJECT_NAME_MAX,
  projectColorSchema,
  projectDaySchema,
  projectIconSchema,
  projectStatusSchema,
  type CreateProject,
  type ProjectDetail,
  type UpdateProject,
} from '@agent-office/shared';
import { z } from 'zod';

/**
 * The form of a project, shared by "Yeni proje" and "Projeyi düzenle": what the person fills in,
 * the sentence for each thing that is wrong with it, and the bodies the two dialogs send. The
 * limits are the shared contract's; the form says them in Turkish before anything is sent.
 *
 * There is no value for the AI permission of the project: no dialog sets it. The two contract
 * permissions exist only for a customer the founder adds with a new project.
 */

/** The values of the customer select that are not a customer's id. */
export const NO_CUSTOMER = '';
export const NEW_CUSTOMER = 'new';

export const projectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Proje adını yazın.')
      .max(PROJECT_NAME_MAX, 'Proje adı en çok 120 karakter olabilir.')
      .refine((name) => !hasHiddenCharacter(name), {
        message: 'Proje adı görünmeyen karakter içeremez. Adı yeniden yazın.',
      }),
    description: z
      .string()
      .max(PROJECT_DESCRIPTION_MAX, 'Açıklama en çok 5.000 karakter olabilir.')
      // A text box cannot hold it by typing; a paste could. The database cannot store it.
      .refine((text) => !text.includes('\u0000'), {
        message: 'Açıklama okunamayan bir karakter içeriyor. Metni yeniden yazın.',
      }),
    // NO_CUSTOMER, NEW_CUSTOMER or the id of a customer of the company.
    customerChoice: z.string(),
    // Read only while NEW_CUSTOMER is chosen.
    customerName: z.string(),
    customerAiAllowed: z.boolean(),
    customerAutomatedAllowed: z.boolean(),
    // The people checked besides the opener ("Yeni proje" only).
    memberIds: z
      .array(z.uuid())
      .max(PROJECT_MEMBER_MAX, 'Açan kişiden başka en çok 50 üye seçebilirsiniz.'),
    status: projectStatusSchema,
    color: projectColorSchema,
    icon: projectIconSchema,
    // Empty, or a day as a date field gives it (YYYY-MM-DD).
    targetDate: z.string().refine((day) => day === '' || projectDaySchema.safeParse(day).success, {
      message: 'Geçerli bir tarih seçin.',
    }),
  })
  .superRefine((values, context) => {
    if (values.customerChoice !== NEW_CUSTOMER) return;
    const name = values.customerName.trim();
    const problem =
      name === ''
        ? 'Müşteri adını yazın.'
        : name.length > CUSTOMER_NAME_MAX
          ? 'Müşteri adı en çok 120 karakter olabilir.'
          : hasHiddenCharacter(name)
            ? 'Müşteri adı görünmeyen karakter içeremez. Adı yeniden yazın.'
            : null;
    if (problem) context.addIssue({ code: 'custom', path: ['customerName'], message: problem });
  });

export type ProjectFormValues = z.output<typeof projectFormSchema>;

/** A new project: planned, gray, the folder, nobody but the opener, no customer, no date. */
export function newProjectValues(): ProjectFormValues {
  return {
    name: '',
    description: '',
    customerChoice: NO_CUSTOMER,
    customerName: '',
    customerAiAllowed: false,
    customerAutomatedAllowed: false,
    memberIds: [],
    status: DEFAULT_PROJECT_STATUS,
    color: DEFAULT_PROJECT_COLOR,
    icon: DEFAULT_PROJECT_ICON,
    targetDate: '',
  };
}

/** The form filled from a project, for "Projeyi düzenle". */
export function projectValues(project: ProjectDetail): ProjectFormValues {
  return {
    ...newProjectValues(),
    name: project.name,
    description: project.description ?? '',
    customerChoice: project.customer?.id ?? NO_CUSTOMER,
    status: project.status,
    color: project.color,
    icon: project.icon,
    targetDate: project.targetDate ?? '',
  };
}

/**
 * The body of POST /api/projects. The two ids are made once when the dialog opens, so a send that
 * is repeated carries the same ones. The description goes as typed (the API reads an empty one as
 * none). The contract permissions are sent only for a new customer; an employee's form never has
 * them on.
 */
export function createProjectBody(
  values: ProjectFormValues,
  ids: { projectId: string; customerId: string },
): CreateProject {
  return {
    id: ids.projectId,
    name: values.name,
    description: values.description,
    customer:
      values.customerChoice === NEW_CUSTOMER
        ? {
            kind: 'new',
            id: ids.customerId,
            name: values.customerName.trim(),
            aiAllowed: values.customerAiAllowed,
            automatedProcessingAllowed: values.customerAutomatedAllowed,
          }
        : values.customerChoice === NO_CUSTOMER
          ? { kind: 'none' }
          : { kind: 'existing', customerId: values.customerChoice },
    memberIds: values.memberIds,
    status: values.status,
    color: values.color,
    icon: values.icon,
    targetDate: values.targetDate === '' ? null : values.targetDate,
  };
}

/**
 * The body of PATCH /api/projects/:id: only the fields that differ from the project; null when
 * nothing differs. The customer is left out while the project's AI permission is open: it cannot
 * change then, and the dialog shows it as text.
 */
export function projectChanges(
  project: ProjectDetail,
  values: ProjectFormValues,
  newCustomerId: string,
): UpdateProject | null {
  const changes: UpdateProject = {};
  if (values.name !== project.name) changes.name = values.name;
  if (values.description !== (project.description ?? '')) changes.description = values.description;
  if (!project.aiAllowed) {
    if (values.customerChoice === NEW_CUSTOMER) {
      changes.customer = { kind: 'new', id: newCustomerId, name: values.customerName.trim() };
    } else if (values.customerChoice !== (project.customer?.id ?? NO_CUSTOMER)) {
      changes.customer =
        values.customerChoice === NO_CUSTOMER
          ? { kind: 'none' }
          : { kind: 'existing', customerId: values.customerChoice };
    }
  }
  if (values.status !== project.status) changes.status = values.status;
  if (values.color !== project.color) changes.color = values.color;
  if (values.icon !== project.icon) changes.icon = values.icon;
  if (values.targetDate !== (project.targetDate ?? '')) {
    changes.targetDate = values.targetDate === '' ? null : values.targetDate;
  }
  return Object.keys(changes).length === 0 ? null : changes;
}
