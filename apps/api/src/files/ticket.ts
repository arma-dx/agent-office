import { createHmac, timingSafeEqual } from 'node:crypto';
import { UPLOAD_TICKET_SECONDS } from '@agent-office/shared';

/**
 * Upload tickets. A file's bytes are buffered before the session can be checked (the check needs
 * the request's one transaction, and no transaction waits for an upload), so the upload itself
 * must show, without the database, that a signed-in person was let through a moment ago. The
 * ticket is that proof: POST .../files/:fileId/ticket is an ordinary request (session, company,
 * project and storage are checked in its transaction) and answers with a signature over what the
 * upload will be. The upload guard verifies the signature before a byte of the body is read.
 *
 * A ticket names: the session (the hash of its key), the company, the project, the file id, the
 * declared size and the second it ends. It is no secret beyond that session (it is useless with
 * another cookie) and it grants nothing: the upload is checked again in its own transaction.
 */

const LABEL = 'agent-office/upload-ticket/v1';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TICKET = /^(\d{10})\.([A-Za-z0-9_-]{43})$/;

export interface UploadClaim {
  /** SHA-256 of the session key (the value the database knows the session by). */
  sessionKeyHash: Buffer;
  companyId: string;
  projectId: string;
  fileId: string;
  sizeBytes: number;
}

export class UploadTickets {
  readonly #key: Buffer;
  readonly #now: () => number;

  /** `secret` is the server's own secret (COOKIE_SECRET); the ticket key is derived from it. */
  constructor(secret: string, now: () => number = Date.now) {
    this.#key = createHmac('sha256', secret).update(LABEL).digest();
    this.#now = now;
  }

  #mac(claim: UploadClaim, expires: number): Buffer | null {
    const ids = [claim.companyId, claim.projectId, claim.fileId].map((id) => id.toLowerCase());
    if (!ids.every((id) => ID.test(id)) || !Number.isSafeInteger(claim.sizeBytes)) return null;
    return createHmac('sha256', this.#key)
      .update(
        [
          LABEL,
          claim.sessionKeyHash.toString('hex'),
          ...ids,
          String(claim.sizeBytes),
          String(expires),
        ].join('\n'),
      )
      .digest();
  }

  /** A ticket for exactly this upload; throws for ids that are not ids. */
  issue(claim: UploadClaim): { ticket: string; expiresAt: Date } {
    const expires = Math.floor(this.#now() / 1000) + UPLOAD_TICKET_SECONDS;
    const mac = this.#mac(claim, expires);
    if (!mac) {
      throw new Error('An upload ticket needs three ids and a size');
    }
    return {
      ticket: `${String(expires)}.${mac.toString('base64url')}`,
      expiresAt: new Date(expires * 1000),
    };
  }

  /** Whether the ticket was issued here for exactly this upload and has not ended. */
  verify(ticket: unknown, claim: UploadClaim): boolean {
    if (typeof ticket !== 'string') return false;
    const parts = TICKET.exec(ticket);
    if (!parts) return false;
    const expires = Number(parts[1]);
    const now = Math.floor(this.#now() / 1000);
    // Not ended, and not from a clock that runs ahead of this one.
    if (expires <= now || expires > now + UPLOAD_TICKET_SECONDS) return false;
    const expected = this.#mac(claim, expires);
    const given = Buffer.from(parts[2] ?? '', 'base64url');
    return (
      expected !== null && given.length === expected.length && timingSafeEqual(given, expected)
    );
  }
}
