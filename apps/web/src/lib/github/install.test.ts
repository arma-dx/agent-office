import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forgetInstall,
  INSTALL_STATE_MAX_AGE_MS,
  installHref,
  matchInstall,
  newInstallState,
  startInstall,
} from './install.ts';

const INSTALL_URL = 'https://github.com/apps/arma-dx-agent-office-yerel/installations/new';
const NOW = Date.parse('2026-10-12T09:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the state of the way to GitHub and back', () => {
  it('makes a new state of 32 random bytes every time, written as base64url', () => {
    const first = newInstallState();
    const second = newInstallState();
    // 32 bytes are 43 characters of base64 without padding.
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("adds the state to the API's install address and to no other address", () => {
    expect(installHref(INSTALL_URL, 'abc-123')).toBe(`${INSTALL_URL}?state=abc-123`);
    // An address that already has a query keeps it.
    expect(installHref(`${INSTALL_URL}?target_id=7`, 's')).toBe(
      `${INSTALL_URL}?target_id=7&state=s`,
    );
    // Nothing that is not on github.com becomes a link.
    expect(installHref('https://github.com.example.org/apps/x/installations/new', 's')).toBeNull();
    expect(installHref('http://github.com/apps/x/installations/new', 's')).toBeNull();
    expect(installHref('javascript:alert(1)', 's')).toBeNull();
    expect(installHref('', 's')).toBeNull();
  });

  it('matches the return to the company the installation was started from', () => {
    startInstall('pillika', 'state-one', NOW);
    expect(matchInstall('state-one', NOW + 60_000)).toBe('pillika');
    // Reading changes nothing: the page reads in a render, which may run twice.
    expect(matchInstall('state-one', NOW + 60_000)).toBe('pillika');
    forgetInstall();
    expect(matchInstall('state-one', NOW + 60_000)).toBeNull();
  });

  it('matches nothing for another state, for no state and for no stored entry', () => {
    expect(matchInstall('state-one', NOW)).toBeNull();
    startInstall('armadx', 'state-one', NOW);
    expect(matchInstall('state-two', NOW)).toBeNull();
    expect(matchInstall(undefined, NOW)).toBeNull();
    expect(matchInstall('', NOW)).toBeNull();
  });

  it('matches nothing after an hour, and nothing for an entry from the future', () => {
    startInstall('armadx', 'state-one', NOW);
    expect(matchInstall('state-one', NOW + INSTALL_STATE_MAX_AGE_MS)).toBe('armadx');
    expect(matchInstall('state-one', NOW + INSTALL_STATE_MAX_AGE_MS + 1)).toBeNull();
    expect(matchInstall('state-one', NOW - 1)).toBeNull();
  });

  it('keeps the entry in the session storage of the tab, under one key, and nowhere else', () => {
    startInstall('armadx', 'state-one', NOW);
    expect(JSON.parse(sessionStorage.getItem('github-install') ?? 'null')).toEqual({
      state: 'state-one',
      company: 'armadx',
      at: NOW,
    });
    expect(sessionStorage).toHaveLength(1);
    expect(localStorage).toHaveLength(0);
  });

  it('reads nothing out of a stored value of another shape', () => {
    sessionStorage.setItem('github-install', 'not json');
    expect(matchInstall('state-one', NOW)).toBeNull();
    // A company that is no short code is not turned into an address of the panel.
    sessionStorage.setItem(
      'github-install',
      JSON.stringify({ state: 'state-one', company: '../login', at: NOW }),
    );
    expect(matchInstall('state-one', NOW)).toBeNull();
  });

  it('works without storage: nothing is remembered and nothing throws', () => {
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
    expect(() => {
      startInstall('armadx', 'state-one', NOW);
    }).not.toThrow();
    expect(matchInstall('state-one', NOW)).toBeNull();
    expect(() => {
      forgetInstall();
    }).not.toThrow();
  });
});
