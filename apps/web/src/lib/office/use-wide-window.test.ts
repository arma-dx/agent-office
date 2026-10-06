import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { stubMatchMedia } from '@/test/match-media';
import { useWideWindow, WIDE_WINDOW_QUERY } from './use-wide-window.ts';

describe('useWideWindow', () => {
  it('asks for a window of 1280 px or wider, the width the panel is designed for', () => {
    expect(WIDE_WINDOW_QUERY).toBe('(min-width: 1280px)');
  });

  it('is true in a wide window and false in a narrower one', () => {
    stubMatchMedia([WIDE_WINDOW_QUERY]);
    expect(renderHook(() => useWideWindow()).result.current).toBe(true);
    stubMatchMedia();
    expect(renderHook(() => useWideWindow()).result.current).toBe(false);
  });

  it('follows the window while it is resized, and stops listening when it is not used any more', () => {
    const media = stubMatchMedia();
    const { result, unmount } = renderHook(() => useWideWindow());
    expect(result.current).toBe(false);
    act(() => {
      media.set(WIDE_WINDOW_QUERY, true);
    });
    expect(result.current).toBe(true);
    act(() => {
      media.set(WIDE_WINDOW_QUERY, false);
    });
    expect(result.current).toBe(false);

    expect(media.listenerCount(WIDE_WINDOW_QUERY)).toBe(1);
    unmount();
    expect(media.listenerCount(WIDE_WINDOW_QUERY)).toBe(0);
  });
});
