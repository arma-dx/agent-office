import { BACKGROUND_HEADER } from '@agent-office/shared';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, mockApi, sessionBody, sessionHandler } from '../test/mock-api.ts';
import { ApiError, userMessage } from './api.ts';
import { REFRESH_MS, useBackgroundRefresh } from './refresh.ts';
import { SESSION_QUERY_KEY, type SessionState } from './session.ts';

const KEY = ['company', 'c1', 'things'] as const;

function Things({
  background,
  paused,
}: {
  background: (signal: AbortSignal) => Promise<string[]>;
  paused?: () => boolean;
}) {
  const query = useQuery({ queryKey: KEY, queryFn: () => Promise.resolve(['first']) });
  useBackgroundRefresh({ queryKey: KEY, fetch: background, ...(paused ? { paused } : {}) });
  const save = useMutation({ mutationFn: () => new Promise<void>(() => undefined) });
  return (
    <div>
      {query.isError ? <p role="alert">{userMessage(query.error)}</p> : null}
      <p>{query.data?.join(', ') ?? 'loading'}</p>
      <button
        type="button"
        onClick={() => {
          save.mutate();
        }}
      >
        Kaydet
      </button>
    </div>
  );
}

function setup(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client, ...view };
}

async function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(REFRESH_MS);
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  // Only the refresh timer is faked: the query client and the test library keep real timers.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBackgroundRefresh', () => {
  it('asks again at the interval and shows the answer', async () => {
    const background = vi.fn(() => Promise.resolve(['first', 'second']));
    setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    expect(background).not.toHaveBeenCalled();
    await tick();
    expect(background).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('first, second')).toBeInTheDocument();
    await tick(2);
    expect(background).toHaveBeenCalledTimes(3);
  });

  it('sends nothing while the tab is hidden, while it is paused or while a change is being saved', async () => {
    const background = vi.fn(() => Promise.resolve(['changed']));
    let paused = false;
    setup(<Things background={background} paused={() => paused} />);
    expect(await screen.findByText('first')).toBeInTheDocument();

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await tick(2);
    expect(background).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');

    paused = true;
    await tick();
    expect(background).not.toHaveBeenCalled();
    paused = false;

    act(() => {
      screen.getByRole('button', { name: 'Kaydet' }).click();
    });
    await tick();
    expect(background).not.toHaveBeenCalled();
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('drops an answer that arrives after the person paused or changed the data', async () => {
    let answer: (rows: string[]) => void = () => undefined;
    const background = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          answer = resolve;
        }),
    );
    let paused = false;
    const { client } = setup(<Things background={background} paused={() => paused} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick();
    expect(background).toHaveBeenCalledTimes(1);
    // A menu opened while the request was on its way: the rows must not move under it.
    paused = true;
    await act(async () => {
      answer(['late']);
      await Promise.resolve();
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    paused = false;

    await tick();
    // The person's own change reaches the cache first; the older answer is dropped.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      client.setQueryData(KEY, ['mine']);
      answer(['late again']);
      await Promise.resolve();
    });
    expect(await screen.findByText('mine')).toBeInTheDocument();
    expect(screen.queryByText('late again')).toBeNull();
  });

  it('stops when the page is left', async () => {
    const background = vi.fn(() => Promise.resolve(['x']));
    const { unmount } = setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    unmount();
    await tick(3);
    expect(background).not.toHaveBeenCalled();
  });

  it('a failure that says nothing about access shows nothing and asks for nothing', async () => {
    const api = mockApi({ 'GET /session': sessionHandler() });
    const background = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new ApiError(503, 'down'))
      .mockRejectedValueOnce(new ApiError(0, 'Could not reach the server'))
      .mockRejectedValueOnce(new ApiError(429, 'Çok sık istek.', 'rate_limited'));
    setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick(3);
    expect(background).toHaveBeenCalledTimes(3);
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it('a closed session reads the session again, as a background request', async () => {
    const api = mockApi({
      'GET /session': () => apiError(401, 'unauthenticated', 'Oturumunuz kapalı.'),
    });
    const background = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValue(new ApiError(401, 'Oturumunuz kapalı.', 'unauthenticated'));
    const { client } = setup(<Things background={background} />);
    const signedIn: SessionState = { status: 'signed_in', session: sessionBody() };
    client.setQueryData(SESSION_QUERY_KEY, signedIn);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick();
    await waitFor(() => {
      expect(client.getQueryData(SESSION_QUERY_KEY)).toEqual({
        status: 'signed_out',
        expired: true,
      });
    });
    // The panel sent it by itself: it must not count as activity of the person.
    const [check] = api.callsTo('GET /session');
    expect(check?.headers.get(BACKGROUND_HEADER)).toBe('1');
    // The rows are not the refresh's to judge: the layout opens the login screen.
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('a record that is gone or closed to the person leaves the screen', async () => {
    const api = mockApi({ 'GET /session': sessionHandler() });
    const background = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValue(new ApiError(404, 'Kayıt bulunamadı.', 'not_found'));
    const { client } = setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick();
    expect(await screen.findByRole('alert')).toHaveTextContent('Kayıt bulunamadı.');
    expect(screen.queryByText('first')).toBeNull();
    expect(client.getQueryData(KEY)).toBeUndefined();
    // Nothing to read again for a missing record, and nothing more is asked for on the timer.
    expect(api.calls).toEqual([]);
    await tick(2);
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('a refusal for the company drops the rows and reads the session again in the background', async () => {
    const api = mockApi({ 'GET /session': sessionHandler({ memberships: [] }) });
    const background = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValue(new ApiError(403, 'Bu şirkete erişiminiz yok.', 'forbidden'));
    const { client } = setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick();
    expect(await screen.findByRole('alert')).toHaveTextContent('Bu şirkete erişiminiz yok.');
    expect(screen.queryByText('first')).toBeNull();
    await waitFor(() => {
      expect(client.getQueryData<SessionState>(SESSION_QUERY_KEY)).toMatchObject({
        status: 'signed_in',
        session: { memberships: [] },
      });
    });
    expect(api.callsTo('GET /session')).toHaveLength(1);
    expect(api.callsTo('GET /session')[0]?.headers.get(BACKGROUND_HEADER)).toBe('1');
  });

  it('a late refusal does not replace what the person fetched or changed meanwhile', async () => {
    mockApi({ 'GET /session': sessionHandler() });
    let refuse: (error: unknown) => void = () => undefined;
    const background = vi.fn(
      () =>
        new Promise<string[]>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const { client } = setup(<Things background={background} />);
    expect(await screen.findByText('first')).toBeInTheDocument();
    await tick();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      client.setQueryData(KEY, ['mine']);
      refuse(new ApiError(404, 'Kayıt bulunamadı.', 'not_found'));
      await Promise.resolve();
    });
    expect(await screen.findByText('mine')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
