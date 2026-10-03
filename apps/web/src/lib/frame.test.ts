import { describe, expect, it } from 'vitest';
import { isFramed } from './frame.ts';

describe('isFramed', () => {
  it('is false for the panel in its own window', () => {
    expect(isFramed(window)).toBe(false);
  });

  it('is true inside a frame of another page', () => {
    const top = {} as Window;
    expect(isFramed({ self: window, top })).toBe(true);
    // A frame whose top cannot be read (null) counts as framed too.
    expect(isFramed({ self: window, top: null })).toBe(true);
  });
});
