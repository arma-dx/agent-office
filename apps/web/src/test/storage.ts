import { vi } from 'vitest';

/**
 * Makes localStorage refuse every call, as a browser with blocked site data does (a SecurityError).
 * Undo it with vi.restoreAllMocks() after the test.
 */
export function blockStorage(): void {
  const refuse = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(refuse);
}
