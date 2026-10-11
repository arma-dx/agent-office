import type { Milestone } from '@agent-office/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { formatDay } from './lib/dates.ts';
import { apiError, json, mockApi, type Handler } from './test/mock-api.ts';
import {
  EMPLOYEE_AT_ARMADX,
  PROJECT_ID,
  projectDetail,
  projectForEmployee,
  projectHandlers,
  sessionAs,
} from './test/project-fixtures.ts';
import { currentLocation, renderApp } from './test/render-app.tsx';

// The "Kilometre taşları" tab of a project's page (8 October 2026, decision 17): the milestones
// of the project, kept by every member and the founder.

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = `/c/armadx/projects/${PROJECT_ID}`;
const TAB = `${PATH}?tab=milestones`;
const ADD = `POST /projects/${PROJECT_ID}/milestones`;
const change = (id: string) => `PATCH /projects/${PROJECT_ID}/milestones/${id}`;
const remove = (id: string) => `DELETE /projects/${PROJECT_ID}/milestones/${id}`;

const DESIGN: Milestone = {
  id: 'b1111111-1111-4111-8111-111111111111',
  name: 'Tasarım onayı',
  date: '2026-11-05',
  done: true,
};
const LAUNCH: Milestone = {
  id: 'b2222222-2222-4222-8222-222222222222',
  name: 'Yayın',
  date: '2026-12-01',
  done: false,
};
const TRAINING: Milestone = {
  id: 'b3333333-3333-4333-8333-333333333333',
  name: 'Eğitim',
  date: null,
  done: false,
};
// In the order they were added; the page sorts them by day.
const ADDED = [TRAINING, LAUNCH, DESIGN];

/** A member who may change nothing of the project (the API says so in `actions.edit`). */
function readOnly(milestones: Milestone[]) {
  const base = projectForEmployee({ milestones });
  return { ...base, actions: { ...base.actions, edit: false } };
}

const tabPanel = () => screen.findByRole('tabpanel', { name: 'Kilometre taşları' });
const list = () => screen.findByRole('list', { name: 'Kilometre taşları' });
const box = (name: string) => screen.getByRole('checkbox', { name: `${name}: tamamlandı` });
const addButton = () => screen.getByRole('button', { name: 'Kilometre taşı ekle' });
const gone = async () => {
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
};

/** An answer the test gives when it chooses to. */
function held(): { handler: Handler; answer: (response: Response) => void } {
  let release: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { handler: () => pending, answer: release };
}

describe('projects: the milestones of a project', () => {
  it('the project page has the Kilometre taşları tab, and ?tab=milestones opens it', async () => {
    mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
    const { router } = renderApp(PATH);
    const tab = await screen.findByRole('tab', { name: 'Kilometre taşları' });
    expect(tab).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => {
      expect(currentLocation(router)).toEqual({ pathname: PATH, search: { tab: 'milestones' } });
    });
    expect(within(await tabPanel()).getByRole('list', { name: 'Kilometre taşları' })).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    cleanup();

    // The address keeps the tab: a reload or a shared link opens it again.
    mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
    renderApp(TAB);
    expect(await screen.findByRole('tab', { name: 'Kilometre taşları' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await list()).toBeVisible();
  });

  it('the project page has no tab, no link and no empty section for notes', async () => {
    // Decision 17 names the notes of a project; they come with the Notes work. Until then the
    // page offers nothing that leads nowhere. That work changes this test; nothing else may.
    mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
    renderApp(PATH);
    await screen.findByRole('tablist', { name: 'Proje bölümleri' });
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    for (const name of tabs) {
      cleanup();
      mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
      renderApp(PATH);
      await userEvent.click(await screen.findByRole('tab', { name }));
      const main = screen.getByRole('main');
      expect(within(main).queryByRole('tab', { name: /\bnot/i })).toBeNull();
      expect(within(main).queryByRole('link', { name: /\bnot/i })).toBeNull();
      expect(within(main).queryByRole('heading', { name: /\bnot/i })).toBeNull();
      expect(within(main).queryByRole('button', { name: /\bnot/i })).toBeNull();
    }
    expect(tabs.length).toBeGreaterThan(2);
  });

  it('milestones: the tab lists them by day and says how many are done', async () => {
    mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
    renderApp(TAB);
    const items = within(await list()).getAllByRole('listitem');
    // By day, the one without a day last.
    expect(
      items.map((item) => within(item).getByRole('checkbox').getAttribute('aria-label')),
    ).toEqual(['Tasarım onayı: tamamlandı', 'Yayın: tamamlandı', 'Eğitim: tamamlandı']);
    expect(within(await tabPanel()).getByText('Tamamlanan: 1 / 3')).toBeVisible();
    expect(box('Tasarım onayı')).toBeChecked();
    expect(box('Yayın')).not.toBeChecked();
    // The day is a day, written as everywhere else; an entry without one says so.
    const [design, launch, training] = items as [HTMLElement, HTMLElement, HTMLElement];
    const day = within(design).getByText(formatDay('2026-11-05'));
    expect(day.tagName).toBe('TIME');
    expect(day).toHaveAttribute('datetime', '2026-11-05');
    expect(within(launch).getByText(formatDay('2026-12-01'))).toBeVisible();
    expect(within(training).getByText('Tarih yok')).toBeVisible();
    // The line through a reached milestone only repeats the tick.
    expect(within(design).getByText('Tasarım onayı').className).toContain('line-through');
    expect(within(launch).getByText('Yayın').className).not.toContain('line-through');
    // The two buttons of a row are named after its milestone.
    expect(within(launch).getByRole('button', { name: 'Yayın: düzenle' })).toHaveTextContent(
      'Düzenle',
    );
    expect(within(launch).getByRole('button', { name: 'Yayın: sil' })).toHaveTextContent('Sil');
    expect(addButton()).toBeVisible();
    cleanup();

    // A reader who may not change the project: the same rows, the boxes closed, no button.
    mockApi(projectHandlers(readOnly(ADDED), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }));
    renderApp(TAB);
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(3);
    expect(box('Tasarım onayı')).toBeChecked();
    expect(box('Tasarım onayı')).toBeDisabled();
    expect(box('Yayın')).toBeDisabled();
    expect(within(await tabPanel()).queryByRole('button')).toBeNull();
  });

  it('milestones: the empty tab offers the first step', async () => {
    mockApi(projectHandlers(projectDetail()));
    renderApp(TAB);
    const panel = await tabPanel();
    expect(
      within(panel).getByRole('heading', { name: 'Bu projede henüz kilometre taşı yok' }),
    ).toBeVisible();
    expect(panel).toHaveTextContent(
      'Projenin önemli adımlarını adı ve tarihiyle ekleyin; tamamlananı işaretleyin.',
    );
    expect(within(panel).getByRole('button', { name: 'Kilometre taşı ekle' })).toBeVisible();
    expect(within(panel).queryByText(/^Tamamlanan:/)).toBeNull();
    cleanup();

    mockApi(projectHandlers(readOnly([]), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }));
    renderApp(TAB);
    const other = await tabPanel();
    expect(
      within(other).getByRole('heading', { name: 'Bu projede henüz kilometre taşı yok' }),
    ).toBeVisible();
    expect(other).toHaveTextContent('Kilometre taşlarını proje üyeleri ekler.');
    expect(within(other).queryByRole('button')).toBeNull();
  });

  it('milestones: ticking sends the change and the checkbox moves only with the answer', async () => {
    const tick = held();
    const api = mockApi(
      projectHandlers(projectDetail({ milestones: ADDED }), { [change(LAUNCH.id)]: tick.handler }),
    );
    renderApp(TAB);
    await list();
    const checkbox = box('Yayın');
    expect(checkbox).not.toHaveAttribute('aria-busy');
    await userEvent.click(checkbox);
    // On its way: the box still shows the saved value, and a second click sends nothing.
    await waitFor(() => {
      expect(checkbox).toHaveAttribute('aria-busy', 'true');
    });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(checkbox);
    expect(api.callsTo(change(LAUNCH.id)).map((call) => call.body)).toEqual([{ done: true }]);

    tick.answer(json(projectDetail({ milestones: [TRAINING, { ...LAUNCH, done: true }, DESIGN] })));
    await waitFor(() => {
      expect(box('Yayın')).toBeChecked();
    });
    expect(box('Yayın')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Tamamlanan: 2 / 3')).toBeVisible();
    // The keyboard stays on the box, and the page was not asked again.
    expect(box('Yayın')).toHaveFocus();
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);

    // Unticking sends the other value.
    api.handle(change(DESIGN.id), () =>
      json(projectDetail({ milestones: [TRAINING, LAUNCH, { ...DESIGN, done: false }] })),
    );
    await userEvent.click(box('Tasarım onayı'));
    await waitFor(() => {
      expect(box('Tasarım onayı')).not.toBeChecked();
    });
    expect(api.callsTo(change(DESIGN.id)).map((call) => call.body)).toEqual([{ done: false }]);
  });

  it('milestones: adding one sends a new id, closes the dialog and returns the focus to the button', async () => {
    const api = mockApi(
      projectHandlers(projectDetail(), {
        [ADD]: () => apiError(500, 'internal_error', 'Beklenmeyen bir hata oldu.'),
      }),
    );
    renderApp(TAB);
    await tabPanel();
    await userEvent.click(addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    const name = within(dialog).getByRole('textbox', { name: 'Ad' });
    expect(name).toHaveFocus();
    expect(name).toHaveValue('');
    expect(within(dialog).getByLabelText('Tarih')).toHaveValue('');
    expect(dialog).toHaveTextContent(
      'İsteğe bağlı. Tarih yalnızca bilgidir; günü geçince uyarı çıkmaz.',
    );
    expect(within(dialog).getByLabelText('Tarih')).toHaveAccessibleDescription(
      'İsteğe bağlı. Tarih yalnızca bilgidir; günü geçince uyarı çıkmaz.',
    );
    // There is no "done" in the dialog: that is the row's checkbox.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();

    // Enter in the field sends. The first send fails: the sentence is read in the dialog.
    await userEvent.type(name, '  Yayın  ');
    await userEvent.type(within(dialog).getByLabelText('Tarih'), '2026-12-01');
    await userEvent.type(name, '{Enter}');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Beklenmeyen bir hata oldu.',
    );
    expect(screen.getByRole('dialog')).toBeVisible();

    api.handle(ADD, () => json(projectDetail({ milestones: [LAUNCH] })));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ekle' }));
    await gone();
    const sent = api.callsTo(ADD).map((call) => call.body as Record<string, unknown>);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ id: sent[0]?.id, name: 'Yayın', date: '2026-12-01' });
    expect(z.uuid().safeParse(sent[0]?.id).success).toBe(true);
    // The id was made when the dialog opened: the repeated send adds the same entry.
    expect(sent[1]).toEqual(sent[0]);
    // The page shows the answer without asking again, and the keyboard is on the add button
    // (the empty screen's button is gone with the empty screen).
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(1);
    expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(1);
    await waitFor(() => {
      expect(addButton()).toHaveFocus();
    });

    // A milestone without a day sends null; a new dialog makes a new id.
    api.handle(ADD, () => json(projectDetail({ milestones: [LAUNCH, TRAINING] })));
    await userEvent.click(addButton());
    const second = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    await userEvent.type(within(second).getByRole('textbox', { name: 'Ad' }), 'Eğitim');
    await userEvent.click(within(second).getByRole('button', { name: 'Ekle' }));
    await gone();
    const third = api.callsTo(ADD)[2]?.body as Record<string, unknown>;
    expect(third).toEqual({ id: third.id, name: 'Eğitim', date: null });
    expect(z.uuid().safeParse(third.id).success).toBe(true);
    expect(third.id).not.toBe(sent[0]?.id);
    await waitFor(() => {
      expect(addButton()).toHaveFocus();
    });

    // Vazgeç and Escape close without a request and return the focus; a press outside does not
    // close.
    await userEvent.click(addButton());
    let open = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    await userEvent.type(within(open).getByRole('textbox', { name: 'Ad' }), 'Yarım');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) throw new Error('The dialog has no overlay');
    await userEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeVisible();
    await userEvent.click(within(open).getByRole('button', { name: 'Vazgeç' }));
    await gone();
    await waitFor(() => {
      expect(addButton()).toHaveFocus();
    });
    await userEvent.click(addButton());
    open = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    // Every opening starts empty.
    expect(within(open).getByRole('textbox', { name: 'Ad' })).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    await gone();
    expect(api.callsTo(ADD)).toHaveLength(3);
  });

  it('milestones: changing one sends only what differs, and nothing when nothing changed', async () => {
    const api = mockApi(
      projectHandlers(projectDetail({ milestones: ADDED }), {
        [change(LAUNCH.id)]: () =>
          json(
            projectDetail({
              milestones: [TRAINING, { ...LAUNCH, name: 'Canlıya geçiş', date: null }, DESIGN],
            }),
          ),
      }),
    );
    renderApp(TAB);
    await list();
    const edit = screen.getByRole('button', { name: 'Yayın: düzenle' });
    await userEvent.click(edit);
    let dialog = await screen.findByRole('dialog', { name: 'Kilometre taşını düzenle' });
    const name = within(dialog).getByRole('textbox', { name: 'Ad' });
    expect(name).toHaveValue('Yayın');
    expect(name).toHaveFocus();
    expect(within(dialog).getByLabelText('Tarih')).toHaveValue('2026-12-01');
    // Nothing changed: the dialog closes, nothing is sent, the focus is back on the row's button.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    expect(api.callsTo(change(LAUNCH.id))).toEqual([]);
    await waitFor(() => {
      expect(edit).toHaveFocus();
    });

    await userEvent.click(edit);
    dialog = await screen.findByRole('dialog', { name: 'Kilometre taşını düzenle' });
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Ad' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Ad' }), 'Canlıya geçiş');
    await userEvent.clear(within(dialog).getByLabelText('Tarih'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await gone();
    // The name and the cleared day; never "done", which the dialog does not hold.
    expect(api.callsTo(change(LAUNCH.id)).map((call) => call.body)).toEqual([
      { name: 'Canlıya geçiş', date: null },
    ]);
    // Without a day it is sorted last now, after "Eğitim", which was added before it.
    expect(
      within(await list())
        .getAllByRole('checkbox')
        .map((checkbox) => checkbox.getAttribute('aria-label')),
    ).toEqual(['Tasarım onayı: tamamlandı', 'Eğitim: tamamlandı', 'Canlıya geçiş: tamamlandı']);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Canlıya geçiş: düzenle' })).toHaveFocus();
    });
  });

  it('milestones: a name is required and limited, and the errors are tied to their fields', async () => {
    const api = mockApi(projectHandlers(projectDetail({ milestones: ADDED })));
    renderApp(TAB);
    await list();
    await userEvent.click(addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    const name = within(dialog).getByRole('textbox', { name: 'Ad' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ekle' }));
    const empty = await within(dialog).findByRole('alert');
    expect(empty).toHaveTextContent('Ad yazın.');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Ad yazın.');
    expect(name).toHaveFocus();

    await userEvent.type(name, 'a'.repeat(121));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ekle' }));
    await waitFor(() => {
      expect(name).toHaveAccessibleDescription('Ad en çok 120 karakter olabilir.');
    });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    // Nothing was sent, and the dialog stays for the correction.
    expect(api.callsTo(ADD)).toEqual([]);
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('milestones: removing asks first, with the safe button focused', async () => {
    const api = mockApi(
      projectHandlers(projectDetail({ milestones: ADDED }), {
        [remove(LAUNCH.id)]: () => json(projectDetail({ milestones: [TRAINING, DESIGN] })),
      }),
    );
    renderApp(TAB);
    await list();
    const button = screen.getByRole('button', { name: 'Yayın: sil' });
    await userEvent.click(button);
    let dialog = await screen.findByRole('alertdialog', { name: '"Yayın" silinsin mi?' });
    expect(dialog).toHaveTextContent('Kilometre taşı listeden kalkar. Bu işlem geri alınamaz.');
    const cancel = within(dialog).getByRole('button', { name: 'Vazgeç' });
    expect(cancel).toHaveFocus();
    // Giving up sends nothing and returns the focus to the row's button.
    await userEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.callsTo(remove(LAUNCH.id))).toEqual([]);
    await waitFor(() => {
      expect(button).toHaveFocus();
    });

    await userEvent.click(button);
    dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.callsTo(remove(LAUNCH.id))).toHaveLength(1);
    expect(api.callsTo(remove(LAUNCH.id))[0]?.body).toBeUndefined();
    expect(screen.queryByRole('checkbox', { name: 'Yayın: tamamlandı' })).toBeNull();
    expect(screen.getByText('Tamamlanan: 1 / 2')).toBeVisible();
    // The row took its buttons with it: the keyboard goes to the add button.
    await waitFor(() => {
      expect(addButton()).toHaveFocus();
    });
  });

  it('milestones: at 50 the add button gives way to the sentence', async () => {
    const fifty: Milestone[] = Array.from({ length: 50 }, (_, index) => ({
      id: `b0000000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`,
      name: `Adım ${String(index + 1)}`,
      date: null,
      done: false,
    }));
    mockApi(
      projectHandlers(projectDetail({ milestones: fifty }), {
        [remove(fifty[0]?.id ?? '')]: () => json(projectDetail({ milestones: fifty.slice(1) })),
      }),
    );
    renderApp(TAB);
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText('Bir projede en çok 50 kilometre taşı olabilir.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Kilometre taşı ekle' })).toBeNull();
    // With one removed the button is back, and takes the focus.
    await userEvent.click(screen.getByRole('button', { name: 'Adım 1: sil' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));
    await waitFor(() => {
      expect(addButton()).toHaveFocus();
    });
    expect(screen.queryByText('Bir projede en çok 50 kilometre taşı olabilir.')).toBeNull();
    cleanup();

    // A reader who cannot add is not told how many can be added.
    mockApi(projectHandlers(readOnly(fifty), { 'GET /session': sessionAs(EMPLOYEE_AT_ARMADX) }));
    renderApp(TAB);
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.queryByText('Bir projede en çok 50 kilometre taşı olabilir.')).toBeNull();
  });

  it('milestones: a refusal is said with the API’s sentence', async () => {
    const GONE = 'Bu kilometre taşı az önce silindi. Sayfayı yenileyip yeniden deneyin.';
    const FULL =
      'Bir projede en çok 50 kilometre taşı olabilir. Yenisini eklemek için birini silin.';
    const api = mockApi(
      projectHandlers(projectDetail({ milestones: ADDED }), {
        [change(LAUNCH.id)]: () => apiError(409, 'milestone_not_found', GONE),
        [ADD]: () => apiError(409, 'milestone_limit', FULL),
      }),
    );
    renderApp(TAB);
    await list();
    // A tick that is refused: a message, the box stays, and the project is read again.
    await userEvent.click(box('Yayın'));
    expect(await screen.findByText(GONE)).toBeVisible();
    expect(box('Yayın')).not.toBeChecked();
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(2);
    });

    // In a dialog the sentence stands in the dialog, which stays; the project is read again too.
    await userEvent.click(addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Kilometre taşı ekle' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Ad' }), 'Bir tane daha');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ekle' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(FULL);
    expect(screen.getByRole('dialog')).toBeVisible();
    // What was typed is still there under the project that was read again.
    await waitFor(() => {
      expect(api.callsTo(`GET /projects/${PROJECT_ID}`)).toHaveLength(3);
    });
    expect(within(dialog).getByRole('textbox', { name: 'Ad' })).toHaveValue('Bir tane daha');
  });
});
