// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/OrgChart.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501:
// the viewport with one SVG layer and one HTML layer under the same view (lines 505-523, 568-605)
// and the three zoom buttons (525-566).
// License text: THIRD_PARTY_NOTICES.md.
// Changes: the HTML layer is translated only and its buttons scale themselves, Turkish labels,
// tokens instead of palette classes, no frame around the viewport, keyboard handling; the zoom
// buttons are the shell's Button.

import {
  memo,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { Minus, Plus, Scan } from 'lucide-react';
import { OfficeScene } from '@/components/office/office-scene';
import { Button } from '@/components/ui/button';
import { layoutOffice } from '@/lib/office/layout';
import {
  AGENT_STATE_LABEL,
  agentId,
  shortName,
  unitId,
  type AgentState,
  type OfficeUnit,
} from '@/lib/office/model';
import {
  detailLevel,
  extentOf,
  overlayAnchors,
  overlayBoxes,
  overlayScale,
  sceneBounds,
  type OverlayAnchor,
} from '@/lib/office/overlay';
import { nextItem, type RovingItem } from '@/lib/office/roving';
import { useOfficeView } from '@/lib/office/use-office-view';
import type { Size } from '@/lib/office/view';
import { RUN_STATUS } from '@/lib/status';
import './office.css';

const NO_SIZES: ReadonlyMap<string, Size> = new Map();

/** The fonts of the document; a browser without the font loading API (and jsdom) has none. */
function fontSet(): FontFaceSet | undefined {
  return 'fonts' in document ? document.fonts : undefined;
}

/**
 * The sizes of these cards and labels as the browser lays them out now, added to the known ones
 * (offsetWidth is not affected by the zoom). The same map when nothing changed.
 */
function withSizes(
  current: ReadonlyMap<string, Size>,
  targets: Iterable<Element>,
): ReadonlyMap<string, Size> {
  let next: Map<string, Size> | null = null;
  for (const target of targets) {
    if (!(target instanceof HTMLElement)) continue;
    const id = target.dataset['officeId'];
    const size = { width: target.offsetWidth, height: target.offsetHeight };
    if (id === undefined || size.width === 0 || size.height === 0) continue;
    const known = (next ?? current).get(id);
    if (known?.width === size.width && known.height === size.height) continue;
    next ??= new Map(current);
    next.set(id, size);
  }
  return next ?? current;
}

/** The keys that zoom by one step (lib/office/use-office-view.ts). */
const ZOOM_KEYS: ReadonlySet<string> = new Set(['+', '=', '-', '_']);

/** The office id of the element a pointer or key event started on, or null for empty floor. */
function officeIdOf(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-office-id]')?.getAttribute('data-office-id') ?? null;
}

/**
 * True when the element that took the focus got it from the keyboard: the browser would draw the
 * focus ring on it, and the shell has not marked the last input as a press of the pointer (a script
 * may move the focus after a click; lib/input-kind.ts).
 */
function focusedByKeyboard(target: Element): boolean {
  return (
    target.matches(':focus-visible') && document.documentElement.dataset['input'] !== 'pointer'
  );
}

/** Position of a label: scene pixels in two custom properties; CSS multiplies them by the zoom. */
function anchorStyle(anchor: OverlayAnchor | undefined): CSSProperties {
  return { '--sx': anchor?.x ?? 0, '--sy': anchor?.y ?? 0 } as CSSProperties;
}

// A stopped agent and a stopped run share one glyph and one tone (the status language).
const StoppedIcon = RUN_STATUS.stopped.icon;

/** The glyph of a state. Closed and enabled have none: the figure alone tells them apart. */
function StateGlyph({ state }: { state: AgentState }) {
  if (state !== 'stopped') return null;
  return <StoppedIcon aria-hidden="true" className="office-glyph" />;
}

interface OfficeLabelsProps {
  units: readonly OfficeUnit[];
  anchors: ReadonlyMap<string, OverlayAnchor>;
  /** Prefix of the DOM ids of the buttons; the id of a button is the prefix, a hyphen and its office id. */
  idPrefix: string;
  selectedId: string | null;
  tabStopId: string | null;
}

/**
 * The names and controls of the scene: a list of units, each with the list of its agents, in
 * reading order. The buttons are placed over the drawing and are real text at every zoom.
 */
const OfficeLabels = memo(function OfficeLabels({
  units,
  anchors,
  idPrefix,
  selectedId,
  tabStopId,
}: OfficeLabelsProps) {
  return (
    <ul role="list" aria-label="Birimler">
      {units.map((unit) => {
        const id = unitId(unit.code);
        return (
          <li key={unit.code}>
            <button
              type="button"
              id={`${idPrefix}-${id}`}
              className="office-anchor office-card"
              style={anchorStyle(anchors.get(id))}
              data-office-id={id}
              data-placement="card"
              tabIndex={tabStopId === id ? 0 : -1}
              aria-pressed={selectedId === id}
              // The code is part of the name because it is part of the visible text, and at the
              // code level it is the only visible text besides the count.
              aria-label={`${unit.name}, ${unit.code}, ${unit.agents.length} ajan`}
            >
              <span aria-hidden="true" className="office-card-name">
                {unit.name}
              </span>
              <span aria-hidden="true" className="office-card-meta">
                <span className="office-tag">{unit.code}</span>
                <span>
                  <span className="office-count tabular-nums">{unit.agents.length}</span> ajan
                </span>
              </span>
            </button>
            <ul role="list" aria-label={`${unit.name} ajanları`}>
              {unit.agents.map((agent) => {
                const itemId = agentId(agent.code);
                const anchor = anchors.get(itemId);
                const tooltip = `${agent.code} ${agent.name}`;
                return (
                  <li key={agent.code}>
                    <button
                      type="button"
                      id={`${idPrefix}-${itemId}`}
                      className="office-anchor office-label"
                      style={anchorStyle(anchor)}
                      data-office-id={itemId}
                      data-placement={anchor?.placement}
                      data-state={agent.state}
                      tabIndex={tabStopId === itemId ? 0 : -1}
                      aria-pressed={selectedId === itemId}
                      aria-label={`${agent.code} ${agent.name}, ${unit.name}, ${AGENT_STATE_LABEL[agent.state]}`}
                    >
                      <StateGlyph state={agent.state} />
                      {/* The tooltip is on the text, not on the button: there it would be the
                          button's description, and a screen reader would say code and name twice. */}
                      <span aria-hidden="true" className="office-code tabular-nums" title={tooltip}>
                        {agent.code}
                      </span>
                      <span aria-hidden="true" className="office-name" title={tooltip}>
                        {shortName(agent.name)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
});

/** Order of the legend: what takes no work, what takes work, what a person has stopped. */
const LEGEND_ORDER: readonly AgentState[] = ['closed', 'enabled', 'stopped'];

/** The small figure of the legend for the two states that have no glyph: outline or filled. */
function FigureMark({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" fill={filled ? 'currentColor' : 'none'}>
      <circle cx={7} cy={4} r={2.5} stroke="currentColor" />
      <rect x={3.5} y={7.5} width={7} height={6} rx={2} stroke="currentColor" />
    </svg>
  );
}

/** One row per state that an agent of this office has; a state nobody has is not listed. */
function OfficeLegend({ states }: { states: ReadonlySet<AgentState> }) {
  return (
    <ul role="list" aria-label="Durumlar" className="office-legend">
      {LEGEND_ORDER.filter((state) => states.has(state)).map((state) => (
        <li key={state} data-state={state}>
          {state === 'stopped' ? (
            <StateGlyph state={state} />
          ) : (
            <FigureMark filled={state === 'enabled'} />
          )}
          {AGENT_STATE_LABEL[state]}
        </li>
      ))}
    </ul>
  );
}

// The scene moves under the zoom buttons, so their ground is opaque in both themes (the outline
// button of the shell is translucent in the dark theme).
const CONTROL_CLASS =
  'bg-surface hover:bg-surface-muted dark:bg-surface dark:hover:bg-surface-muted';

/** What the page can ask of the scene from outside it (from the detail of the selection). */
export interface OfficeViewHandle {
  /** Moves the keyboard focus to the button of a unit or an agent (unit:KOR, agent:KOR-1). */
  focusItem: (id: string) => void;
  /**
   * Pans as little as needed to bring a unit or an agent into the viewport; the zoom stays. A view
   * that is fitted to the viewport is left alone.
   */
  revealItem: (id: string) => void;
}

export interface OfficeViewProps {
  companyName: string;
  units: readonly OfficeUnit[];
  /** Code of the unit that stands in the middle of the office, when the company has it. */
  centreUnit?: string;
  /** The selected unit or agent (unit:KOR, agent:KOR-1); the page keeps it. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /**
   * Keep the zoom while something is selected and the viewport changes size (the page shows the
   * selection in a panel beside the scene). Without it a resize fits the scene as usual.
   */
  holdView?: boolean;
  ref?: Ref<OfficeViewHandle>;
}

/** The office view: an isometric drawing with pan and zoom, and a list of buttons laid over it. */
export function OfficeView({
  companyName,
  units,
  centreUnit,
  selectedId,
  onSelect,
  holdView = false,
  ref,
}: OfficeViewProps) {
  const prefix = useId();
  const layout = useMemo(
    () =>
      layoutOffice(
        units.map((unit) => ({ code: unit.code, agents: unit.agents.map((agent) => agent.code) })),
        centreUnit === undefined ? {} : { centreUnit },
      ),
    [units, centreUnit],
  );
  const items = useMemo<RovingItem[]>(
    () =>
      units.flatMap((unit) => [
        { id: unitId(unit.code), kind: 'unit' as const },
        ...unit.agents.map((agent) => ({ id: agentId(agent.code), kind: 'agent' as const })),
      ]),
    [units],
  );
  const states = useMemo(
    () => new Map(units.flatMap((unit) => unit.agents.map((agent) => [agent.code, agent.state]))),
    [units],
  );
  const present = useMemo(() => new Set(states.values()), [states]);
  const anchorList = useMemo(() => overlayAnchors(layout), [layout]);
  const anchors = useMemo(
    () => new Map(anchorList.map((anchor) => [anchor.id, anchor])),
    [anchorList],
  );

  // Sizes of the cards and labels as the browser lays them out. They are measured at the full
  // detail level only, so the bounds, and with them the fitted zoom, never depend on the level the
  // fitted zoom itself selects. Until every card and label has been measured once the level is
  // held at full (see `level` below): the first fit uses the largest allowed sizes and could
  // otherwise land on a level at which nothing is measured.
  const [labelLayer, attachLabelLayer] = useState<HTMLDivElement | null>(null);
  const [sizes, setSizes] = useState(NO_SIZES);
  useLayoutEffect(() => {
    if (!labelLayer) return;
    const observer = new ResizeObserver((entries) => {
      if (labelLayer.closest('[data-level]')?.getAttribute('data-level') !== 'full') return;
      flushSync(() => {
        setSizes((current) =>
          withSizes(
            current,
            entries.map((entry) => entry.target),
          ),
        );
      });
    });
    for (const anchor of labelLayer.querySelectorAll('.office-anchor')) observer.observe(anchor);
    return () => {
      observer.disconnect();
    };
  }, [labelLayer, anchorList]);

  // A label is first laid out in the fallback font when the panel's font is still loading, and at
  // a shorter level a later change of its full width cannot be seen. So the sizes are read again
  // when the fonts are in: `measuring` holds the level at full for that reading. Without it the
  // first fit of a narrow window kept the widths of the fallback font until the next zoom step.
  const [measuring, setMeasuring] = useState(() => fontSet() !== undefined);
  useLayoutEffect(() => {
    const fonts = fontSet();
    if (!labelLayer || !fonts) return;
    let stopped = false;
    const remeasure = () => {
      if (stopped) return;
      // Every label whole, then their sizes, then the level follows the zoom again.
      flushSync(() => {
        setMeasuring(true);
      });
      flushSync(() => {
        setSizes((current) => withSizes(current, labelLayer.querySelectorAll('.office-anchor')));
        setMeasuring(false);
      });
    };
    void fonts.ready.then(remeasure);
    fonts.addEventListener('loadingdone', remeasure);
    return () => {
      stopped = true;
      fonts.removeEventListener('loadingdone', remeasure);
    };
  }, [labelLayer, anchorList]);

  const boxes = useMemo(() => overlayBoxes(anchorList, sizes), [anchorList, sizes]);
  const bounds = useMemo(() => sceneBounds(layout, boxes), [layout, boxes]);
  // The label and desk of the selected agent, or the card and floor of the selected unit.
  const selectedExtent = useMemo(
    () => (selectedId === null ? null : extentOf(layout, boxes, selectedId)),
    [layout, boxes, selectedId],
  );
  // The keyboard hint lies over the top right corner of the scene while it is shown: what the view
  // brings into sight for the keyboard is kept clear of it.
  const [hint, attachHint] = useState<HTMLParagraphElement | null>(null);
  const { view, fitted, dragging, attach, handlers, zoomIn, zoomOut, fit, show } = useOfficeView(
    bounds,
    holdView ? selectedExtent : null,
    hint,
  );
  const measured = !measuring && anchorList.every((anchor) => sizes.has(anchor.id));
  const level = measured ? detailLevel(view.k) : 'full';

  useImperativeHandle(
    ref,
    () => ({
      focusItem: (id) => {
        // As with the arrow keys: onFocus pans the view, and the browser scrolls nothing.
        document.getElementById(`${prefix}-${id}`)?.focus({ preventScroll: true });
      },
      revealItem: (id) => {
        // A fitted view has the whole office in sight already, and it stays fitted.
        if (fitted) return;
        const extent = extentOf(layout, boxes, id);
        if (extent) show(extent);
      },
    }),
    [prefix, layout, boxes, fitted, show],
  );

  // The button that has the keyboard focus; the drawing shows a dashed ring on its room or desk.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The card or label under the pointer; the drawing shows whose room or desk it is.
  const [hoverId, setHoverId] = useState<string | null>(null);
  // True while the keyboard focus is on the viewport or on one of its buttons: the keys are told.
  const [keyboardInside, setKeyboardInside] = useState(false);
  // The one button in the tab order: the last focused, else the selected, else the first.
  const [lastFocusedId, setLastFocusedId] = useState<string | null>(null);
  const known = (id: string | null) => (id !== null && anchors.has(id) ? id : null);
  const tabStopId = known(lastFocusedId) ?? known(selectedId) ?? items[0]?.id ?? null;

  const agentCount = units.reduce((sum, unit) => sum + unit.agents.length, 0);
  const summary = `${units.length} birim, ${agentCount} ajan`;
  const hintId = `${prefix}-hint`;

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const id = officeIdOf(event.target);
    // A second click on the selected thing, or a click on empty floor, clears the selection.
    onSelect(id === selectedId ? null : id);
  };

  // The focus is on the viewport or moved to one of its buttons.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const keyboard = focusedByKeyboard(event.target);
    // Applied at once: the hint is laid out before the view moves below, which keeps clear of it.
    flushSync(() => {
      setKeyboardInside(keyboard);
    });
    const id = event.target instanceof HTMLButtonElement ? officeIdOf(event.target) : null;
    // A click leaves no ring behind: only a focus the keyboard gave marks the room or desk.
    setActiveId(keyboard ? id : null);
    if (id === null) return;
    setLastFocusedId(id);
    if (!keyboard) return;
    // A button reached with the keyboard may be out of sight; one that was clicked is not, and a
    // click must not move the scene under the pointer or end the fitted view.
    const extent = extentOf(layout, boxes, id);
    if (extent) show(extent);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    // Moving between the viewport and its buttons is followed by onFocus, which decides anew.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setActiveId(null);
    setKeyboardInside(false);
  };

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    setHoverId(officeIdOf(event.target));
  };

  const onPointerOut = () => {
    setHoverId(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selectedId !== null) {
      event.preventDefault();
      onSelect(null);
      return;
    }
    const id = officeIdOf(event.target);
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    const next = id === null || modified ? null : nextItem(items, id, event.key);
    if (next !== null) {
      event.preventDefault();
      // The view pans to the button in onFocus; the browser must not scroll anything on its own.
      document.getElementById(`${prefix}-${next}`)?.focus({ preventScroll: true });
      return;
    }
    // Every other key is the view's (pan, zoom, fit).
    handlers.onKeyDown(event);
    // A zoom step keeps the middle of the canvas where it is, which can push the button that has
    // the focus out of the canvas: the view follows that button, as it does in onFocus.
    if (id === null || !event.defaultPrevented || !ZOOM_KEYS.has(event.key)) return;
    const extent = extentOf(layout, boxes, id);
    if (extent) show(extent);
  };

  return (
    <figure
      className="office-view relative flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={`${companyName} ofisi: ${summary}`}
    >
      <figcaption className="office-caption">{summary}</figcaption>
      <div
        ref={attach}
        role="group"
        aria-label="Ofis haritası"
        aria-describedby={hintId}
        tabIndex={0}
        className="office-viewport min-h-0 flex-1"
        data-dragging={dragging ? '' : undefined}
        data-level={level}
        style={{ '--office-k': view.k, '--office-s': overlayScale(view.k) } as CSSProperties}
        {...handlers}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <svg aria-hidden="true" focusable="false" className="absolute inset-0 size-full">
          <g
            className="office-world"
            data-testid="office-world"
            transform={`translate(${view.x} ${view.y}) scale(${view.k})`}
          >
            <OfficeScene
              layout={layout}
              states={states}
              selectedId={selectedId}
              activeId={activeId}
              hoverId={hoverId}
            />
          </g>
        </svg>
        <div
          ref={attachLabelLayer}
          className="office-labels"
          style={{ transform: `translate(${view.x}px, ${view.y}px)` }}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
        >
          <OfficeLabels
            units={units}
            anchors={anchors}
            idPrefix={prefix}
            selectedId={selectedId}
            tabStopId={tabStopId}
          />
        </div>
      </div>
      <OfficeLegend states={present} />
      {/* Hidden, it still describes the viewport: a screen reader hears the keys when the map takes the focus. */}
      <p ref={attachHint} id={hintId} className="office-hint" hidden={!keyboardInside}>
        Ok tuşları birimler ve ajanlar arasında gezdirir, Enter seçer. Harita odaktayken oklar
        kaydırır; artı yakınlaştırır, eksi uzaklaştırır, sıfır ekrana sığdırır.
      </p>
      <div className="office-controls">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={CONTROL_CLASS}
          aria-label="Yakınlaştır"
          title="Yakınlaştır"
          onClick={zoomIn}
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={CONTROL_CLASS}
          aria-label="Uzaklaştır"
          title="Uzaklaştır"
          onClick={zoomOut}
        >
          <Minus aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={CONTROL_CLASS}
          aria-label="Ekrana sığdır"
          title="Ekrana sığdır"
          onClick={fit}
        >
          <Scan aria-hidden="true" />
        </Button>
      </div>
    </figure>
  );
}
