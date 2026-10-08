import { memo } from 'react';
import { boxFaces, byDepth, ISO, project, type Box, type ScenePoint } from '@/lib/office/iso';
import type { OfficeLayout, Rect, RoomPlacement } from '@/lib/office/layout';
import { agentId, unitId, type AgentState } from '@/lib/office/model';
import { OVERLAY } from '@/lib/office/overlay';

/** Half the side of the state mat under a desk, in tiles. */
const MAT_HALF = 2;

/** Corner radius of the ring around a desk, in scene pixels. */
const RING_RADIUS = 4;

/** A rectangle of floor at ground level, as a box without height. */
function flat(rect: Rect): Box {
  return { x: rect.x, y: rect.y, z: 0, w: rect.w, d: rect.d, h: 0 };
}

/** The slab of a room: its top is the floor, its sides hang below it. */
function slabOf(rect: Rect): Box {
  const h = OVERLAY.slab / ISO.rise;
  return { x: rect.x, y: rect.y, z: -h, w: rect.w, d: rect.d, h };
}

/** An extruded box: two side faces and the top, painted in that order. */
function Slab({ box }: { box: Box }) {
  const faces = boxFaces(box);
  return (
    <>
      <polygon className="office-slab-left" points={faces.left} />
      <polygon className="office-slab-right" points={faces.right} />
      <polygon className="office-slab-top" points={faces.top} />
    </>
  );
}

/**
 * Desk, monitor, figure and chair, seen from the front. The sprite is not projected: it stands
 * upright on a point of the floor, so one drawing serves every room. Coordinates are scene pixels
 * from the foot of the sprite (bottom centre); parts are painted far to near. Every desk carries
 * the two marks of the screen; which one shows is the stylesheet's, by the state of the desk.
 */
function DeskSprite({ foot }: { foot: ScenePoint }) {
  return (
    <g className="office-sprite" transform={`translate(${foot.x} ${foot.y})`}>
      <rect className="office-monitor" x={-10} y={-44} width={20} height={13} rx={2} />
      {/* What the screen shows for a result that waits for approval (a dot) and for an error (a
          cross); office.css paints the one the state of the desk asks for. */}
      <circle className="office-screen-dot" cx={0} cy={-37.5} r={2.5} />
      <path className="office-screen-cross" d="M-3 -40.5 L3 -34.5 M3 -40.5 L-3 -34.5" />
      <rect className="office-stand" x={-1} y={-31} width={2} height={9} />
      <rect className="office-leg" x={-22} y={-17} width={3} height={13} />
      <rect className="office-leg" x={19} y={-17} width={3} height={13} />
      <rect className="office-desk" x={-24} y={-22} width={48} height={5} />
      <rect className="office-figure" x={-7} y={-24} width={14} height={12} rx={4} />
      <circle className="office-figure" cx={0} cy={-29} r={5} />
      <rect className="office-chair" x={-8} y={-14} width={16} height={10} rx={3} />
      <path className="office-chair-foot" d="M0 -4 V0 M-6 0 H6" />
    </g>
  );
}

/** The mark of a room or a desk: present as an empty attribute, or absent. */
function mark(on: boolean): '' | undefined {
  return on ? '' : undefined;
}

interface RoomProps {
  room: RoomPlacement;
  states: ReadonlyMap<string, AgentState>;
  selectedId: string | null;
  activeId: string | null;
  hoverId: string | null;
}

function Room({ room, states, selectedId, activeId, hoverId }: RoomProps) {
  const id = unitId(room.unit);
  const slab = slabOf(room.rect);
  // Far desks first, so a sprite in a nearer row is painted over the one behind it.
  const desks = [...room.desks].sort(byDepth);
  return (
    <g
      className="office-unit"
      data-office-id={id}
      data-selected={mark(selectedId === id)}
      data-active={mark(activeId === id)}
      data-hover={mark(hoverId === id)}
    >
      <Slab box={slab} />
      <polygon className="office-ring" points={boxFaces(slab).outline} />
      {desks.map((desk) => {
        const deskIdValue = agentId(desk.agent);
        const foot = project(desk.x, desk.y);
        const half = MAT_HALF;
        const mat = boxFaces(
          flat({ x: desk.x - half, y: desk.y - half, w: 2 * half, d: 2 * half }),
        ).top;
        return (
          <g
            key={desk.agent}
            className="office-agent"
            data-office-id={deskIdValue}
            data-state={states.get(desk.agent)}
            data-selected={mark(selectedId === deskIdValue)}
            data-active={mark(activeId === deskIdValue)}
            data-hover={mark(hoverId === deskIdValue)}
          >
            {/* The mat takes the pointer for the whole desk; transparent is hit, fill none would not be. */}
            <polygon className="office-mat" points={mat} />
            <DeskSprite foot={foot} />
            {/*
              The ring goes around the sprite, not around the mat: a label hangs 4 pixels from the
              sprite and a card can stand as close, so the outline of the mat lay under them.
            */}
            <rect
              className="office-ring"
              x={foot.x - OVERLAY.spriteWidth / 2 - OVERLAY.ringPad}
              y={foot.y - OVERLAY.spriteHeight - OVERLAY.ringPad}
              width={OVERLAY.spriteWidth + 2 * OVERLAY.ringPad}
              height={OVERLAY.spriteHeight + 2 * OVERLAY.ringPad}
              rx={RING_RADIUS}
            />
          </g>
        );
      })}
    </g>
  );
}

export interface OfficeSceneProps {
  layout: OfficeLayout;
  /** Look of each agent's desk, by agent code. */
  states: ReadonlyMap<string, AgentState>;
  /** The selected unit or agent: a solid ring. */
  selectedId: string | null;
  /** The unit or agent whose button has the keyboard focus: a dashed ring. */
  activeId: string | null;
  /** The unit or agent whose card or label is under the pointer. */
  hoverId: string | null;
}

/**
 * The drawing: walkways, then rooms far to near, each with its desks far to near. Purely visual;
 * every name, state and control lives in the label layer, so this subtree is hidden from assistive
 * technology by its svg parent. No color and no number that depends on a state is written here:
 * state, selection, focus and hover are data attributes, and office.css turns them into fills and
 * strokes.
 */
export const OfficeScene = memo(function OfficeScene({
  layout,
  states,
  selectedId,
  activeId,
  hoverId,
}: OfficeSceneProps) {
  return (
    <>
      {layout.walkways.map((walkway) => (
        <polygon
          key={`${walkway.x},${walkway.y}`}
          className="office-walkway"
          points={boxFaces(flat(walkway)).top}
        />
      ))}
      {layout.paintOrder.map((index) => {
        const room = layout.rooms[index];
        if (!room) return null;
        return (
          <Room
            key={room.unit}
            room={room}
            states={states}
            selectedId={selectedId}
            activeId={activeId}
            hoverId={hoverId}
          />
        );
      })}
    </>
  );
});
