import { GITHUB_ADDRESS_PREFIX } from '@agent-office/shared';
import { z } from 'zod';
import { readStored, writeStored } from '../stored.ts';

/**
 * The way to GitHub's install page and back (12 October 2026, decision 13: the founder installs
 * the app of each company on its own organisation).
 *
 * The install link carries a random `state`. When the founder presses the link, the panel keeps
 * the state with the company the founder left from in the tab's session storage; after the
 * installation GitHub sends the browser to /github/setup with the same state, and the page there
 * opens Ayarlar > Bağlantılar of that company. The two apps share one Setup URL: the stored
 * company is what tells the two returns apart.
 *
 * The state authorises nothing. GitHub warns that anybody can open a Setup URL with any
 * `installation_id`, so the return changes nothing and sends nothing to the API: the connection
 * is written only by the founder's next press, with a passkey, from what the API itself reads at
 * GitHub. The state only chooses which page of the panel opens, and a missing or wrong one opens
 * the page of the company the session has.
 */

const STORAGE_KEY = 'github-install';
/** A return that comes later than this is not matched to the press that started it. */
export const INSTALL_STATE_MAX_AGE_MS = 60 * 60 * 1000;

const storedInstallSchema = z.object({
  state: z.string().min(1).max(200),
  // The short code of a company (companies.code), as it stands in the panel's addresses.
  company: z.string().regex(/^[a-z][a-z0-9_]*$/),
  at: z.number(),
});

/** 32 random bytes, written as base64url. */
export function newInstallState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/**
 * The address of GitHub's install page with the state added. The API built the address; anything
 * that is not on github.com gives null, and the page then shows no link.
 */
export function installHref(installUrl: string, state: string): string | null {
  if (!installUrl.startsWith(GITHUB_ADDRESS_PREFIX)) return null;
  let url: URL;
  try {
    url = new URL(installUrl);
  } catch {
    return null;
  }
  url.searchParams.set('state', state);
  const href = url.toString();
  return href.startsWith(GITHUB_ADDRESS_PREFIX) ? href : null;
}

/**
 * Called when the founder presses the install link: remembers which company the installation was
 * started from. The link opens in the same tab, because session storage belongs to the tab.
 */
export function startInstall(companyCode: string, state: string, now: number = Date.now()): void {
  writeStored('session', STORAGE_KEY, { state, company: companyCode, at: now });
}

/**
 * The company the return belongs to: the stored one when the state of the address is the stored
 * state and the press was less than an hour ago; otherwise null. Reads only; forgetInstall
 * removes the entry.
 */
export function matchInstall(state: string | undefined, now: number = Date.now()): string | null {
  const stored = readStored('session', STORAGE_KEY, storedInstallSchema.nullable(), null);
  if (stored === null || state === undefined || state !== stored.state) return null;
  const age = now - stored.at;
  if (age < 0 || age > INSTALL_STATE_MAX_AGE_MS) return null;
  return stored.company;
}

/** A stored state is good for one return. */
export function forgetInstall(): void {
  writeStored('session', STORAGE_KEY, null);
}
