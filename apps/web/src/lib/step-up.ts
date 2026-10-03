import { stepUpSchema, type StepUp, type StepUpOptionsRequest } from '@agent-office/shared';
import { startAuthentication, type AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from './api.ts';
import {
  ceremonyValue,
  noticeFor,
  settleCeremony,
  STEP_UP_MAX_AGE_MS,
  STEP_UP_REFRESH_MS,
  STEP_UP_TEXT,
  stepUpOptionsQueryOptions,
  type CeremonyResult,
  type Notice,
} from './passkeys.ts';

interface Attempt<V> {
  challengeId: string;
  ceremony: Promise<CeremonyResult<AuthenticationResponseJSON>>;
  variables: V;
}

export interface StepUpController<V> {
  /** Options are here and unused: the confirm button can start the ceremony. */
  ready: boolean;
  /** The ceremony or the protected request is on its way. */
  busy: boolean;
  /** What the dialog shows: preparing, cancelled, failed, no passkey or the API's message. */
  notice: Notice | null;
  /**
   * Starts the ceremony and then sends the protected request with { challengeId, response }.
   * Call it first thing in the click handler: Safari starts a ceremony only inside the click.
   */
  confirm: (variables: V) => void;
}

/**
 * Re-verification with a passkey for one protected action (3 October decision 7). Mount it when the
 * confirmation dialog opens: the options (POST /api/step-up/options) are fetched then, so that the
 * click can start the ceremony without waiting for the network. `request` null fetches nothing.
 *
 * The protected request gets the signed answer as `stepUp`. A challenge the API has seen is used up
 * (or has a failed attempt counted), so after any answer of the API the next try gets new options;
 * a prompt the person cancelled never reached the API, and its challenge is tried again. New
 * options replace the open challenge on the server, so none are fetched on their own (timer, window
 * focus) while a ceremony or its request is on its way.
 */
export function useStepUp<T, V = void>({
  request,
  action,
  onSuccess,
}: {
  request: StepUpOptionsRequest | null;
  action: (stepUp: StepUp, variables: V) => Promise<T>;
  onSuccess?: (result: T, variables: V) => void;
}): StepUpController<V> {
  // A ceremony or the protected request is on its way.
  const [inFlight, setInFlight] = useState(false);
  const options = useQuery({
    ...stepUpOptionsQueryOptions(request),
    refetchInterval: inFlight ? false : STEP_UP_REFRESH_MS,
    refetchOnWindowFocus: !inFlight,
  });
  const [usedChallengeId, setUsedChallengeId] = useState<string | null>(null);
  // The person pressed confirm before the options were ready; they are being fetched.
  const [waiting, setWaiting] = useState(false);

  const attempt = useMutation({
    mutationFn: async ({ challengeId, ceremony, variables }: Attempt<V>) => {
      const response = await ceremonyValue(ceremony);
      return action(stepUpSchema.parse({ challengeId, response }), variables);
    },
    onSuccess: (result, { challengeId, variables }) => {
      setUsedChallengeId(challengeId);
      onSuccess?.(result, variables);
    },
    onError: (error, { challengeId }) => {
      if (error instanceof ApiError) {
        setUsedChallengeId(challengeId);
        void options.refetch();
      }
    },
    onSettled: () => {
      setInFlight(false);
    },
  });

  const data = options.data;
  const ready = data !== undefined && data.challengeId !== usedChallengeId;

  function confirm(variables: V): void {
    if (attempt.isPending || request === null) return;
    if (data === undefined || !ready || Date.now() - options.dataUpdatedAt > STEP_UP_MAX_AGE_MS) {
      setWaiting(true);
      if (!options.isFetching) void options.refetch();
      return;
    }
    setWaiting(false);
    // Nothing is awaited before this call (Safari's user-gesture rule).
    const ceremony = settleCeremony(startAuthentication({ optionsJSON: data.options }));
    setInFlight(true);
    attempt.mutate({ challengeId: data.challengeId, ceremony, variables });
  }

  let notice: Notice | null = null;
  if (attempt.isPending) {
    notice = null;
  } else if (request !== null && options.isFetching && (data === undefined || waiting)) {
    notice = { tone: 'quiet', text: STEP_UP_TEXT.preparing };
  } else if (options.isError) {
    notice = noticeFor(options.error, 'step_up');
  } else if (attempt.isError) {
    notice = noticeFor(attempt.error, 'step_up');
  } else if (waiting && !ready) {
    notice = { tone: 'quiet', text: STEP_UP_TEXT.notReady };
  }

  return { ready, busy: attempt.isPending, notice, confirm };
}
