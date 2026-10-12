import { REQUEST_ANSWER_MAX, type RequestCause, type RequestDetail } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { InlineBanner } from '@/components/inline-banner';
import { AgentText } from '@/components/requests/request-view';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, isUnauthorized, userMessage } from '@/lib/api';
import { formatFull, formatMessageTime } from '@/lib/dates';
import { draftKey, readDraft, saveDraft, saveDraftSoon } from '@/lib/drafts';
import {
  ANSWER_EMPTY,
  ANSWER_FAILED,
  ANSWER_LABEL,
  ANSWER_LIMIT,
  ANSWER_NOT_YOURS,
  ANSWER_SEND,
  ANSWER_TOO_LONG,
  DRAFT_DISCARD,
  DRAFT_DISCARDED,
  QUESTION_ARRIVED,
  QUESTION_GONE,
  QUESTION_HEADING,
  QUESTION_WAITS_FOR_OTHERS,
  answerHelp,
  answerSentAs,
  questionAskedBy,
  questionForReader,
  questionInPlace,
  questionLabel,
} from '@/lib/requests/labels';
import { answerQuestion, requestKey } from '@/lib/requests/query';
import { useSettle } from '@/lib/requests/settle';
import { useCompany, useSession } from '@/lib/session';
import { busyProps, SEND_KEY } from '@/lib/utils';

// What the box holds: the text, and the question it was typed for. The question is kept with the
// text, in the draft too: a request can carry several questions one after the other (the
// coordinator's, then the unit agent's), and a text typed for one never opens under another.
const draftSchema = z.object({ questionId: z.uuid(), text: z.string() });
type Held = z.infer<typeof draftSchema>;

/**
 * An agent's question to the requester (7 October decision 7; 12 October decisions 3 and 4).
 * The API gives the open question only to the requester, the approver of the request and the
 * founder; `mayAnswer` says whether the reader is the one who answers. Nothing is shown as sent
 * before the API has stored it. What is being typed is this component's own state and a draft
 * of the tab (lib/drafts.ts, docs/SONRA.md W-m): a refresh of the page never touches the box,
 * also when it brings the news that the question was closed.
 *
 * What it draws, the first that applies:
 * 1. the question waits for the reader's answer: the card with the box;
 * 2. the reader reads the question and does not answer it: the card without a box (and, when the
 *    reader still holds a text typed for this question, that text read-only under it);
 * 3. this component sent the answer: the notice that it was stored;
 * 4. no question any more and a text is still held: the text read-only with "Taslağı at", and
 *    after that button one sentence;
 * 5. the request waits for an answer and the reader may not read the question: a banner;
 * 6. nothing.
 *
 * The box is one element through 1, 2 and 4: a person who is typing when a refresh brings the
 * news keeps the focus and the caret. The page mounts the component with the request's id as its
 * key: a text typed for one request never opens in the box of another.
 */
export function RequestQuestion({ request }: { request: RequestDetail }) {
  const company = useCompany();
  const session = useSession();
  const queryClient = useQueryClient();
  const settle = useSettle();
  const id = useId();
  const key = draftKey(session.user.id, company.companyId, `answer.${request.id}`);
  const question = request.question;
  const questionId = question?.id ?? null;

  const [held, setHeld] = useState<Held | null>(() => readDraft(key, draftSchema));
  const [touched, setTouched] = useState(false);
  // Kept per question, not per mount: one open page can carry three questions in a row, and the
  // notice of the first must neither stand under the next nor keep the next from being said.
  const [sentFor, setSentFor] = useState<string | null>(null);
  // The hold the API answered the answer with (the cause of a request that had fallen to a person
  // in that very answer): only of that hold does the notice say that the work did not start.
  const [heldCause, setHeldCause] = useState<RequestCause | null>(null);
  const [discardedFor, setDiscardedFor] = useState<string | null>(null);
  // Said once to a screen reader when a question arrives after the page was first read.
  const [seenId, setSeenId] = useState(questionId);
  const [arrived, setArrived] = useState<string | null>(null);
  if (questionId !== seenId) {
    setSeenId(questionId);
    // Nothing while no question is open, so that the next one is said anew.
    setArrived(questionId);
    if (questionId !== null) {
      setTouched(false);
      if (sentFor !== questionId) setSentFor(null);
      if (discardedFor !== questionId) setDiscardedFor(null);
    }
  }
  // A text typed for an earlier question: that question is settled and the text is stale.
  if (questionId !== null && held !== null && held.questionId !== questionId) setHeld(null);
  useEffect(() => {
    if (questionId === null) return;
    const kept = readDraft(key, draftSchema);
    if (kept && kept.questionId !== questionId) saveDraft(key, null);
  }, [questionId, key]);

  const send = useMutation({
    mutationFn: (sent: Held) =>
      answerQuestion(company.companyId, request.id, sent.questionId, { answer: sent.text }),
    // Also runs when the person has left the page meanwhile: the draft must go then too.
    onSuccess: (detail, sent) => {
      if (readDraft(key, draftSchema)?.questionId === sent.questionId) saveDraft(key, null);
      setHeld((now) => (now?.questionId === sent.questionId ? null : now));
      setTouched(false);
      setSentFor(sent.questionId);
      setHeldCause(detail.stage === 'fell_to_person' ? detail.cause : null);
      // The page, the lists, the desk, the Bugün list and the two numbers of the sidebar: the
      // Bugün row and its count go away with the answer.
      settle(detail);
    },
    onError: (error) => {
      // The page on screen is older than the API's: the question was answered or closed, the
      // reader is no longer the one who answers, or the request went away. It is read again; the
      // text stays held, so the card says what happened when the page no longer offers the box.
      if (
        error instanceof ApiError &&
        (error.code === 'question_closed' ||
          error.code === 'answer_not_allowed' ||
          error.status === 404)
      ) {
        void queryClient.invalidateQueries({
          queryKey: requestKey(company.companyId, request.id),
          exact: true,
        });
      }
    },
  });

  const text = held?.text ?? '';
  const empty = text.trim() === '';
  const tooLong = text.trim().length > REQUEST_ANSWER_MAX;
  const busy = send.isPending;
  // The answer of this question was stored by this component. Said also while the page on screen
  // still carries the question (a refresh that was on its way when the answer was stored can
  // bring the older page once more): what was sent is never offered to be sent again.
  const showSent = sentFor !== null && (question === null || question.id === sentFor);
  const reading = question !== null && !showSent;
  const editable = reading && question.mayAnswer;
  // A text that can no longer be sent: the question went away, or the reader is no longer the one
  // who answers. It is not taken from the person: it can be copied or discarded.
  const kept = !editable && !empty && !showSent;
  const showBox = editable || kept;
  const discarded = discardedFor !== null && !showBox && !showSent;
  const problem = tooLong ? ANSWER_TOO_LONG : touched && empty ? ANSWER_EMPTY : null;
  // A closed session is not said here: the panel opens the login screen, which says it, and the
  // draft brings the text back afterwards. Nor the failure of an earlier question's answer.
  const failure =
    send.isError && send.variables.questionId === questionId && !isUnauthorized(send.error)
      ? userMessage(send.error)
      : null;

  const form = useRef<HTMLFormElement>(null);
  const sentNotice = useRef<HTMLDivElement>(null);
  const keptSentence = useRef<HTMLParagraphElement>(null);
  const discardedSentence = useRef<HTMLParagraphElement>(null);
  // Whether the keyboard was last inside the form. A control that is removed while it has the
  // focus (the send button, when the question goes away) tells nobody; this is how it is known.
  const focusInForm = useRef(false);
  // The button the person pressed is gone with the card: the focus goes to the notice that takes
  // its place, once per answered question, not to the top of the page.
  const sentShown = showSent ? sentFor : null;
  useEffect(() => {
    if (sentShown !== null) sentNotice.current?.focus();
  }, [sentShown]);
  // The same for "Taslağı at", which removes the box and itself.
  const discardedShown = discarded ? discardedFor : null;
  useEffect(() => {
    if (discardedShown !== null) discardedSentence.current?.focus();
  }, [discardedShown]);
  // The question went away under the keyboard. The box stays where it is, with the focus and the
  // caret if it had them. The send button goes: a focus that was on it moves to the sentence that
  // says what happened. The page is not scrolled: the person may be reading further down.
  useEffect(() => {
    if (!kept || !focusInForm.current) return;
    if (document.activeElement === null || document.activeElement === document.body) {
      keptSentence.current?.focus({ preventScroll: true });
    }
  }, [kept]);

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (!editable) return;
    setTouched(true);
    if (busy || empty || tooLong) return;
    send.mutate({ questionId: question.id, text });
  }

  const [waits, canDo] = questionForReader(
    request.requester,
    request.actions,
    request.requesterReads,
  );
  const inPlace = editable && question.inPlaceOfRequester;
  // No agent can work in the request's project now: the box does not promise that one goes on.
  const workHeld = !request.agentsMayWork || request.spendingLimitReached;

  return (
    <>
      {/* Always on the page, so that a screen reader hears what is put into it. The question's id
          is the key: a second question that replaces the first is said again. */}
      <p role="status" className="sr-only">
        {arrived !== null && arrived === questionId && !showSent ? (
          <span key={arrived}>{QUESTION_ARRIVED}</span>
        ) : null}
      </p>
      {reading || kept ? (
        <section
          aria-labelledby={`${id}-heading`}
          className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
        >
          <h3 id={`${id}-heading`} className="text-[0.9375rem] font-semibold">
            {QUESTION_HEADING}
          </h3>
          {reading ? (
            <p className="text-sm text-ink-secondary">
              {questionAskedBy(question.agent)},{' '}
              <time dateTime={question.askedAt} title={formatFull(question.askedAt)}>
                {formatMessageTime(question.askedAt)}
              </time>
              .
            </p>
          ) : null}
          {/* A model's text nobody approved: plain text under a label that says so. */}
          {reading ? (
            <AgentText label={questionLabel(question.agent)}>{question.text}</AgentText>
          ) : null}
          {reading && !question.mayAnswer ? (
            <div className="flex flex-col gap-1 text-sm">
              <p>{waits}</p>
              {canDo === null ? null : <p className="text-ink-secondary">{canDo}</p>}
            </div>
          ) : null}
          {inPlace ? (
            <p id={`${id}-in-place`} className="text-sm">
              {questionInPlace(request.requester)}
            </p>
          ) : null}
          {showBox ? (
            // One form and one box for the person who answers and for the one who no longer can:
            // the box a person is typing in is never replaced by another element.
            <form
              ref={form}
              className={kept ? 'flex flex-col gap-2' : 'flex flex-col gap-1.5'}
              noValidate
              onSubmit={submit}
              onFocus={() => {
                focusInForm.current = true;
              }}
              onBlur={(event) => {
                // Only a focus that went to another control is one that left; a control that was
                // removed has no next one.
                if (
                  event.relatedTarget instanceof Node &&
                  !event.currentTarget.contains(event.relatedTarget)
                ) {
                  focusInForm.current = false;
                }
              }}
            >
              {kept ? (
                <p
                  id={`${id}-kept`}
                  ref={keptSentence}
                  role="status"
                  tabIndex={-1}
                  className="text-sm"
                >
                  {question === null ? QUESTION_GONE : ANSWER_NOT_YOURS}
                </p>
              ) : null}
              <label htmlFor={`${id}-text`} className={kept ? 'sr-only' : 'text-sm font-medium'}>
                {ANSWER_LABEL}
              </label>
              <Textarea
                id={`${id}-text`}
                rows={4}
                className="max-h-72"
                value={text}
                // No maxLength: a pasted text is never cut silently. Not disabled while the
                // answer is being sent: the box keeps the focus.
                readOnly={busy || kept}
                aria-invalid={!kept && problem !== null}
                aria-describedby={
                  kept
                    ? `${id}-kept`
                    : `${inPlace ? `${id}-in-place ` : ''}${id}-help ${id}-keys${
                        problem ? ` ${id}-error` : ''
                      }`
                }
                onChange={(event) => {
                  if (!editable) return;
                  const next = { questionId: question.id, text: event.target.value };
                  setHeld(next);
                  // The reason the last try failed no longer applies to a changed text.
                  if (send.isError) send.reset();
                  if (discardedFor !== null) setDiscardedFor(null);
                  saveDraftSoon(key, next.text.trim() === '' ? null : next);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
                }}
              />
              {kept ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    saveDraft(key, null);
                    setDiscardedFor(held?.questionId ?? null);
                    setHeld(null);
                  }}
                >
                  {DRAFT_DISCARD}
                </Button>
              ) : (
                <>
                  {problem ? (
                    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                      {problem}
                    </p>
                  ) : null}
                  <p id={`${id}-help`} className="text-sm text-ink-secondary">
                    {answerHelp(workHeld).join(' ')}
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <p id={`${id}-keys`} className="shrink-0 text-xs text-ink-secondary">
                      {ANSWER_LIMIT} {SEND_KEY}+Enter ile de gönderilir.
                    </p>
                    {failure === null ? (
                      <span className="flex-1" />
                    ) : (
                      <p
                        role="alert"
                        className="min-w-0 flex-1 text-right text-sm text-destructive"
                      >
                        {ANSWER_FAILED} {failure}
                      </p>
                    )}
                    <Button type="submit" {...busyProps(busy)}>
                      {busy ? 'Gönderiliyor' : ANSWER_SEND}
                    </Button>
                  </div>
                </>
              )}
            </form>
          ) : null}
          {discarded ? (
            <p
              ref={discardedSentence}
              role="status"
              tabIndex={-1}
              className="text-sm text-ink-secondary"
            >
              {DRAFT_DISCARDED}
            </p>
          ) : null}
        </section>
      ) : showSent ? (
        <div ref={sentNotice} tabIndex={-1}>
          <InlineBanner tone="info" compact role="status">
            {answerSentAs(request, heldCause)}
          </InlineBanner>
        </div>
      ) : discarded ? (
        <p
          ref={discardedSentence}
          role="status"
          tabIndex={-1}
          className="text-sm text-ink-secondary"
        >
          {DRAFT_DISCARDED}
        </p>
      ) : request.stage === 'awaiting_reply' ? (
        // Every other reader of the request: that it waits, never the question.
        <InlineBanner tone="info" compact>
          {QUESTION_WAITS_FOR_OTHERS}
        </InlineBanner>
      ) : null}
    </>
  );
}
