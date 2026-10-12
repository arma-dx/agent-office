import { vi } from 'vitest';

/** One upload the panel started, as the fake XMLHttpRequest saw it; the test decides how it ends. */
export interface SentUpload {
  method: string;
  /** Path after /api. */
  path: string;
  headers: Record<string, string>;
  body: unknown;
  aborted: boolean;
  /** Reports that `loaded` of `total` bytes have left the browser. */
  progress(loaded: number, total: number): void;
  /** The API's answer. */
  respond(status: number, body: unknown): void;
  /** The connection broke. */
  fail(): void;
}

/**
 * Replaces XMLHttpRequest, which the panel uses for one thing: sending a file with progress.
 * Nothing answers by itself: a test takes the upload from `uploads` and ends it.
 */
export function mockUpload(): { uploads: SentUpload[] } {
  const uploads: SentUpload[] = [];
  class FakeRequest {
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    #sent: SentUpload | null = null;
    #method = '';
    #path = '';
    readonly #headers: Record<string, string> = {};

    open(method: string, url: string): void {
      if (!url.startsWith('/api/')) throw new Error(`The panel called a URL outside /api: ${url}`);
      this.#method = method;
      this.#path = url.slice('/api'.length);
    }

    setRequestHeader(name: string, value: string): void {
      this.#headers[name.toLowerCase()] = value;
    }

    send(body: unknown): void {
      const sent: SentUpload = {
        method: this.#method,
        path: this.#path,
        headers: this.#headers,
        body,
        aborted: false,
        progress: (loaded, total) => {
          this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
        },
        respond: (status, answer) => {
          this.status = status;
          this.responseText = typeof answer === 'string' ? answer : JSON.stringify(answer);
          this.onload?.();
        },
        fail: () => {
          this.onerror?.();
        },
      };
      this.#sent = sent;
      uploads.push(sent);
    }

    abort(): void {
      if (this.#sent) this.#sent.aborted = true;
      this.onabort?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
  return { uploads };
}
