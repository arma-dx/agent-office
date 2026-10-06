// Parts adapted from Paperclip (MIT License, Copyright (c) 2025 Paperclip AI).
// Source: ui/src/pages/OrgChart.tsx at commit dd868ed125cd709506dd9b29fca640a44d580501:
// the click that is dropped after a drag (lines 275-284, 445-455, 622-627).
// License text: THIRD_PARTY_NOTICES.md.
// Changes: pointer events with capture instead of mouse and touch handlers, a flag that is cleared
// by the next press instead of a 400 ms timer, a native wheel listener that is not passive.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { flushSync } from 'react-dom';
import {
  fitView,
  IDENTITY,
  keepInSight,
  panBy,
  reveal,
  wheelFactor,
  ZOOM,
  zoomAt,
  type Box2,
  type Size,
  type View,
} from './view.ts';

/** Pixels the pointer has to travel before a press becomes a drag; below that it stays a click. */
const DRAG_THRESHOLD = 4;

/** Pixels kept between the selected or focused thing and the edge of the viewport. */
const REVEAL_MARGIN = 48;

/**
 * fit: the scene follows the viewport. own: the person has panned or zoomed. held: the fitted view
 * was frozen because the viewport changed size while something was selected (the properties panel
 * opened); it goes back to fit when the selection is gone.
 */
type Mode = { readonly kind: 'fit' } | { readonly kind: 'own' | 'held'; readonly view: View };

const FIT: Mode = { kind: 'fit' };

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly origin: View;
  moved: boolean;
}

export interface OfficeViewHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export interface OfficeViewApi {
  readonly view: View;
  /** True while the scene follows the viewport: the whole office is in sight, as far as it fits. */
  readonly fitted: boolean;
  readonly dragging: boolean;
  /** Callback ref for the viewport element. */
  readonly attach: (element: HTMLDivElement | null) => void;
  readonly handlers: OfficeViewHandlers;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly fit: () => void;
  /**
   * Pans as little as needed to bring a box of the scene into the viewport: the keyboard focus
   * moved there, or it was selected from outside the scene.
   */
  readonly show: (box: Box2) => void;
}

function sizeOf(element: HTMLElement): Size {
  return { width: element.clientWidth, height: element.clientHeight };
}

/** WebKit's gesture events are not in lib.dom; their fields are read through guards instead of a cast. */
function gestureOf(event: Event): { scale: number; clientX: number; clientY: number } | null {
  if (!('scale' in event) || typeof event.scale !== 'number' || event.scale <= 0) return null;
  if (!('clientX' in event) || typeof event.clientX !== 'number') return null;
  if (!('clientY' in event) || typeof event.clientY !== 'number') return null;
  return { scale: event.scale, clientX: event.clientX, clientY: event.clientY };
}

/** The view on the screen: the fitted one, or the person's own, kept in sight of the viewport. */
function resolve(mode: Mode, size: Size | null, bounds: Box2): View {
  if (mode.kind === 'fit') return (size ? fitView(size, bounds) : null) ?? IDENTITY;
  return size ? keepInSight(mode.view, size, bounds) : mode.view;
}

/**
 * Pan and zoom state of the office viewport. The scene is fitted to the viewport until the person
 * moves it; after that the view is theirs, and a data refresh or a resize never resets it.
 *
 * `keep` is the box of the selected thing in the scene, or null. While it is set, a change of the
 * viewport size does not fit the scene again: the zoom stays, and the view pans only as far as
 * needed to keep that box in sight. Selecting something therefore never changes the size of the
 * drawing, although the properties panel takes a third of the width.
 *
 * The fitted view is not stored: it is computed during render from the viewport size and the
 * bounds, so a change of either (the detail panel opens, a label is measured) shows in the same
 * render, without an effect that sets state.
 */
export function useOfficeView(bounds: Box2, keep: Box2 | null = null): OfficeViewApi {
  // The element is kept in state, not in a ref: the effects below start when it mounts, and the
  // hook can return its values in one object without handing a ref through render.
  const [element, attach] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [mode, setMode] = useState<Mode>(FIT);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);

  const view = resolve(mode, size, bounds);

  // What the resize observer needs of the latest render. Written in a layout effect, which runs
  // before the browser lays out and reports the new size.
  const latest = useRef<{ bounds: Box2; keep: Box2 | null; size: Size | null }>({
    bounds,
    keep,
    size: null,
  });
  useLayoutEffect(() => {
    latest.current.bounds = bounds;
    latest.current.keep = keep;
  }, [bounds, keep]);

  // Every change goes through here: it starts from the view on the screen, also when several
  // events arrive between two renders, and it never lets the scene leave the viewport. A move the
  // person made (`own`) makes the view theirs. One the scene made to follow the focus or a
  // selection leaves a held view held, so it still goes back to the fitted one with the selection.
  const move = (next: (current: View) => View, own: boolean) => {
    setMode((current) => {
      const before = resolve(current, size, bounds);
      const after = next(before);
      // A change that moves nothing leaves a fitted view fitted.
      if (after === before) return current;
      return {
        kind: !own && current.kind === 'held' ? 'held' : 'own',
        view: size ? keepInSight(after, size, bounds) : after,
      };
    });
  };
  const change = (next: (current: View) => View) => {
    move(next, true);
  };

  // The observer is started in a layout effect and reports before the browser paints; flushSync
  // makes React apply the size in that same frame, so the scene is never painted unfitted first.
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = sizeOf(element);
      const previous = latest.current.size;
      latest.current.size = next;
      const point = latest.current.keep;
      const box = latest.current.bounds;
      flushSync(() => {
        setSize(next);
        setMode((current) => {
          // Nothing is selected: a view that was only held follows the viewport again.
          if (point === null) return current.kind === 'held' ? FIT : current;
          if (current.kind !== 'fit') {
            return { kind: current.kind, view: reveal(current.view, point, next, REVEAL_MARGIN) };
          }
          // Something is selected and the viewport changed size: keep the view of the old size.
          const before = previous ? fitView(previous, box) : null;
          if (!before || (previous?.width === next.width && previous.height === next.height)) {
            return current;
          }
          return { kind: 'held', view: reveal(before, point, next, REVEAL_MARGIN) };
        });
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  // React registers wheel listeners as passive, so preventDefault has no effect in onWheel. The
  // listener is native and not passive: the page must not scroll, and a trackpad pinch must not
  // zoom the whole browser page.
  useEffect(() => {
    if (!element) return;

    const zoom = (clientX: number, clientY: number, factor: number) => {
      const rect = element.getBoundingClientRect();
      const anchor = { x: clientX - rect.left, y: clientY - rect.top };
      setMode((current) => {
        const after = zoomAt(resolve(current, size, bounds), anchor, factor);
        return { kind: 'own', view: size ? keepInSight(after, size, bounds) : after };
      });
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.clientX, event.clientY, wheelFactor(event));
    };

    // Safari on macOS reports a trackpad pinch as gesture events with a cumulative scale.
    let lastScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = gestureOf(event);
      if (!gesture) return;
      zoom(gesture.clientX, gesture.clientY, gesture.scale / lastScale);
      lastScale = gesture.scale;
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart);
    element.addEventListener('gesturechange', onGestureChange);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
    };
  }, [element, size, bounds]);

  const zoomAtCentre = (factor: number) => {
    if (!size) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    change((current) => zoomAt(current, centre, factor));
  };

  const fit = () => {
    setMode(FIT);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!current.moved) return;
    // The click that follows a drag goes to the viewport (it holds the capture) and is dropped there.
    swallowClick.current = true;
    setDragging(false);
  };

  const handlers: OfficeViewHandlers = {
    onPointerDown: (event) => {
      swallowClick.current = false;
      if (event.button !== 0 || !event.isPrimary) return;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: view,
        moved: false,
      };
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      if (!current.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        current.moved = true;
        // Capture only once the press is a drag: capturing on pointerdown would take the click
        // away from the buttons inside the scene.
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }
      change(() => panBy(current.origin, dx, dy));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onClickCapture: (event) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onKeyDown: (event) => {
      // Ctrl and Cmd with plus, minus and zero belong to the browser's own page zoom.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const onViewport = event.target === event.currentTarget;
      const step = event.shiftKey ? ZOOM.panStep * 4 : ZOOM.panStep;
      switch (event.key) {
        case '+':
        case '=':
          zoomAtCentre(ZOOM.step);
          break;
        case '-':
        case '_':
          zoomAtCentre(1 / ZOOM.step);
          break;
        case '0':
          fit();
          break;
        // Arrow keys pan only while the viewport itself has the focus; on a unit or agent button
        // they move between the buttons (see roving.ts).
        case 'ArrowLeft':
          if (!onViewport) return;
          change((current) => panBy(current, step, 0));
          break;
        case 'ArrowRight':
          if (!onViewport) return;
          change((current) => panBy(current, -step, 0));
          break;
        case 'ArrowUp':
          if (!onViewport) return;
          change((current) => panBy(current, 0, step));
          break;
        case 'ArrowDown':
          if (!onViewport) return;
          change((current) => panBy(current, 0, -step));
          break;
        default:
          return;
      }
      event.preventDefault();
    },
  };

  return {
    view,
    fitted: mode.kind === 'fit',
    dragging,
    attach,
    handlers,
    zoomIn: () => {
      zoomAtCentre(ZOOM.step);
    },
    zoomOut: () => {
      zoomAtCentre(1 / ZOOM.step);
    },
    fit,
    show: (box) => {
      if (!size) return;
      move((current) => reveal(current, box, size, REVEAL_MARGIN), false);
    },
  };
}
