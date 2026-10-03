import type { Invitation } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import { formatDateTime, invitationActions } from './users.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const CREATED = Date.parse('2026-10-03T09:00:00.000Z');

function invitation(overrides: Partial<Invitation>): Invitation {
  return {
    id: '3f4a5b6c-7d8e-4f90-a112-c3d4e5f6a7b8',
    email: 'yeni@armadx.com',
    role: 'employee',
    canApprove: false,
    createdAt: new Date(CREATED).toISOString(),
    expiresAt: new Date(CREATED + 7 * DAY_MS).toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('formatDateTime', () => {
  it('shows the day with the time, in Turkish', () => {
    // 09:00 UTC is 10 October in every time zone from UTC-9 to UTC+14.
    expect(formatDateTime('2026-10-10T09:00:00.000Z')).toMatch(/^10 Ekim 2026 \d{2}:\d{2}$/);
  });
});

describe('invitationActions', () => {
  it('offers extending and cancelling for an open invitation', () => {
    const pending = invitation({});
    expect(invitationActions(pending, CREATED + DAY_MS)).toEqual({
      canExtend: true,
      canCancel: true,
    });
    const expired = invitation({ status: 'expired' });
    expect(invitationActions(expired, CREATED + 10 * DAY_MS)).toEqual({
      canExtend: true,
      canCancel: true,
    });
  });

  it('offers only cancelling past the 30-day limit, or once the time reaches it', () => {
    const expired = invitation({ status: 'expired' });
    expect(invitationActions(expired, CREATED + 30 * DAY_MS)).toEqual({
      canExtend: false,
      canCancel: true,
    });
    const atLimit = invitation({ expiresAt: new Date(CREATED + 30 * DAY_MS).toISOString() });
    expect(invitationActions(atLimit, CREATED + 25 * DAY_MS)).toEqual({
      canExtend: false,
      canCancel: true,
    });
  });

  it('offers nothing for an accepted or cancelled invitation', () => {
    for (const status of ['accepted', 'cancelled'] as const) {
      expect(invitationActions(invitation({ status }), CREATED + DAY_MS)).toEqual({
        canExtend: false,
        canCancel: false,
      });
    }
  });
});
