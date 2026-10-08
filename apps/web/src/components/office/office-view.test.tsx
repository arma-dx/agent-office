import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeView, type OfficeViewHandle } from '@/components/office/office-view';
import { byDepth, project } from '@/lib/office/iso';
import { layoutOffice } from '@/lib/office/layout';
import { agentId, NO_WORK, unitId, type OfficeUnit } from '@/lib/office/model';
import { extentOf, OVERLAY, overlayAnchors, overlayBoxes, sceneBounds } from '@/lib/office/overlay';
import { fitView, ZOOM, type Size } from '@/lib/office/view';

const UNITS: OfficeUnit[] = [
  {
    code: 'KOR',
    name: 'Koordinasyon Katmanı',
    agents: [
      { code: 'KOR-1', name: 'Ofis Koordinatörü', state: 'stopped', ready: true, work: NO_WORK },
      { code: 'KOR-2', name: 'Görev Takip Ajanı', state: 'idle', ready: true, work: NO_WORK },
    ],
  },
  {
    code: 'P-IST',
    name: 'İstasyon Verisi ve Şarj Operasyonları',
    agents: [
      {
        code: 'P-IST-1',
        name: 'İstasyon Veri Toplama Ajanı',
        state: 'closed',
        ready: true,
        work: NO_WORK,
      },
    ],
  },
  {
    code: 'HAF',
    name: 'Kurumsal Hafıza',
    agents: [
      { code: 'HAF-1', name: 'Bilgi Tabanı Ajanı', state: 'closed', ready: true, work: NO_WORK },
    ],
  },
];

const VIEWPORT = { width: 1000, height: 600 };
/** Sizes the fake layout gives to a unit card and to an agent label; 0 x 0 plays "not laid out yet". */
const CARD = { width: 216, height: 48 };
const LABEL = { width: 150, height: 24 };
/** The keyboard hint while it is shown: it lies over the top of the scene, down to this pixel. */
const HINT = { width: 320, height: 0 };
/** A label that shows only its code, below the full level; null plays a layout that ignores the level. */
let codeLabel: Size | null = null;
let laidOut = true;
const setPointerCapture = vi.fn<(pointerId: number) => void>();
/** The last kind of input, for the :focus-visible stand-in below. */
let lastInput: 'key' | 'pointer' | null = null;
const noteKey = () => {
  lastInput = 'key';
};
const notePointer = () => {
  lastInput = 'pointer';
};
/** Observers created by the component; reportSize() delivers one observation, as the browser does after layout. */
const observers = new Set<() => void>();

function reportSize() {
  act(() => {
    for (const notify of observers) notify();
  });
}

function fakeSize(element: HTMLElement): Size {
  if (!laidOut) return { width: 0, height: 0 };
  if (element.classList.contains('office-card')) return CARD;
  if (element.classList.contains('office-label')) {
    const whole = element.closest('[data-level]')?.getAttribute('data-level') === 'full';
    return codeLabel === null || whole ? LABEL : codeLabel;
  }
  // A hidden element has no box.
  if (element.classList.contains('office-hint') && !element.hidden) return HINT;
  return { width: 0, height: 0 };
}

// jsdom has no layout: the viewport, the cards and the labels get their sizes here, and
// reportSize() plays the resize observer.
beforeEach(() => {
  VIEWPORT.width = 1000;
  VIEWPORT.height = 600;
  LABEL.width = 150;
  HINT.height = 0;
  codeLabel = null;
  laidOut = true;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return fakeSize(this).width;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return fakeSize(this).height;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('office-viewport') ? VIEWPORT.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('office-viewport') ? VIEWPORT.height : 0;
  });
  observers.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<Element>();
      notify: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.notify = () => {
          // The component reads only the target of an entry.
          const entries = [...this.targets].map((target) => ({ target }));
          callback(entries as ResizeObserverEntry[], this);
        };
      }
      observe(target: Element) {
        this.targets.add(target);
        observers.add(this.notify);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
        observers.delete(this.notify);
      }
    },
  );
  // jsdom does not implement pointer capture.
  setPointerCapture.mockClear();
  Element.prototype.setPointerCapture = setPointerCapture;
  // jsdom answers :focus-visible from a heuristic that loses track after the first focused element
  // (a Tab from one focused control to the next reads as not visible). This stand-in answers the
  // way browsers do: the focused element shows its focus unless the last input was a press of the
  // pointer.
  lastInput = null;
  document.addEventListener('keydown', noteKey, true);
  document.addEventListener('pointerdown', notePointer, true);
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    selectors: string,
  ) {
    // Every other selector is answered by jsdom: an element matches when it is its own closest match.
    if (selectors !== ':focus-visible') return this.closest(selectors) === this;
    return this === document.activeElement && lastInput !== 'pointer';
  });
});

afterEach(() => {
  document.removeEventListener('keydown', noteKey, true);
  document.removeEventListener('pointerdown', notePointer, true);
  delete document.documentElement.dataset['input'];
  Reflect.deleteProperty(document, 'fonts');
  vi.restoreAllMocks();
});

/** A stand-in for document.fonts, which jsdom does not have: the test says when a font is in. */
function stubFonts() {
  let finish: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const listeners = new Set<() => void>();
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      ready,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    },
  });
  return {
    listeners,
    /** The fonts the page asked for on its first layout have loaded. */
    async loaded() {
      finish();
      await act(async () => {
        await ready;
      });
    },
    /** A font that was asked for later has loaded. */
    loadingDone() {
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function office(
  selectedId: string | null,
  onSelect: (id: string | null) => void,
  holdView = false,
  ref?: Ref<OfficeViewHandle>,
) {
  return (
    <OfficeView
      ref={ref}
      companyName="Arma DX"
      units={UNITS}
      centreUnit="HAF"
      selectedId={selectedId}
      onSelect={onSelect}
      holdView={holdView}
    />
  );
}

function renderOffice(selectedId: string | null = null, holdView = false) {
  const onSelect = vi.fn<(id: string | null) => void>();
  const view = render(office(selectedId, onSelect, holdView));
  reportSize();
  const viewport = screen.getByRole('group', { name: 'Ofis haritası' });
  const world = screen.getByTestId('office-world');
  return { onSelect, viewport, world, ...view };
}

/** The view the component should have when the scene is fitted to a viewport of this size. */
function fitted(size: Size, measured = true) {
  const layout = layoutOffice(
    UNITS.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
    { centreUnit: 'HAF' },
  );
  const anchors = overlayAnchors(layout);
  const sizes = new Map<string, Size>(
    measured
      ? anchors.map((anchor) => [anchor.id, anchor.placement === 'card' ? CARD : LABEL])
      : [],
  );
  const view = fitView(size, sceneBounds(layout, overlayBoxes(anchors, sizes)));
  if (!view) throw new Error('no fit');
  return view;
}

/** The box the view keeps in sight for a selected unit or agent, with the fake label sizes. */
function selectedExtent(id: string) {
  const layout = layoutOffice(
    UNITS.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
    { centreUnit: 'HAF' },
  );
  const anchors = overlayAnchors(layout);
  const sizes = new Map<string, Size>(
    anchors.map((anchor) => [anchor.id, anchor.placement === 'card' ? CARD : LABEL]),
  );
  const extent = extentOf(layout, overlayBoxes(anchors, sizes), id);
  if (!extent) throw new Error('no extent');
  return extent;
}

function fittedTransform(size: Size, measured = true): string {
  const view = fitted(size, measured);
  return `translate(${view.x} ${view.y}) scale(${view.k})`;
}

function zoomOf(viewport: HTMLElement): number {
  return Number(viewport.style.getPropertyValue('--office-k'));
}

function translateOf(world: HTMLElement): [number, number] {
  const match = /^translate\(([\d.-]+) ([\d.-]+)\)/.exec(world.getAttribute('transform') ?? '');
  return [Number(match?.[1]), Number(match?.[2])];
}

function labels() {
  return within(screen.getByRole('list', { name: 'Birimler' })).getAllByRole('button');
}

/** Pointer events of the main mouse button: the press, a move while it is down, a move without it. */
const PRESS = { pointerId: 1, isPrimary: true, button: 0, buttons: 1 };
const HELD = { pointerId: 1, isPrimary: true, buttons: 1 };
const FREE = { pointerId: 1, isPrimary: true, buttons: 0 };

describe('OfficeView structure', () => {
  it('is a figure with a text summary, and lists units and agents as buttons in reading order', () => {
    renderOffice();
    expect(
      screen.getByRole('figure', { name: 'Arma DX ofisi: 3 birim, 4 ajan' }),
    ).toBeInTheDocument();
    expect(labels().map((button) => button.getAttribute('aria-label'))).toEqual([
      'Koordinasyon Katmanı, KOR, 2 ajan',
      'KOR-1 Ofis Koordinatörü, Koordinasyon Katmanı, Durduruldu',
      'KOR-2 Görev Takip Ajanı, Koordinasyon Katmanı, Boşta',
      'İstasyon Verisi ve Şarj Operasyonları, P-IST, 1 ajan',
      'P-IST-1 İstasyon Veri Toplama Ajanı, İstasyon Verisi ve Şarj Operasyonları, Kapalı',
      'Kurumsal Hafıza, HAF, 1 ajan',
      'HAF-1 Bilgi Tabanı Ajanı, Kurumsal Hafıza, Kapalı',
    ]);
    expect(
      within(screen.getByRole('list', { name: 'Koordinasyon Katmanı ajanları' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(2);
  });

  it('writes the short name on the label and keeps the full card name in the accessible name', () => {
    renderOffice();
    const button = screen.getByRole('button', { name: /^KOR-2 Görev Takip Ajanı,/ });
    // The whole text is compared: "Görev Takip Ajanı" would hold the short name as a part.
    expect(button.querySelector('.office-code')?.textContent).toBe('KOR-2');
    expect(button.querySelector('.office-name')?.textContent).toBe('Görev Takip');
    expect(button.textContent).toBe('KOR-2Görev Takip');
  });

  it('shows the full card name as a tooltip of the text and gives the button no description', () => {
    renderOffice();
    const agents = labels().filter((button) => button.classList.contains('office-label'));
    expect(agents).toHaveLength(4);
    for (const button of agents) {
      // A title on the button itself would be its description: after the name, which already
      // starts with code and card name, a screen reader would say both a second time.
      expect(button).not.toHaveAttribute('title');
      expect(button).not.toHaveAccessibleDescription();
    }
    const button = screen.getByRole('button', { name: /^KOR-2 Görev Takip Ajanı,/ });
    for (const part of ['.office-code', '.office-name']) {
      expect(button.querySelector(part)).toHaveAttribute('title', 'KOR-2 Görev Takip Ajanı');
      expect(button.querySelector(part)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('hides the drawing from assistive technology and draws one group per unit and per agent', () => {
    const { world } = renderOffice();
    const svg = world.closest('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(world.querySelectorAll('g.office-unit')).toHaveLength(3);
    expect(world.querySelectorAll('g.office-agent')).toHaveLength(4);
    expect(world.querySelectorAll('polygon.office-walkway')).toHaveLength(2);
    expect(world.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(world.querySelectorAll('text')).toHaveLength(0);
  });

  it('draws each desk where the layout puts it: a mat, the sprite with its figure, and a ring around the sprite', () => {
    const { world } = renderOffice();
    const layout = layoutOffice(
      UNITS.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
      { centreUnit: 'HAF' },
    );
    const desks = layout.rooms.flatMap((room) => room.desks);
    expect(desks).toHaveLength(4);
    for (const desk of desks) {
      const group = world.querySelector(`g.office-agent[data-office-id="${agentId(desk.agent)}"]`);
      if (!group) throw new Error(`no desk for ${desk.agent}`);
      // Painted in this order: the mat on the floor, the sprite on it, the ring last.
      expect([...group.children].map((child) => child.getAttribute('class'))).toEqual([
        'office-mat',
        'office-sprite',
        'office-ring',
      ]);
      const foot = project(desk.x, desk.y);
      const sprite = group.querySelector('g.office-sprite');
      expect(sprite?.getAttribute('transform'), desk.agent).toBe(`translate(${foot.x} ${foot.y})`);
      // The figure (body and head) is what tells a closed agent from an enabled one.
      expect(sprite?.querySelectorAll('.office-figure'), desk.agent).toHaveLength(2);
      expect(sprite?.querySelectorAll('.office-monitor, .office-desk, .office-chair')).toHaveLength(
        3,
      );
      // The ring stands ringPad outside the sprite, which a label and a card keep clear of.
      const ring = group.querySelector('rect.office-ring');
      expect(
        ['x', 'y', 'width', 'height'].map((name) => Number(ring?.getAttribute(name))),
        desk.agent,
      ).toEqual([
        foot.x - OVERLAY.spriteWidth / 2 - OVERLAY.ringPad,
        foot.y - OVERLAY.spriteHeight - OVERLAY.ringPad,
        OVERLAY.spriteWidth + 2 * OVERLAY.ringPad,
        OVERLAY.spriteHeight + 2 * OVERLAY.ringPad,
      ]);
    }
  });

  it('paints rooms far to near, and the desks of a room far to near', () => {
    const { world } = renderOffice();
    const layout = layoutOffice(
      UNITS.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
      { centreUnit: 'HAF' },
    );
    const ids = (elements: Iterable<Element>) =>
      [...elements].map((element) => element.getAttribute('data-office-id'));
    expect(ids(world.querySelectorAll('g.office-unit'))).toEqual(
      layout.paintOrder.map((index) => unitId(layout.rooms[index]?.unit ?? '')),
    );
    // The order of the data is another one: the middle room is listed last and painted second.
    expect(ids(world.querySelectorAll('g.office-unit'))).not.toEqual(
      layout.rooms.map((room) => unitId(room.unit)),
    );
    for (const room of layout.rooms) {
      const group = world.querySelector(`g.office-unit[data-office-id="${unitId(room.unit)}"]`);
      expect(ids(group?.querySelectorAll('g.office-agent') ?? []), room.unit).toEqual(
        [...room.desks].sort(byDepth).map((desk) => agentId(desk.agent)),
      );
    }
  });

  it('names a unit with its code, which is the text that stays visible at every zoom', () => {
    renderOffice();
    const card = screen.getByRole('button', { name: 'Koordinasyon Katmanı, KOR, 2 ajan' });
    expect(card).toHaveTextContent('Koordinasyon KatmanıKOR2 ajan');
    expect(card.querySelector('.office-tag')).toHaveTextContent('KOR');
    expect(card.getAttribute('aria-label')).toContain(
      card.querySelector('.office-tag')?.textContent,
    );
  });

  it('carries the state of an agent on its desk and on its label, with one mark of one size for every state', () => {
    const { world } = renderOffice();
    const stateOf = (code: string) => [
      world.querySelector(`[data-office-id="agent:${code}"]`)?.getAttribute('data-state'),
      screen.getByRole('button', { name: new RegExp(`^${code} `) }).getAttribute('data-state'),
    ];
    expect(stateOf('KOR-1')).toEqual(['stopped', 'stopped']);
    expect(stateOf('KOR-2')).toEqual(['idle', 'idle']);
    expect(stateOf('HAF-1')).toEqual(['closed', 'closed']);
    // Every label has exactly one mark, hidden from assistive technology: the word is in the name.
    // The marks share one class and so one size: a label is as wide in one state as in another,
    // and a state that changes by itself moves nothing.
    for (const code of ['KOR-1', 'KOR-2', 'HAF-1']) {
      const marks = screen
        .getByRole('button', { name: new RegExp(`^${code} `) })
        .querySelectorAll('svg');
      expect(marks, code).toHaveLength(1);
      expect(marks[0], code).toHaveClass('office-glyph');
      expect(marks[0], code).toHaveAttribute('aria-hidden', 'true');
    }
    // Closed and idle are the figure of the desk: an outline, and the same figure filled.
    const figure = (code: string) =>
      screen
        .getByRole('button', { name: new RegExp(`^${code} `) })
        .querySelector('svg')
        ?.getAttribute('fill');
    expect(figure('HAF-1')).toBe('none');
    expect(figure('KOR-2')).toBe('currentColor');
    // The drawing itself says nothing about a state except through the attribute.
    expect(world.querySelectorAll('[fill], [stroke], [style]')).toHaveLength(0);
    // Every desk carries the two marks of its screen; the stylesheet shows the one of its state.
    for (const desk of world.querySelectorAll('.office-agent')) {
      expect(desk.querySelectorAll('.office-screen-dot, .office-screen-cross')).toHaveLength(2);
    }
  });

  it('lists in the legend only the states that an agent of this office has, in a fixed order', () => {
    const { rerender } = renderOffice();
    const rows = () =>
      within(screen.getByRole('list', { name: 'Durumlar' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(rows()).toEqual(['Kapalı', 'Boşta', 'Durduruldu']);
    // Every row carries the mark of the label, one per row.
    const legend = screen.getByRole('list', { name: 'Durumlar' });
    expect(legend.querySelectorAll('svg.office-glyph')).toHaveLength(3);
    expect(legend.querySelectorAll('svg')).toHaveLength(3);
    // The mark is the figure it explains: an outline for a closed agent, filled for an open one
    // without work. The filled figure never stands for an agent the company has not opened.
    const mark = (state: string) =>
      legend.querySelector(`li[data-state="${state}"] svg`)?.getAttribute('fill');
    expect(mark('closed')).toBe('none');
    expect(mark('idle')).toBe('currentColor');

    // The six states in their fixed order: what takes no work, what an open agent can show, what
    // a person has stopped.
    const six = ['running', 'stopped', 'error', 'closed', 'awaiting_approval', 'idle'] as const;
    rerender(
      <OfficeView
        companyName="Arma DX"
        units={[
          {
            code: 'KOR',
            name: 'Koordinasyon Katmanı',
            agents: six.map((state, index) => ({
              code: `KOR-${String(index + 1)}`,
              name: `Ajan ${String(index + 1)}`,
              state,
              ready: true,
              work: NO_WORK,
            })),
          },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(rows()).toEqual(['Kapalı', 'Boşta', 'Çalışıyor', 'Onay bekliyor', 'Hata', 'Durduruldu']);
    expect(legend.querySelectorAll('svg.office-glyph')).toHaveLength(6);

    // The pilot data of today: nobody has opened an agent.
    rerender(
      <OfficeView
        companyName="Arma DX"
        units={UNITS.map((unit) => ({
          ...unit,
          agents: unit.agents.map((agent) => ({ ...agent, state: 'closed' as const })),
        }))}
        centreUnit="HAF"
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(rows()).toEqual(['Kapalı']);
  });

  it('gives each zoom button a tooltip equal to its accessible name', () => {
    renderOffice();
    for (const name of ['Yakınlaştır', 'Uzaklaştır', 'Ekrana sığdır']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title', name);
    }
  });

  it('places every button with scene coordinates in custom properties and its placement', () => {
    renderOffice();
    const button = screen.getByRole('button', { name: /^KOR-1 / });
    expect(button.style.getPropertyValue('--sx')).not.toBe('');
    expect(button.style.getPropertyValue('--sy')).not.toBe('');
    expect(button).toHaveAttribute('data-placement', 'above');
    expect(screen.getByRole('button', { name: 'Kurumsal Hafıza, HAF, 1 ajan' })).toHaveAttribute(
      'data-placement',
      'card',
    );
  });

  it('fits the scene to the viewport on mount', () => {
    const { viewport, world } = renderOffice();
    expect(world.getAttribute('transform')).toBe(fittedTransform(VIEWPORT));
    expect(zoomOf(viewport)).toBeGreaterThan(ZOOM.min);
    expect(zoomOf(viewport)).toBeLessThanOrEqual(1);
    expect(viewport).toHaveAttribute('data-level', 'full');
  });
});

describe('OfficeView keyboard', () => {
  it('keeps one button in the tab order and moves it with the arrow keys', async () => {
    const user = userEvent.setup();
    const { viewport } = renderOffice();
    expect(labels().filter((button) => button.tabIndex === 0)).toHaveLength(1);

    await user.tab();
    expect(viewport).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Koordinasyon Katmanı, KOR, 2 ajan' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^İstasyon Verisi/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: /^HAF-1 / })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('button', { name: /^Kurumsal Hafıza/ })).toHaveFocus();
    expect(labels().filter((button) => button.tabIndex === 0)).toEqual([
      screen.getByRole('button', { name: /^Kurumsal Hafıza/ }),
    ]);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Yakınlaştır' })).toHaveFocus();
    // Coming back, the tab stop is the button that had the focus last.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: /^Kurumsal Hafıza/ })).toHaveFocus();
  });

  it('marks the room or desk of the focused button in the drawing', async () => {
    const user = userEvent.setup();
    const { world } = renderOffice();
    await user.tab();
    await user.tab();
    expect(world.querySelector('[data-active]')).toHaveAttribute('data-office-id', 'unit:KOR');
    await user.keyboard('{ArrowDown}');
    expect(world.querySelector('[data-active]')).toHaveAttribute('data-office-id', 'agent:KOR-1');
    await user.tab();
    expect(world.querySelector('[data-active]')).toBeNull();
  });

  it('tells keyboard focus from selection: each has its own mark, also on different things', async () => {
    const user = userEvent.setup();
    const { world } = renderOffice('agent:KOR-2');
    // The tab stop is the selected button; one step up is KOR-1.
    await user.tab();
    await user.tab();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveFocus();
    const focused = world.querySelector('[data-office-id="agent:KOR-1"]');
    const selected = world.querySelector('[data-office-id="agent:KOR-2"]');
    expect(focused).toHaveAttribute('data-active');
    expect(focused).not.toHaveAttribute('data-selected');
    expect(selected).toHaveAttribute('data-selected');
    expect(selected).not.toHaveAttribute('data-active');
    // On the same thing both marks are set; the style sheet lets the selection win.
    await user.keyboard('{ArrowDown}');
    expect(selected).toHaveAttribute('data-selected');
    expect(selected).toHaveAttribute('data-active');
  });

  it('shows the keys while the keyboard focus is in the scene, and describes the map with them', async () => {
    const user = userEvent.setup();
    const { viewport } = renderOffice();
    const hint = document.getElementById(viewport.getAttribute('aria-describedby') ?? '');
    if (!hint) throw new Error('no hint');
    const text =
      'Ok tuşları birimler ve ajanlar arasında gezdirir, Enter seçer. Harita odaktayken oklar ' +
      'kaydırır; artı yakınlaştırır, eksi uzaklaştırır, sıfır ekrana sığdırır.';
    expect(hint).toHaveTextContent(text);
    // Hidden, it is still what a screen reader hears when the map takes the focus.
    expect(hint).not.toBeVisible();
    expect(viewport).toHaveAccessibleDescription(text);

    await user.tab();
    expect(viewport).toHaveFocus();
    expect(hint).toBeVisible();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Koordinasyon Katmanı/ })).toHaveFocus();
    expect(hint).toBeVisible();
    await user.keyboard('{ArrowDown}');
    expect(hint).toBeVisible();
    // The zoom buttons are outside the map: the single-key shortcuts do not act there.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Yakınlaştır' })).toHaveFocus();
    expect(hint).not.toBeVisible();
  });

  it('keeps the keys hidden for a person who uses the pointer', async () => {
    const user = userEvent.setup();
    const { viewport } = renderOffice();
    const hint = document.getElementById(viewport.getAttribute('aria-describedby') ?? '');
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveFocus();
    expect(hint).not.toBeVisible();
    await user.click(viewport);
    expect(viewport).toHaveFocus();
    expect(hint).not.toBeVisible();
    // The first key press on the focused button brings them up.
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    await user.keyboard('{ArrowDown}');
    expect(hint).toBeVisible();
  });

  it('respects the mark of the shell when a script moves the focus after a press of the pointer', () => {
    const { viewport, world } = renderOffice();
    const hint = document.getElementById(viewport.getAttribute('aria-describedby') ?? '');
    // lib/input-kind.ts sets this on the root element; here the browser would still draw a ring.
    document.documentElement.dataset['input'] = 'pointer';
    act(() => {
      screen.getByRole('button', { name: /^KOR-1 / }).focus();
    });
    expect(hint).not.toBeVisible();
    expect(world.querySelector('[data-active]')).toBeNull();
    // Without the mark the same focus counts as the keyboard's.
    delete document.documentElement.dataset['input'];
    act(() => {
      screen.getByRole('button', { name: /^KOR-2 / }).focus();
    });
    expect(hint).toBeVisible();
    expect(world.querySelector('[data-active]')).toHaveAttribute('data-office-id', 'agent:KOR-2');
  });

  it('brings a button reached with the keyboard into view, 48 pixels inside the viewport', async () => {
    const user = userEvent.setup();
    const { viewport, world } = renderOffice();
    // The person zooms in: the room on the far right is cut off by the edge of the viewport.
    for (let step = 0; step < 3; step++) {
      await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    }
    const k = zoomOf(viewport);
    const extent = selectedExtent('unit:P-IST');
    const right = () => (extent.x + extent.width) * k + translateOf(world)[0];
    expect(right()).toBeGreaterThan(VIEWPORT.width);
    const [before] = translateOf(world);

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: /^Koordinasyon Katmanı/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^İstasyon Verisi/ })).toHaveFocus();
    const [x] = translateOf(world);
    expect(zoomOf(viewport)).toBe(k);
    expect(x).toBeLessThan(before);
    expect(right()).toBeCloseTo(VIEWPORT.width - 48, 8);
    expect(extent.x * k + x).toBeGreaterThanOrEqual(48);
  });

  it('keeps a button it brings into view clear of the keyboard hint, which lies over the top of the scene', async () => {
    const user = userEvent.setup();
    // The hint ends 72 pixels below the top edge, beyond the 48 pixel margin.
    HINT.height = 72;
    const { viewport, world } = renderOffice();
    for (let step = 0; step < 3; step++) {
      await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    }
    const k = zoomOf(viewport);
    const extent = selectedExtent('unit:KOR');
    const top = () => extent.y * k + translateOf(world)[1];
    // The room on the upper left is cut off by the top edge. The hint is hidden: the pointer
    // was used last.
    expect(top()).toBeLessThan(0);
    const hint = document.getElementById(viewport.getAttribute('aria-describedby') ?? '');
    expect(hint).not.toBeVisible();

    // The focus arrives with the keyboard: the hint shows, and the card comes in below it.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: /^Koordinasyon Katmanı/ })).toHaveFocus();
    expect(hint).toBeVisible();
    expect(top()).toBeCloseTo(72 + 8, 8);
    expect(extent.x * k + translateOf(world)[0]).toBeCloseTo(48, 8);
  });

  it('leaves a fitted view fitted when the keyboard walks over buttons that are in sight', async () => {
    const user = userEvent.setup();
    // Narrow: the width limits the fit, so the outermost rooms stand 16 pixels from the edge,
    // closer than the 48 pixels a button that was out of sight is brought in.
    VIEWPORT.width = 560;
    const { world } = renderOffice();
    const narrow = fittedTransform({ width: 560, height: 600 });
    expect(world.getAttribute('transform')).toBe(narrow);
    await user.tab();
    await user.tab();
    const walked: (string | null)[] = [];
    for (let step = 0; step < labels().length; step++) {
      walked.push(document.activeElement?.getAttribute('data-office-id') ?? null);
      expect(world.getAttribute('transform'), walked.at(-1) ?? '').toBe(narrow);
      await user.keyboard('{ArrowDown}');
    }
    expect(new Set(walked).size).toBe(labels().length);
    await user.keyboard('{Home}{ArrowRight}{End}');
    expect(world.getAttribute('transform')).toBe(narrow);
    // The view is still the fitted one: it follows the viewport.
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('selects with Enter and with Space, and clears the selection with Escape', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderOffice('agent:KOR-2');
    screen.getByRole('button', { name: /^KOR-1 / }).focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('agent:KOR-1');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
    await user.keyboard('{Escape}');
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('zooms with plus and minus and fits with zero, from anywhere in the scene', async () => {
    const user = userEvent.setup();
    const { viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    const start = zoomOf(viewport);
    screen.getByRole('button', { name: /^KOR-1 / }).focus();
    await user.keyboard('+');
    expect(zoomOf(viewport)).toBeCloseTo(start * ZOOM.step, 10);
    await user.keyboard('-');
    expect(zoomOf(viewport)).toBeCloseTo(start, 10);
    await user.keyboard('+');
    await user.keyboard('0');
    expect(world.getAttribute('transform')).toBe(fitted);
  });

  it('keeps the focused button in the canvas when a zoom key is pressed on it', async () => {
    const user = userEvent.setup();
    const { viewport, world } = renderOffice();
    // The desk on the far right: a zoom step around the middle of the canvas pushes it outwards.
    await user.tab();
    await user.tab();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(screen.getByRole('button', { name: /^P-IST-1 / })).toHaveFocus();
    const extent = selectedExtent('agent:P-IST-1');
    const start = zoomOf(viewport);
    for (const steps of [1, 2, 3]) {
      await user.keyboard('+');
      const k = zoomOf(viewport);
      expect(k).toBeCloseTo(start * ZOOM.step ** steps, 10);
      const [x, y] = translateOf(world);
      expect(extent.x * k + x, `left after ${steps}`).toBeGreaterThanOrEqual(48 - 1e-8);
      expect((extent.x + extent.width) * k + x, `right after ${steps}`).toBeLessThanOrEqual(
        VIEWPORT.width - 48 + 1e-8,
      );
      expect(extent.y * k + y, `top after ${steps}`).toBeGreaterThanOrEqual(48 - 1e-8);
      expect((extent.y + extent.height) * k + y, `bottom after ${steps}`).toBeLessThanOrEqual(
        VIEWPORT.height - 48 + 1e-8,
      );
    }
    // On the map itself the step stays around the middle of the canvas: nothing follows.
    await user.keyboard('0');
    viewport.focus();
    await user.keyboard('+');
    const view = fitted(VIEWPORT);
    const k = zoomOf(viewport);
    expect(translateOf(world)[0]).toBeCloseTo(500 - (k / view.k) * (500 - view.x), 8);
    expect(translateOf(world)[1]).toBeCloseTo(300 - (k / view.k) * (300 - view.y), 8);
  });

  it('leaves the browser shortcuts with Ctrl, Cmd and Alt alone', async () => {
    const user = userEvent.setup();
    const { viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    // Each chord on its own: one that zoomed could not be told from one that was undone by the
    // next. fireEvent answers false when the scene took the key from the browser.
    for (const target of [viewport, screen.getByRole('button', { name: /^KOR-1 / })]) {
      for (const key of ['+', '=', '-', '_', '0', 'ArrowLeft']) {
        for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
          const left = fireEvent.keyDown(target, { key, [modifier]: true });
          expect(left, `${modifier} ${key}`).toBe(true);
          expect(world.getAttribute('transform'), `${modifier} ${key}`).toBe(fitted);
        }
      }
    }
    // The page zoom's "actual size" does not fit a view the person chose.
    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    const chosen = world.getAttribute('transform');
    expect(chosen).not.toBe(fitted);
    expect(fireEvent.keyDown(viewport, { key: '0', metaKey: true })).toBe(true);
    expect(world.getAttribute('transform')).toBe(chosen);
    // Without a modifier the same keys are the scene's.
    expect(fireEvent.keyDown(viewport, { key: '0' })).toBe(false);
    expect(world.getAttribute('transform')).toBe(fitted);
  });

  it('pans with the arrow keys only while the viewport itself has the focus', async () => {
    const user = userEvent.setup();
    const { viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    const [x, y] = translateOf(world);
    screen.getByRole('button', { name: /^KOR-2 / }).focus();
    await user.keyboard('{ArrowUp}');
    expect(world.getAttribute('transform')).toBe(fitted);
    // On the first and on the last button an arrow has no button to go to: it still does not pan,
    // and the key is left to the browser.
    const first = screen.getByRole('button', { name: /^Koordinasyon Katmanı/ });
    const last = screen.getByRole('button', { name: /^HAF-1 / });
    expect(fireEvent.keyDown(first, { key: 'ArrowUp' })).toBe(true);
    expect(fireEvent.keyDown(first, { key: 'ArrowLeft' })).toBe(true);
    expect(fireEvent.keyDown(last, { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(last, { key: 'ArrowRight' })).toBe(true);
    expect(world.getAttribute('transform')).toBe(fitted);
    viewport.focus();
    await user.keyboard('{ArrowRight}');
    expect(translateOf(world)).toEqual([x - ZOOM.panStep, y]);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(translateOf(world)).toEqual([x - ZOOM.panStep, y - 4 * ZOOM.panStep]);
  });
});

describe('OfficeView pointer', () => {
  it('selects from a label, from a desk in the drawing, and clears on empty floor', async () => {
    const user = userEvent.setup();
    const { onSelect, viewport, world } = renderOffice();
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(onSelect).toHaveBeenLastCalledWith('agent:KOR-1');
    const desk = world.querySelector('[data-office-id="agent:P-IST-1"] .office-mat');
    if (!desk) throw new Error('no desk');
    await user.click(desk);
    expect(onSelect).toHaveBeenLastCalledWith('agent:P-IST-1');
    const floor = world.querySelector('[data-office-id="unit:KOR"] .office-slab-top');
    if (!floor) throw new Error('no floor');
    await user.click(floor);
    expect(onSelect).toHaveBeenLastCalledWith('unit:KOR');
    await user.click(viewport);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('clears the selection on a second click and marks the selected button and room', async () => {
    const user = userEvent.setup();
    const { onSelect, world } = renderOffice('unit:KOR');
    const button = screen.getByRole('button', {
      name: 'Koordinasyon Katmanı, KOR, 2 ajan',
      pressed: true,
    });
    expect(world.querySelector('[data-selected]')).toHaveAttribute('data-office-id', 'unit:KOR');
    await user.click(button);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('leaves no focus mark in the drawing after a click on a label and a second click to clear it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: string | null) => void>();
    const { world, rerender } = renderOffice();
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    rerender(office('agent:KOR-1', onSelect));
    expect(world.querySelector('[data-selected]')).toHaveAttribute('data-office-id', 'agent:KOR-1');
    expect(world.querySelector('[data-active]')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    rerender(office(null, onSelect));
    // The button still has the focus, but the pointer gave it: the desk looks like any other.
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toHaveFocus();
    expect(world.querySelector('[data-selected]')).toBeNull();
    expect(world.querySelector('[data-active]')).toBeNull();
  });

  it('does not move the fitted view when a label near the edge is clicked', async () => {
    const user = userEvent.setup();
    // Narrow: the outermost rooms stand 16 pixels from the edge, closer than the reveal margin.
    VIEWPORT.width = 560;
    const { world } = renderOffice();
    const narrow = fittedTransform({ width: 560, height: 600 });
    await user.click(screen.getByRole('button', { name: /^İstasyon Verisi/ }));
    await user.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(world.getAttribute('transform')).toBe(narrow);
    // The view is still the fitted one: it follows the viewport.
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('shows whose room or desk a card or a label is while the pointer is over it', () => {
    const { world } = renderOffice();
    const card = screen.getByRole('button', { name: /^Kurumsal Hafıza/ });
    fireEvent.pointerOver(card);
    expect(world.querySelector('[data-hover]')).toHaveAttribute('data-office-id', 'unit:HAF');
    expect(world.querySelectorAll('[data-hover]')).toHaveLength(1);
    fireEvent.pointerOut(card);
    expect(world.querySelector('[data-hover]')).toBeNull();

    // The text inside a label counts as the label.
    const code = screen.getByRole('button', { name: /^KOR-2 / }).querySelector('.office-code');
    if (!code) throw new Error('no code');
    fireEvent.pointerOver(code);
    expect(world.querySelector('[data-hover]')).toHaveAttribute('data-office-id', 'agent:KOR-2');
    fireEvent.pointerOut(code);
    expect(world.querySelector('[data-hover]')).toBeNull();
  });

  it('pans on a drag and drops the click that ends it', () => {
    const { onSelect, viewport, world } = renderOffice();
    const before = translateOf(world);
    const button = screen.getByRole('button', { name: /^KOR-1 / });
    fireEvent.pointerDown(button, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(button, { ...HELD, clientX: 102, clientY: 101 });
    expect(viewport).not.toHaveAttribute('data-dragging');
    fireEvent.pointerMove(button, { ...HELD, clientX: 160, clientY: 130 });
    expect(viewport).toHaveAttribute('data-dragging');
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerUp(viewport, { pointerId: 1, isPrimary: true, clientX: 160, clientY: 130 });
    fireEvent.click(viewport);
    expect(viewport).not.toHaveAttribute('data-dragging');
    expect(onSelect).not.toHaveBeenCalled();

    const after = translateOf(world);
    expect(after[0] - before[0]).toBeCloseTo(60, 10);
    expect(after[1] - before[1]).toBeCloseTo(30, 10);

    // The next plain click selects again.
    fireEvent.pointerDown(button, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(button, { pointerId: 1, isPrimary: true, clientX: 10, clientY: 10 });
    fireEvent.click(button);
    expect(onSelect).toHaveBeenLastCalledWith('agent:KOR-1');
  });

  it('ignores the secondary mouse button and a second pointer', () => {
    const { viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    fireEvent.pointerDown(viewport, { pointerId: 1, isPrimary: true, button: 2, clientX: 0 });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      isPrimary: true,
      buttons: 2,
      clientX: 80,
      clientY: 80,
    });
    fireEvent.pointerDown(viewport, { pointerId: 2, isPrimary: false, button: 0, clientX: 0 });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      isPrimary: false,
      buttons: 1,
      clientX: 80,
      clientY: 80,
    });
    expect(world.getAttribute('transform')).toBe(fitted);
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('does not start a drag from a press with Ctrl, which opens the context menu on macOS', () => {
    const { viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    // The menu takes the release: no pointerup follows, and the next moves have no button down.
    fireEvent.pointerDown(viewport, { ...PRESS, ctrlKey: true, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { ...HELD, ctrlKey: true, clientX: 180, clientY: 160 });
    fireEvent.pointerMove(viewport, { ...FREE, clientX: 260, clientY: 220 });
    expect(world.getAttribute('transform')).toBe(fitted);
    expect(viewport).not.toHaveAttribute('data-dragging');
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it('drops a press whose release went elsewhere: the scene does not follow a pointer with no button down', () => {
    const { onSelect, viewport, world } = renderOffice();
    const fitted = world.getAttribute('transform');
    // Pressed near the edge and released over the top bar, before the press became a drag: the
    // viewport never sees the release. The pointer comes back with no button down.
    fireEvent.pointerDown(viewport, { ...PRESS, clientX: 100, clientY: 2 });
    fireEvent.pointerMove(viewport, { ...FREE, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(viewport, { ...FREE, clientX: 340, clientY: 440 });
    expect(world.getAttribute('transform')).toBe(fitted);
    expect(viewport).not.toHaveAttribute('data-dragging');
    expect(setPointerCapture).not.toHaveBeenCalled();

    // The same for a drag whose release was lost: it ends with the first move without a button.
    fireEvent.pointerDown(viewport, { ...PRESS, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { ...HELD, clientX: 160, clientY: 130 });
    expect(viewport).toHaveAttribute('data-dragging');
    const dragged = world.getAttribute('transform');
    expect(dragged).not.toBe(fitted);
    fireEvent.pointerMove(viewport, { ...FREE, clientX: 400, clientY: 300 });
    expect(viewport).not.toHaveAttribute('data-dragging');
    expect(world.getAttribute('transform')).toBe(dragged);
    // No click followed that drag, so the next click is not dropped.
    fireEvent.click(screen.getByRole('button', { name: /^KOR-1 / }));
    expect(onSelect).toHaveBeenLastCalledWith('agent:KOR-1');
  });

  it('ends a drag that never ended when the next press begins', () => {
    const { viewport } = renderOffice();
    fireEvent.pointerDown(viewport, { ...PRESS, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { ...HELD, clientX: 160, clientY: 130 });
    expect(viewport).toHaveAttribute('data-dragging');
    // The press of a second pointer (another finger) is not the next press: the drag goes on.
    fireEvent.pointerDown(viewport, {
      pointerId: 2,
      isPrimary: false,
      button: 0,
      buttons: 1,
      clientX: 300,
      clientY: 300,
    });
    expect(viewport).toHaveAttribute('data-dragging');
    // No release and no move in between: the next press is a plain click.
    fireEvent.pointerDown(viewport, { ...PRESS, clientX: 300, clientY: 300 });
    expect(viewport).not.toHaveAttribute('data-dragging');
    fireEvent.pointerUp(viewport, { ...FREE, clientX: 300, clientY: 300 });
    expect(viewport).not.toHaveAttribute('data-dragging');
  });

  it('selects with Enter right after a drag that was cancelled: no click is waiting to be dropped', async () => {
    const user = userEvent.setup();
    const { onSelect, viewport } = renderOffice();
    fireEvent.pointerDown(viewport, { ...PRESS, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { ...HELD, clientX: 160, clientY: 130 });
    fireEvent.pointerCancel(viewport, { ...FREE, clientX: 160, clientY: 130 });
    expect(viewport).not.toHaveAttribute('data-dragging');
    screen.getByRole('button', { name: /^KOR-1 / }).focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('agent:KOR-1');
  });

  it('zooms at the cursor on wheel and keeps the page from scrolling', () => {
    const { viewport, world } = renderOffice();
    const start = zoomOf(viewport);
    const [x, y] = translateOf(world);
    // The scene point under the cursor before the zoom.
    const cursor = { x: 300, y: 200 };
    const scene = { x: (cursor.x - x) / start, y: (cursor.y - y) / start };
    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: cursor.x,
      clientY: cursor.y,
    });
    // The listener is native, so React only flushes the state update inside act.
    act(() => {
      viewport.dispatchEvent(wheel);
    });
    expect(wheel.defaultPrevented).toBe(true);
    const k = zoomOf(viewport);
    expect(k).toBeCloseTo(start * Math.exp(0.2), 10);
    const [nx, ny] = translateOf(world);
    expect(scene.x * k + nx).toBeCloseTo(cursor.x, 8);
    expect(scene.y * k + ny).toBeCloseTo(cursor.y, 8);
  });

  it('zooms faster for a trackpad pinch, which arrives as a wheel event with ctrlKey', () => {
    const { viewport } = renderOffice();
    const start = zoomOf(viewport);
    fireEvent.wheel(viewport, { deltaY: -10, ctrlKey: true, clientX: 500, clientY: 300 });
    expect(zoomOf(viewport)).toBeCloseTo(start * Math.exp(0.1), 10);
  });

  it('follows a Safari pinch through gesture events', () => {
    const { viewport } = renderOffice();
    const start = zoomOf(viewport);
    const gesture = (type: string, scale: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: 500, clientY: 300 });
      act(() => {
        viewport.dispatchEvent(event);
      });
      return event;
    };
    expect(gesture('gesturestart', 1).defaultPrevented).toBe(true);
    gesture('gesturechange', 1.1);
    gesture('gesturechange', 1.21);
    expect(zoomOf(viewport)).toBeCloseTo(start * 1.21, 10);
  });

  it('never leaves the zoom limits', () => {
    const { viewport } = renderOffice();
    for (let i = 0; i < 12; i++) {
      fireEvent.wheel(viewport, { deltaY: -5000, clientX: 500, clientY: 300 });
    }
    expect(zoomOf(viewport)).toBe(ZOOM.max);
    for (let i = 0; i < 12; i++) {
      fireEvent.wheel(viewport, { deltaY: 5000, clientX: 500, clientY: 300 });
    }
    expect(zoomOf(viewport)).toBe(ZOOM.min);
    expect(viewport).toHaveAttribute('data-level', 'units');
    expect(Number(viewport.style.getPropertyValue('--office-s'))).toBe(0.85);
  });

  it('zooms with the buttons', async () => {
    const user = userEvent.setup();
    const { viewport } = renderOffice();
    const start = zoomOf(viewport);
    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    expect(zoomOf(viewport)).toBeCloseTo(start * ZOOM.step, 10);
    await user.click(screen.getByRole('button', { name: 'Uzaklaştır' }));
    await user.click(screen.getByRole('button', { name: 'Uzaklaştır' }));
    expect(zoomOf(viewport)).toBeCloseTo(start / ZOOM.step, 10);
    await user.click(screen.getByRole('button', { name: 'Ekrana sığdır' }));
    expect(zoomOf(viewport)).toBeCloseTo(start, 10);
  });
});

describe('OfficeView fitting', () => {
  it('fits again when the viewport changes size, until the person moves the view', async () => {
    const user = userEvent.setup();
    const { world } = renderOffice();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));

    // The properties panel opens and takes 320 pixels.
    VIEWPORT.width = 680;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 680, height: 600 }));

    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    const chosen = world.getAttribute('transform');
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(chosen);

    await user.click(screen.getByRole('button', { name: 'Ekrana sığdır' }));
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('uses the largest allowed label sizes, at the full level, until the labels are measured', () => {
    laidOut = false;
    // So narrow that the unmeasured scene only fits below the level at which labels are measured.
    VIEWPORT.width = 560;
    const { viewport, world } = renderOffice();
    const narrow = { width: 560, height: 600 };
    expect(fitted(narrow, false).k).toBeLessThan(0.85);
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow, false));
    expect(viewport).toHaveAttribute('data-level', 'full');

    laidOut = true;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
    expect(zoomOf(viewport)).toBeGreaterThan(fitted(narrow, false).k);
  });

  it('measures labels at the full level only: the shorter labels of the code level do not change the fit', () => {
    // As in a browser: a label that shows only its code is narrower than the whole one.
    codeLabel = { width: 60, height: 24 };
    // So narrow that the scene fits below the level at which labels are whole.
    VIEWPORT.width = 560;
    const narrow = { width: 560, height: 600 };
    const { viewport, world } = renderOffice();
    expect(fitted(narrow).k).toBeLessThan(0.85);
    expect(viewport).toHaveAttribute('data-level', 'code');
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
    // The browser reports the new, shorter sizes. Taken into the bounds they would enlarge the
    // fit, the names would come back, the labels would widen and the fit would shrink again.
    reportSize();
    reportSize();
    expect(viewport).toHaveAttribute('data-level', 'code');
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
  });

  it('fits the scene again on a resize with something selected, unless the page holds the view', () => {
    const onSelect = vi.fn<(id: string | null) => void>();
    const { world, rerender } = renderOffice();
    rerender(office('unit:P-IST', onSelect));
    VIEWPORT.width = 680;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 680, height: 600 }));
    VIEWPORT.height = 400;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 680, height: 400 }));
  });

  it('reads the label sizes again when the fonts are in, also at a level that shows only codes', async () => {
    const fonts = stubFonts();
    // So narrow that the scene fits below the level at which labels are whole and measured.
    VIEWPORT.width = 560;
    const narrow = { width: 560, height: 600 };
    // The fallback font draws the labels wider than the panel's own font will.
    LABEL.width = 190;
    const { viewport, world, unmount } = renderOffice();
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
    // Still loading: the labels stay whole, so that what is measured next is their full width.
    expect(zoomOf(viewport)).toBeLessThan(0.85);
    expect(viewport).toHaveAttribute('data-level', 'full');

    LABEL.width = 150;
    const stale = world.getAttribute('transform');
    await fonts.loaded();
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
    expect(world.getAttribute('transform')).not.toBe(stale);
    expect(zoomOf(viewport)).toBeLessThan(0.85);
    expect(viewport).toHaveAttribute('data-level', 'code');

    // A font that loads later (a letter no name had before) is followed as well.
    LABEL.width = 170;
    fonts.loadingDone();
    expect(world.getAttribute('transform')).toBe(fittedTransform(narrow));
    expect(viewport).toHaveAttribute('data-level', 'code');

    unmount();
    expect(fonts.listeners.size).toBe(0);
  });

  it('with holdView, keeps the zoom when a panel opens for a selection, and fits again afterwards', () => {
    const onSelect = vi.fn<(id: string | null) => void>();
    const { viewport, world, rerender } = renderOffice(null, true);
    const before = fitted({ width: 1000, height: 600 });

    // The person selects the room on the far right; the page opens the panel, which takes 320 pixels.
    rerender(office('unit:P-IST', onSelect, true));
    VIEWPORT.width = 680;
    reportSize();
    expect(zoomOf(viewport)).toBe(before.k);
    const [x, y] = translateOf(world);
    expect(y).toBe(before.y);
    // The view moved left just far enough to bring the room and its card inside the margin.
    expect(x).toBeLessThan(before.x);
    const extent = selectedExtent('unit:P-IST');
    expect((extent.x + extent.width) * before.k + x).toBeCloseTo(680 - 48, 8);
    expect(extent.x * before.k + x).toBeGreaterThanOrEqual(48);
    expect(screen.getByRole('button', { name: /^İstasyon Verisi/, pressed: true })).toBeVisible();

    // A room that is in sight anyway moves nothing.
    rerender(office('unit:HAF', onSelect, true));
    reportSize();
    expect(translateOf(world)).toEqual([x, y]);

    // The selection is cleared, the panel closes: the scene follows the viewport again.
    rerender(office(null, onSelect, true));
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('with holdView, keeps a thing selected with the keyboard clear of the hint when the panel opens', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: string | null) => void>();
    HINT.height = 72;
    // Short: the height limits the fit, so the topmost card stands 16 pixels below the top edge.
    VIEWPORT.height = 442;
    const { viewport, world, rerender } = renderOffice(null, true);
    const before = fitted({ width: 1000, height: 442 });
    const extent = selectedExtent('unit:KOR');
    expect(extent.y * before.k + before.y).toBe(16);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Koordinasyon Katmanı/ })).toHaveFocus();
    // In sight already: the fitted view does not move for the focus, hint or not.
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 442 }));

    // Enter selects; the page opens the panel, which takes 320 pixels, and the hint moves with
    // the right edge of the canvas. The view is held at its zoom and the card comes out from
    // under the hint.
    rerender(office('unit:KOR', onSelect, true));
    VIEWPORT.width = 680;
    reportSize();
    expect(zoomOf(viewport)).toBe(before.k);
    expect(extent.y * before.k + translateOf(world)[1]).toBeCloseTo(72 + 8, 8);
  });

  it('with holdView, keeps the usual margin at the top when the panel opens for a selection made with the pointer', () => {
    const onSelect = vi.fn<(id: string | null) => void>();
    // The hint would end 72 pixels below the top edge, but it is hidden: no key was pressed.
    HINT.height = 72;
    VIEWPORT.height = 442;
    const { viewport, world, rerender } = renderOffice(null, true);
    const before = fitted({ width: 1000, height: 442 });
    const extent = selectedExtent('unit:KOR');
    rerender(office('unit:KOR', onSelect, true));
    VIEWPORT.width = 680;
    reportSize();
    expect(zoomOf(viewport)).toBe(before.k);
    expect(extent.y * before.k + translateOf(world)[1]).toBeCloseTo(48, 8);
  });

  it('with holdView, brings a thing chosen outside the scene into view and still fits again afterwards', () => {
    const onSelect = vi.fn<(id: string | null) => void>();
    const handle = createRef<OfficeViewHandle>();
    const { viewport, world, rerender } = renderOffice(null, true);
    const before = fitted({ width: 1000, height: 600 });

    // The room on the left is selected and the panel opens: the view is held at its zoom.
    rerender(office('unit:KOR', onSelect, true, handle));
    VIEWPORT.width = 680;
    reportSize();
    expect(zoomOf(viewport)).toBe(before.k);
    const held = translateOf(world);

    // The page selects the room on the far right from its panel. A new selection alone moves
    // nothing; the page asks the scene to show it.
    rerender(office('unit:P-IST', onSelect, true, handle));
    expect(translateOf(world)).toEqual(held);
    act(() => {
      handle.current?.revealItem('unit:P-IST');
    });
    expect(zoomOf(viewport)).toBe(before.k);
    const [x, y] = translateOf(world);
    expect(x).toBeLessThan(held[0]);
    expect(y).toBe(held[1]);
    const extent = selectedExtent('unit:P-IST');
    expect((extent.x + extent.width) * before.k + x).toBeCloseTo(680 - 48, 8);

    // The scene moved the view, not the person: it is fitted again when the selection is gone.
    rerender(office(null, onSelect, true, handle));
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('with holdView, following the keyboard focus beside the panel does not take the view over', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: string | null) => void>();
    const { world, rerender } = renderOffice(null, true);
    rerender(office('unit:KOR', onSelect, true));
    VIEWPORT.width = 680;
    reportSize();
    const held = world.getAttribute('transform');

    // The arrow key moves the focus from the selected card to the next unit, the room on the far
    // right, which is partly out of sight: the view follows.
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: /^Koordinasyon Katmanı/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: /^İstasyon Verisi/ })).toHaveFocus();
    expect(world.getAttribute('transform')).not.toBe(held);

    rerender(office(null, onSelect, true));
    VIEWPORT.width = 1000;
    reportSize();
    expect(world.getAttribute('transform')).toBe(fittedTransform({ width: 1000, height: 600 }));
  });

  it('with holdView, a view the person moved beside the panel stays theirs', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn<(id: string | null) => void>();
    const handle = createRef<OfficeViewHandle>();
    const { viewport, world, rerender } = renderOffice(null, true);
    rerender(office('unit:KOR', onSelect, true, handle));
    VIEWPORT.width = 680;
    reportSize();

    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    const zoomed = zoomOf(viewport);
    const own = world.getAttribute('transform');
    rerender(office('unit:P-IST', onSelect, true, handle));
    act(() => {
      handle.current?.revealItem('unit:P-IST');
    });
    // The room is brought into view at the person's zoom.
    expect(zoomOf(viewport)).toBe(zoomed);
    const chosen = world.getAttribute('transform');
    expect(chosen).not.toBe(own);

    rerender(office(null, onSelect, true, handle));
    VIEWPORT.width = 1000;
    reportSize();
    expect(zoomOf(viewport)).toBe(zoomed);
    expect(world.getAttribute('transform')).toBe(chosen);
  });

  it('leaves a fitted view alone when the page asks to show a thing: the whole office is in sight', () => {
    const handle = createRef<OfficeViewHandle>();
    // Narrow: the outermost rooms stand 16 pixels from the edge, closer than the reveal margin.
    VIEWPORT.width = 560;
    render(office('unit:P-IST', vi.fn(), true, handle));
    reportSize();
    const world = screen.getByTestId('office-world');
    const narrow = fittedTransform({ width: 560, height: 600 });
    expect(world.getAttribute('transform')).toBe(narrow);
    act(() => {
      handle.current?.revealItem('unit:P-IST');
    });
    expect(world.getAttribute('transform')).toBe(narrow);
  });

  it('moves the focus to the button of a unit or an agent when the page asks for it', () => {
    const handle = createRef<OfficeViewHandle>();
    render(office(null, vi.fn(), false, handle));
    reportSize();
    const label = screen.getByRole('button', { name: /^KOR-2 / });
    act(() => {
      handle.current?.focusItem('agent:KOR-2');
    });
    expect(label).toHaveFocus();
    // It is the one button in the tab order from now on.
    expect(label).toHaveAttribute('tabindex', '0');
    expect(labels().filter((button) => button.tabIndex === 0)).toEqual([label]);

    // A thing the scene does not hold: nothing happens.
    act(() => {
      handle.current?.focusItem('agent:KOR-9');
      handle.current?.revealItem('agent:KOR-9');
    });
    expect(label).toHaveFocus();
    expect(screen.getByTestId('office-world').getAttribute('transform')).toBe(
      fittedTransform({ width: 1000, height: 600 }),
    );
  });

  it('stays visible at the identity view when no size was ever reported', () => {
    const onSelect = vi.fn();
    render(
      <OfficeView companyName="Arma DX" units={UNITS} selectedId={null} onSelect={onSelect} />,
    );
    expect(screen.getByTestId('office-world').getAttribute('transform')).toBe(
      'translate(0 0) scale(1)',
    );
    expect(screen.getByRole('button', { name: /^KOR-1 / })).toBeInTheDocument();
  });

  it('draws an empty office without rooms and without a tab stop in the list', () => {
    render(<OfficeView companyName="Arma DX" units={[]} selectedId={null} onSelect={vi.fn()} />);
    reportSize();
    expect(screen.getByRole('figure', { name: 'Arma DX ofisi: 0 birim, 0 ajan' })).toBeVisible();
    expect(screen.getByTestId('office-world').querySelectorAll('g.office-unit')).toHaveLength(0);
    expect(within(screen.getByRole('list', { name: 'Birimler' })).queryAllByRole('button')).toEqual(
      [],
    );
  });
});

describe('OfficeView data refresh', () => {
  it('keeps the view, the tab stop and the selection when the same data arrives again', async () => {
    const user = userEvent.setup();
    const { world, rerender } = renderOffice('agent:KOR-2');
    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    screen.getByRole('button', { name: /^P-IST-1 / }).focus();
    const chosen = world.getAttribute('transform');
    rerender(
      <OfficeView
        companyName="Arma DX"
        units={UNITS.map((unit) => ({ ...unit, agents: [...unit.agents] }))}
        centreUnit="HAF"
        selectedId="agent:KOR-2"
        onSelect={vi.fn()}
      />,
    );
    expect(world.getAttribute('transform')).toBe(chosen);
    expect(screen.getByRole('button', { name: /^P-IST-1 / })).toHaveFocus();
    expect(screen.getByRole('button', { name: /^KOR-2 /, pressed: true })).toBeInTheDocument();
  });

  it('shows a changed state without moving anything', () => {
    const { world, rerender } = renderOffice();
    const fitted = world.getAttribute('transform');
    const before = world.querySelector('[data-office-id="unit:KOR"] .office-slab-top');
    rerender(
      <OfficeView
        companyName="Arma DX"
        units={UNITS.map((unit) => ({
          ...unit,
          agents: unit.agents.map((agent) =>
            agent.code === 'KOR-2' ? { ...agent, state: 'stopped' as const } : agent,
          ),
        }))}
        centreUnit="HAF"
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(world.getAttribute('transform')).toBe(fitted);
    expect(world.querySelector('[data-office-id="agent:KOR-2"]')).toHaveAttribute(
      'data-state',
      'stopped',
    );
    expect(screen.getByRole('button', { name: /^KOR-2 .*, Durduruldu$/ })).toBeInTheDocument();
    // The room is the same DOM node: nothing was remounted.
    expect(world.querySelector('[data-office-id="unit:KOR"] .office-slab-top')).toBe(before);
  });
});
