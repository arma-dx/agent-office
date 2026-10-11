import type { ProjectDetail } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIDE_WINDOW_QUERY } from './lib/office/use-wide-window.ts';
import { stubMatchMedia } from './test/match-media.ts';
import { apiError, json, mockApi } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { renderApp } from './test/render-app.tsx';

// The budget of a project: a row of the properties panel and a dialog of its own. The owner of
// the project, its managers and the founder see it and change it (12 October 2026, decision 2);
// for anybody else the API's answer carries no amount and the panel shows nothing of it.

beforeEach(() => {
  // The properties panel shows by itself in a wide window.
  stubMatchMedia([WIDE_WINDOW_QUERY]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const PUT = `PUT /projects/${PROJECT_ID}/budget`;

/** The fixture's project as a reader who manages its money gets it. */
function withBudget(
  value: { amount: string; currency: 'TRY' | 'USD' | 'EUR' } | null,
  setBudget = true,
): ProjectDetail {
  const base = projectDetail();
  return { ...base, budget: { visible: true, value }, actions: { ...base.actions, setBudget } };
}

const panel = () => screen.getByRole('complementary', { name: 'Özellikler' });
/** The value beside a name in the list of properties. */
function valueOf(name: string): HTMLElement {
  const value = within(panel()).getByText(name, { selector: 'dt' }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`No value beside ${name}`);
  return value;
}
const editButton = () => within(panel()).getByRole('button', { name: 'Bütçeyi düzenle' });
const openDialog = async () => {
  await userEvent.click(editButton());
  return screen.findByRole('dialog', { name: 'Proje bütçesi' });
};
const gone = async () => {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
};

describe('projects: the budget of a project', () => {
  it('budget: the panel shows it to a reader who may see it and nothing to one who may not', async () => {
    mockApi(projectHandlers(withBudget({ amount: '125000.50', currency: 'TRY' })));
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf('Bütçe')).toHaveTextContent('₺125.000,50');
    // After the target date, before the colour: the budget is a single value of the project.
    const names = within(panel())
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(names.slice(0, 4)).toEqual(['Durum', 'Müşteri', 'Hedef tarih', 'Bütçe']);
    cleanup();

    mockApi(projectHandlers(withBudget({ amount: '2500', currency: 'EUR' })));
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf('Bütçe')).toHaveTextContent('€2.500,00');
    cleanup();

    // A project without a budget says so, to the same reader.
    mockApi(projectHandlers(withBudget(null)));
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf('Bütçe')).toHaveTextContent('Belirlenmedi');
    cleanup();

    // A plain member: no row, no button and no sentence about a budget, anywhere on the page.
    mockApi(
      projectHandlers(projectForEmployee(), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(within(panel()).getByText('Hedef tarih')).toBeVisible();
    expect(document.body).not.toHaveTextContent(/bütçe/i);
    expect(screen.queryByRole('button', { name: /bütçe/i })).toBeNull();
  });

  it('budget: a member who is neither owner nor manager is offered no edit button', async () => {
    // The panel offers what the API's answer allows: an amount without the right to change it is
    // shown without a button.
    mockApi(
      projectHandlers(withBudget({ amount: '900', currency: 'USD' }, false), {
        'GET /session': sessionAs(EMPLOYEE_AT_ARMADX),
      }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(valueOf('Bütçe')).toHaveTextContent('$900,00');
    expect(within(valueOf('Bütçe')).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bütçeyi düzenle' })).toBeNull();
  });

  it('budget: the dialog reads the amount the Turkish way, asks for a currency and sends both', async () => {
    const api = mockApi(
      projectHandlers(withBudget(null), {
        [PUT]: () => json(withBudget({ amount: '125000.50', currency: 'TRY' })),
      }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    expect(editButton()).toHaveTextContent('Düzenle');
    const dialog = await openDialog();
    expect(dialog).toHaveTextContent(
      'Bütçe projenin parasıdır. Yapay zekâ harcaması bu tutardan düşülmüyor. Bütçeyi yalnızca projenin sahibi, yöneticileri ve kurucu görür ve değiştirir.',
    );
    const amount = within(dialog).getByRole('textbox', { name: 'Tutar' });
    const currency = within(dialog).getByRole('combobox', { name: 'Para birimi' });
    expect(amount).toHaveFocus();
    expect(amount).toHaveValue('');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    expect(amount).toHaveAccessibleDescription('Örnek: 125.000,50');
    // Nothing is chosen for the person.
    expect(currency).toHaveValue('');
    expect(
      within(currency)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Seçin', 'Türk lirası (TRY)', 'ABD doları (USD)', 'Avro (EUR)']);
    // A project without a budget has nothing to take away.
    expect(within(dialog).queryByRole('button', { name: 'Bütçeyi kaldır' })).toBeNull();

    // Both are asked for, each under its own field.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      expect(amount).toHaveAccessibleDescription('Örnek: 125.000,50 Tutarı yazın.');
    });
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(currency).toHaveAccessibleDescription('Para birimini seçin.');
    expect(currency).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveFocus();

    // A dot is not the decimal sign.
    await userEvent.type(amount, '12.5');
    await userEvent.selectOptions(currency, 'TRY');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => {
      expect(amount).toHaveAccessibleDescription(
        'Örnek: 125.000,50 Tutarı 125.000,50 biçiminde yazın; sıfırdan büyük olmalı.',
      );
    });
    expect(api.callsTo(PUT)).toEqual([]);

    await userEvent.clear(amount);
    await userEvent.type(amount, '125.000,50{Enter}');
    await gone();
    expect(api.callsTo(PUT).map((call) => call.body)).toEqual([
      { budget: { amount: '125000.50', currency: 'TRY' } },
    ]);
    // The page shows the answer without asking again; the focus is back on the row's button.
    expect(valueOf('Bütçe')).toHaveTextContent('₺125.000,50');
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    await waitFor(() => {
      expect(editButton()).toHaveFocus();
    });

    // It opens again with the saved amount as a person would type it, and the saved currency.
    const again = await openDialog();
    expect(within(again).getByRole('textbox', { name: 'Tutar' })).toHaveValue('125.000,50');
    expect(within(again).getByRole('combobox', { name: 'Para birimi' })).toHaveValue('TRY');
    // Vazgeç sends nothing.
    await userEvent.click(within(again).getByRole('button', { name: 'Vazgeç' }));
    await gone();
    expect(api.callsTo(PUT)).toHaveLength(1);
    // No passkey is asked for a budget.
    expect(api.callsTo('POST /step-up/options')).toEqual([]);
  });

  it('budget: "Bütçeyi kaldır" sends null', async () => {
    const api = mockApi(
      projectHandlers(withBudget({ amount: '900.00', currency: 'USD' }), {
        [PUT]: () => json(withBudget(null)),
      }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bütçeyi kaldır' }));
    await gone();
    // At once, without a second question: the amount can be typed again.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(PUT).map((call) => call.body)).toEqual([{ budget: null }]);
    expect(valueOf('Bütçe')).toHaveTextContent('Belirlenmedi');
    await waitFor(() => {
      expect(editButton()).toHaveFocus();
    });
  });

  it('budget: a refusal is read in the dialog and the project is read again', async () => {
    const REFUSAL =
      'Projenin bütçesini yalnızca projenin sahibi, yöneticileri ve kurucu değiştirebilir.';
    const api = mockApi(
      projectHandlers(withBudget({ amount: '900.00', currency: 'USD' }), {
        [PUT]: () => apiError(403, 'project_budget_not_allowed', REFUSAL),
      }),
    );
    renderApp(PATH);
    await screen.findByRole('heading', { level: 2, name: 'Depo otomasyonu' });
    const dialog = await openDialog();
    // The role was taken meanwhile: the project as the reader gets it now has no amount.
    api.handle(`GET /projects/${PROJECT_ID}`, () => json(projectForEmployee()));
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Tutar' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Tutar' }), '1.000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(REFUSAL);
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    });
    // The dialog stays until the person closes it, with the refusal in it, although the row it
    // was opened from is gone under it.
    await waitFor(() => {
      expect(document.querySelector('dt + dd button[aria-label="Bütçeyi düzenle"]')).toBeNull();
    });
    expect(screen.getByRole('dialog', { name: 'Proje bütçesi' })).toHaveTextContent(REFUSAL);
    expect(within(dialog).getByRole('textbox', { name: 'Tutar' })).toHaveValue('1.000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vazgeç' }));
    await gone();
    expect(within(panel()).queryByText('Bütçe', { selector: 'dt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bütçeyi düzenle' })).toBeNull();
  });
});
