import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import css from '@/index.css?raw';
import {
  APPROVAL_STATUS,
  APPROVAL_STATUSES,
  RUN_STATUS,
  RUN_STATUSES,
  STATUS_TONES,
  statusSpec,
  TASK_STATUS,
  TASK_STATUSES,
  type StatusRef,
  type StatusSpec,
} from '@/lib/status';
import { readTokens } from '@/test/contrast';
import { StatusBadge, StatusIcon } from './status.tsx';

const ALL: StatusSpec[] = [
  ...TASK_STATUSES.map((status) => TASK_STATUS[status]),
  ...APPROVAL_STATUSES.map((status) => APPROVAL_STATUS[status]),
  ...RUN_STATUSES.map((status) => RUN_STATUS[status]),
];

const ALL_REFS: StatusRef[] = [
  ...TASK_STATUSES.map((status) => ({ kind: 'task', status }) as const),
  ...APPROVAL_STATUSES.map((status) => ({ kind: 'approval', status }) as const),
  ...RUN_STATUSES.map((status) => ({ kind: 'run', status }) as const),
];

/** The icon (by its lucide name) and the color role of each status, in the order of `statuses`. */
function signs<S extends string>(statuses: readonly S[], table: Record<S, StatusSpec>) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      `${table[status].icon.displayName ?? ''}, ${table[status].tone}`,
    ]),
  );
}

describe('status language', () => {
  it('pins the label of every status (the run labels are proposals awaiting the founder)', () => {
    expect(TASK_STATUSES.map((status) => TASK_STATUS[status].label)).toEqual([
      'Açık',
      'Sürüyor',
      'Onay bekliyor',
      'Yanıt bekliyor',
      'Tamamlandı',
      'İptal',
    ]);
    expect(APPROVAL_STATUSES.map((status) => APPROVAL_STATUS[status].label)).toEqual([
      'Bekliyor',
      'Onaylandı',
      'Düzeltme istendi',
      'Reddedildi',
    ]);
    expect(RUN_STATUSES.map((status) => RUN_STATUS[status].label)).toEqual([
      'Sürüyor',
      'Tamamlandı',
      'Hata',
      'Sınıra takıldı',
      'Durduruldu',
    ]);
  });

  it('pins the icon and the color role of every status', () => {
    // One icon and one color per status, the same on every screen (5 October 2026, decision 11).
    // A changed row here is a change of the status language; the run rows and the approval colors
    // are proposals awaiting the founder.
    expect(signs(TASK_STATUSES, TASK_STATUS)).toEqual({
      open: 'Circle, open',
      in_progress: 'ProgressCircle, in-progress',
      awaiting_approval: 'CircleDot, awaiting-approval',
      awaiting_reply: 'CircleQuestionMark, awaiting-reply',
      done: 'CircleCheck, done',
      cancelled: 'Ban, cancelled',
    });
    expect(signs(APPROVAL_STATUSES, APPROVAL_STATUS)).toEqual({
      pending: 'CircleDot, awaiting-approval',
      approved: 'CircleCheck, done',
      changes_requested: 'CircleArrowLeft, open',
      rejected: 'CircleX, error',
    });
    expect(signs(RUN_STATUSES, RUN_STATUS)).toEqual({
      running: 'ProgressCircle, in-progress',
      completed: 'CircleCheck, done',
      failed: 'CircleAlert, error',
      limit_reached: 'CircleMinus, error',
      stopped: 'CircleStop, cancelled',
    });
  });

  it('gives every status a known tone, and one icon and one tone per label', () => {
    for (const spec of ALL) expect(STATUS_TONES).toContain(spec.tone);
    // The same label always comes with the same icon and color, whatever the record is.
    const byLabel = new Map<string, StatusSpec>();
    for (const spec of ALL) {
      const seen = byLabel.get(spec.label);
      if (seen)
        expect({ icon: seen.icon, tone: seen.tone }).toEqual({ icon: spec.icon, tone: spec.tone });
      byLabel.set(spec.label, spec);
    }
  });

  it('has an icon tone, a fill and a text tone in the stylesheet for every tone', () => {
    // tokens.test.ts measures these tokens; this ties the tone names used here to them.
    const tokens = Object.keys(readTokens(css, ':root'));
    for (const tone of STATUS_TONES) {
      expect(tokens).toEqual(
        expect.arrayContaining([
          `--status-${tone}`,
          `--status-${tone}-fill`,
          `--status-${tone}-text`,
        ]),
      );
    }
  });

  it('tells the statuses of one kind apart by shape, not only by color', () => {
    for (const specs of [
      TASK_STATUSES.map((status) => TASK_STATUS[status]),
      APPROVAL_STATUSES.map((status) => APPROVAL_STATUS[status]),
      RUN_STATUSES.map((status) => RUN_STATUS[status]),
    ]) {
      expect(new Set(specs.map((spec) => spec.icon)).size).toBe(specs.length);
    }
  });
});

describe('StatusIcon', () => {
  it('is decorative next to a label and draws 16 px in the status color', () => {
    const { container } = render(<StatusIcon kind="task" status="done" />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '16');
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(icon).toHaveClass('text-status-done');
  });

  it('is announced with the status label when it stands alone', () => {
    render(<StatusIcon kind="approval" status="changes_requested" labelled size="lg" />);
    const icon = screen.getByRole('img', { name: 'Düzeltme istendi' });
    expect(icon).toHaveAttribute('width', '20');
    expect(icon).toHaveClass('text-status-open');
  });
});

describe('every status', () => {
  it.each(ALL_REFS)('$kind $status is drawn in the classes of its own color role', (ref) => {
    const { tone, label } = statusSpec(ref);
    const otherTones = STATUS_TONES.filter((other) => other !== tone);
    const { container } = render(
      <>
        <StatusIcon {...ref} labelled />
        <StatusBadge {...ref} />
      </>,
    );
    // The icon takes the icon tone of the role (3:1 on every surface).
    const icon = screen.getByRole('img', { name: label });
    expect(icon).toHaveClass(`text-status-${tone}`);
    for (const other of otherTones) expect(icon).not.toHaveClass(`text-status-${other}`);
    // The badge takes the border, the fill and the text tone of the same role: the text tone is
    // the one measured at 4.5:1 on that fill (tokens.test.ts), the icon tone is not.
    const badge = container.querySelector('span');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass(
      `border-status-${tone}`,
      `bg-status-${tone}-fill`,
      `text-status-${tone}-text`,
    );
    expect(badge).not.toHaveClass(`text-status-${tone}`);
    for (const other of otherTones) {
      expect(badge).not.toHaveClass(`border-status-${other}`);
      expect(badge).not.toHaveClass(`bg-status-${other}-fill`);
      expect(badge).not.toHaveClass(`text-status-${other}-text`);
    }
  });
});

describe('StatusBadge', () => {
  it('shows the label on the status fill with a 14 px decorative icon', () => {
    const { container } = render(<StatusBadge kind="run" status="limit_reached" />);
    const badge = screen.getByText('Sınıra takıldı');
    expect(badge).toHaveClass(
      'bg-status-error-fill',
      'text-status-error-text',
      'border-status-error',
    );
    const icon = container.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '14');
  });
});
