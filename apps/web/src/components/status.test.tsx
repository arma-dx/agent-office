import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import css from '@/index.css?raw';
import {
  APPROVAL_STATUS,
  APPROVAL_STATUSES,
  RUN_STATUS,
  RUN_STATUSES,
  STATUS_TONES,
  TASK_STATUS,
  TASK_STATUSES,
  type StatusSpec,
} from '@/lib/status';
import { readTokens } from '@/test/contrast';
import { StatusBadge, StatusIcon } from './status.tsx';

const ALL: StatusSpec[] = [
  ...TASK_STATUSES.map((status) => TASK_STATUS[status]),
  ...APPROVAL_STATUSES.map((status) => APPROVAL_STATUS[status]),
  ...RUN_STATUSES.map((status) => RUN_STATUS[status]),
];

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
