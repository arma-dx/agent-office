import { createProjectSchema } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { projectDetail, CUSTOMER_ID, OTHER_CUSTOMER_ID } from '../../test/project-fixtures.ts';
import {
  budgetFormSchema,
  budgetOf,
  budgetValues,
  createProjectBody,
  limitFormSchema,
  limitOf,
  milestoneFormSchema,
  NEW_CUSTOMER,
  newProjectValues,
  projectChanges,
  projectFormSchema,
  projectValues,
} from './form.ts';

const IDS = {
  projectId: 'a9999999-9999-4999-8999-999999999999',
  customerId: 'c9999999-9999-4999-8999-999999999999',
};

/** The sentence under each field that is wrong. */
function problems(values: unknown): Record<string, string> {
  const result = projectFormSchema.safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
  );
}

describe('project form', () => {
  it('starts a new project planned, gray, with the folder, without customer, members, date or repository', () => {
    expect(newProjectValues()).toEqual({
      name: '',
      description: '',
      customerChoice: '',
      customerName: '',
      customerAiAllowed: false,
      customerAutomatedAllowed: false,
      memberIds: [],
      status: 'planned',
      color: 'gray',
      icon: 'folder',
      targetDate: '',
      repositoryId: '',
    });
  });

  it('says in Turkish what is wrong with each field', () => {
    const values = newProjectValues();
    expect(problems({ ...values, name: '   ' })).toEqual({ name: 'Proje adını yazın.' });
    expect(problems({ ...values, name: 'a'.repeat(121) })).toEqual({
      name: 'Proje adı en çok 120 karakter olabilir.',
    });
    expect(problems({ ...values, name: 'Depo‮' })).toEqual({
      name: 'Proje adı görünmeyen karakter içeremez. Adı yeniden yazın.',
    });
    expect(problems({ ...values, name: 'Depo', description: 'a'.repeat(5001) })).toEqual({
      description: 'Açıklama en çok 5.000 karakter olabilir.',
    });
    expect(problems({ ...values, name: 'Depo', description: 'a\u0000b' })).toEqual({
      description: 'Açıklama okunamayan bir karakter içeriyor. Metni yeniden yazın.',
    });
    expect(problems({ ...values, name: 'Depo', targetDate: '2026-13-40' })).toEqual({
      targetDate: 'Geçerli bir tarih seçin.',
    });
    // Year 0000 is no day the database holds; the contract refuses it and so does the form.
    expect(problems({ ...values, name: 'Depo', targetDate: '0000-01-01' })).toEqual({
      targetDate: 'Geçerli bir tarih seçin.',
    });
    // The limits themselves are accepted, and the name is trimmed.
    const accepted = projectFormSchema.parse({
      ...values,
      name: `  ${'a'.repeat(120)} `,
      description: 'a'.repeat(5000),
      targetDate: '2026-11-20',
    });
    expect(accepted.name).toBe('a'.repeat(120));
  });

  it('asks for the name of a customer only while a new one is being added', () => {
    const values = { ...newProjectValues(), name: 'Depo' };
    expect(problems({ ...values, customerChoice: CUSTOMER_ID, customerName: '' })).toEqual({});
    expect(problems({ ...values, customerChoice: NEW_CUSTOMER, customerName: '  ' })).toEqual({
      customerName: 'Müşteri adını yazın.',
    });
    expect(
      problems({ ...values, customerChoice: NEW_CUSTOMER, customerName: 'a'.repeat(121) }),
    ).toEqual({ customerName: 'Müşteri adı en çok 120 karakter olabilir.' });
    expect(
      problems({ ...values, customerChoice: NEW_CUSTOMER, customerName: 'Be\u0007ta' }),
    ).toEqual({ customerName: 'Müşteri adı görünmeyen karakter içeremez. Adı yeniden yazın.' });
  });

  it('builds the body of a new project; a permission goes only with a new customer', () => {
    const values = { ...newProjectValues(), name: 'Depo', description: ' iki satır \n' };
    expect(createProjectBody(values, IDS)).toEqual({
      id: IDS.projectId,
      name: 'Depo',
      // As typed: the API reads an empty description as none.
      description: ' iki satır \n',
      customer: { kind: 'none' },
      memberIds: [],
      status: 'planned',
      color: 'gray',
      icon: 'folder',
      targetDate: null,
    });
    expect(
      createProjectBody({ ...values, customerChoice: CUSTOMER_ID, customerAiAllowed: true }, IDS)
        .customer,
    ).toEqual({ kind: 'existing', customerId: CUSTOMER_ID });
    expect(
      createProjectBody(
        {
          ...values,
          customerChoice: NEW_CUSTOMER,
          customerName: ' Delta ',
          customerAutomatedAllowed: true,
          targetDate: '2026-12-01',
        },
        IDS,
      ),
    ).toMatchObject({
      customer: {
        kind: 'new',
        id: IDS.customerId,
        name: 'Delta',
        aiAllowed: false,
        automatedProcessingAllowed: true,
      },
      targetDate: '2026-12-01',
    });
    // There is no value for the AI permission of the project itself.
    expect(Object.keys(createProjectBody(values, IDS))).not.toContain('aiAllowed');
  });

  it("names the repository of a new project by GitHub's number, and leaves it out when none is chosen", () => {
    const values = { ...newProjectValues(), name: 'Depo' };
    // Not null and not 0: the key is not there, so the project opens without a repository.
    expect(Object.keys(createProjectBody(values, IDS))).not.toContain('repositoryId');
    const body = createProjectBody({ ...values, repositoryId: '1296269' }, IDS);
    expect(body.repositoryId).toBe(1296269);
    expect(createProjectSchema.safeParse(body).success).toBe(true);
    // The select holds a number as text and nothing else.
    expect(projectFormSchema.safeParse({ ...values, repositoryId: 'arma-org/panel' }).success).toBe(
      false,
    );
    expect(projectFormSchema.safeParse({ ...values, repositoryId: '' }).success).toBe(true);
  });

  it('sends only the fields of an edit that differ, and no customer while the AI permission is open', () => {
    const project = projectDetail();
    const same = projectValues(project);
    expect(projectChanges(project, same, IDS.customerId)).toBeNull();
    expect(
      projectChanges(
        project,
        { ...same, description: '', status: 'completed', icon: 'code', targetDate: '' },
        IDS.customerId,
      ),
    ).toEqual({ description: '', status: 'completed', icon: 'code', targetDate: null });
    expect(projectChanges(project, { ...same, customerChoice: '' }, IDS.customerId)).toEqual({
      customer: { kind: 'none' },
    });
    expect(
      projectChanges(project, { ...same, customerChoice: OTHER_CUSTOMER_ID }, IDS.customerId),
    ).toEqual({ customer: { kind: 'existing', customerId: OTHER_CUSTOMER_ID } });
    expect(
      projectChanges(
        project,
        { ...same, customerChoice: NEW_CUSTOMER, customerName: ' Delta ' },
        IDS.customerId,
      ),
    ).toEqual({ customer: { kind: 'new', id: IDS.customerId, name: 'Delta' } });

    // Rule 12 reads which customer a project has: it does not change while the permission is open.
    const open = projectDetail({ aiAllowed: true });
    expect(
      projectChanges(open, { ...projectValues(open), customerChoice: '' }, IDS.customerId),
    ).toBeNull();
    expect(
      projectChanges(
        open,
        { ...projectValues(open), customerChoice: OTHER_CUSTOMER_ID, name: 'Başka' },
        IDS.customerId,
      ),
    ).toEqual({ name: 'Başka' });
  });
});

describe('milestone form', () => {
  const problem = (values: unknown): Record<string, string> => {
    const result = milestoneFormSchema.safeParse(values);
    if (result.success) return {};
    return Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
  };

  it('takes a trimmed name of 1 to 120 characters and an empty or real day', () => {
    expect(milestoneFormSchema.parse({ name: '  Yayın  ', date: '' })).toEqual({
      name: 'Yayın',
      date: '',
    });
    expect(problem({ name: 'a'.repeat(120), date: '2026-12-01' })).toEqual({});
  });

  it('says in Turkish what is wrong with the name and with the day', () => {
    expect(problem({ name: '   ', date: '' })).toEqual({ name: 'Ad yazın.' });
    expect(problem({ name: 'a'.repeat(121), date: '' })).toEqual({
      name: 'Ad en çok 120 karakter olabilir.',
    });
    // A character nobody sees (a bidirectional override): the database refuses it too.
    expect(problem({ name: 'Yayın\u202e', date: '' })).toEqual({
      name: 'Ad okunamayan bir karakter içeriyor. Adı yeniden yazın.',
    });
    // A day that does not exist, and the year PostgreSQL does not have.
    for (const date of ['2026-02-30', '0000-01-01', '12.01.2026']) {
      expect(problem({ name: 'Yayın', date })).toEqual({ date: 'Geçerli bir tarih girin.' });
    }
  });
});

describe('budget form', () => {
  const problem = (values: unknown): Record<string, string> => {
    const result = budgetFormSchema.safeParse(values);
    if (result.success) return {};
    return Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    );
  };

  it('opens empty with no currency chosen, or with the saved budget as a person types it', () => {
    expect(budgetValues(null)).toEqual({ amount: '', currency: '' });
    expect(budgetValues({ amount: '125000.50', currency: 'EUR' })).toEqual({
      amount: '125.000,50',
      currency: 'EUR',
    });
  });

  it('says in Turkish what is wrong with the amount and with the currency', () => {
    expect(problem({ amount: '', currency: '' })).toEqual({
      amount: 'Tutarı yazın.',
      currency: 'Para birimini seçin.',
    });
    expect(problem({ amount: '   ', currency: 'TRY' })).toEqual({ amount: 'Tutarı yazın.' });
    const SHAPE = 'Tutarı 125.000,50 biçiminde yazın; sıfırdan büyük olmalı.';
    // A dot as the decimal sign, three decimals, zero, a word, thirteen whole digits.
    for (const amount of ['12.5', '1,234', '0', '0,00', 'yüz', '1234567890123']) {
      expect(problem({ amount, currency: 'TRY' }), amount).toEqual({ amount: SHAPE });
    }
    expect(problem({ amount: '100', currency: 'GBP' })).toEqual({
      currency: 'Para birimini seçin.',
    });
    expect(problem({ amount: '999.999.999.999,99', currency: 'USD' })).toEqual({});
  });

  it('gives the API the amount as text with a dot, never rounded', () => {
    expect(budgetOf({ amount: ' 125.000,50 ', currency: 'TRY' })).toEqual({
      amount: '125000.50',
      currency: 'TRY',
    });
    expect(budgetOf({ amount: '999999999999,99', currency: 'USD' })).toEqual({
      amount: '999999999999.99',
      currency: 'USD',
    });
  });
});

describe('spending limit form', () => {
  const problem = (limit: string): string | undefined => {
    const result = limitFormSchema.safeParse({ limit });
    return result.success ? undefined : result.error.issues[0]?.message;
  };

  it('says in Turkish what is wrong with the limit', () => {
    expect(problem('')).toBe('Sınırı yazın.');
    expect(problem('   ')).toBe('Sınırı yazın.');
    const SHAPE = 'Sınırı 25,00 biçiminde yazın; sıfırdan büyük ve en çok 999.999,99 olmalı.';
    // A dot as the decimal sign, three decimals, zero, a word, a million.
    for (const limit of ['25.5', '1,234', '0', '0,00', 'elli', '1000000', '1.000.000,00']) {
      expect(problem(limit), limit).toBe(SHAPE);
    }
    for (const limit of ['25', '25,5', '25,00', '0,01', '999.999,99', ' 50 ']) {
      expect(problem(limit), limit).toBeUndefined();
    }
  });

  it('reads what was typed as the amount the API takes, also while it is typed', () => {
    expect(limitOf('25,5')).toBe('25.5');
    expect(limitOf('1.250,00')).toBe('1250.00');
    expect(limitOf('25,')).toBeNull();
    expect(limitOf('')).toBeNull();
    expect(limitOf('1000000')).toBeNull();
  });
});
