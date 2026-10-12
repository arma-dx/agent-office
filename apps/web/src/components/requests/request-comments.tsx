import { REQUEST_COMMENT_MAX, type RequestDetail } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, isUnauthorized, userMessage } from '@/lib/api';
import { formatFull, formatMessageTime } from '@/lib/dates';
import { draftKey, readDraft, saveDraft, saveDraftSoon } from '@/lib/drafts';
import { ANSWER_IN_CARD_ABOVE, personName } from '@/lib/requests/labels';
import { addRequestComment, requestKey } from '@/lib/requests/query';
import { useCompany, useSession } from '@/lib/session';
import { busyProps, SEND_KEY } from '@/lib/utils';

/**
 * "Yorumlar": what people wrote to each other about a request (8 October decision 13). The
 * requester, the approver of the request and the founder write; everybody who reads the request
 * reads; no agent does, and the section says so next to the box. A comment changes nothing of
 * the request, so nothing here is a control of the request and nothing is shown as sent before
 * the API has stored it.
 *
 * The section stands under the journey and is not part of it: the journey is the record of what
 * the flow did, and a comment between two of its rows would read as something a run answered to.
 *
 * The list comes with the page's one answer and is refreshed with it. What is being typed is
 * this component's own state and a draft of the tab (lib/drafts.ts): a refresh adds comments
 * above the box and never touches the box, its text, its caret or the focus, also when it brings
 * the news that the person may no longer write. The page mounts the section with the request's
 * id as its key: a text typed for one request never opens in the box of another.
 */

// What the box holds: the text, and the id the text will be stored under. The id is kept with
// the text, in the draft too: a box that is mounted anew while a send is still on its way (the
// person left the page and came back, or loaded it again) holds the same text under the same id,
// so another press stores nothing twice (the API stores a comment once per id), and the box knows
// that its text was stored when a comment with that id is in the list. A comment can never be
// removed (docs/SONRA.md D-d): one stored twice would stay for everybody who reads the request.
const draftSchema = z.object({ id: z.uuid(), text: z.string() });
type Held = z.infer<typeof draftSchema>;
const nothingHeld = (): Held => ({ id: crypto.randomUUID(), text: '' });

export function RequestComments({ request }: { request: RequestDetail }) {
  const session = useSession();
  const headingId = useId();
  const { items, truncated, mayWrite } = request.comments;

  // Said once to a screen reader when a comment arrives after the page was first read: the
  // reader's own when it is stored, somebody else's when a refresh brings it.
  const last = items.at(-1);
  const lastId = last?.id ?? null;
  const [seenId, setSeenId] = useState(lastId);
  const [news, setNews] = useState('');
  if (lastId !== seenId) {
    setSeenId(lastId);
    if (last) {
      setNews(
        last.author.userId === session.user.id
          ? 'Yorumunuz eklendi.'
          : `${personName(last.author)} yeni bir yorum yazdı.`,
      );
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-[0.9375rem] font-semibold">
        Yorumlar
        {items.length > 0 && !truncated ? (
          <>
            {' '}
            <span className="font-normal text-ink-secondary tabular-nums">{items.length}</span>
          </>
        ) : null}
      </h3>
      {truncated ? (
        <p className="text-sm text-ink-secondary">
          En yeni 200 yorum gösteriliyor; daha eski yorumlar bu sayfada görünmez.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-ink-secondary">Henüz yorum yok.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {items.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-1 py-2 text-sm">
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{personName(comment.author)}</span>
                <time
                  dateTime={comment.createdAt}
                  title={formatFull(comment.createdAt)}
                  className="shrink-0 text-xs text-ink-secondary tabular-nums"
                >
                  {formatMessageTime(comment.createdAt)}
                </time>
              </p>
              {/* Plain text: line breaks kept, no markup, no link, no image. */}
              <p dir="auto" className="break-words whitespace-pre-wrap">
                {comment.body}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p role="status" className="sr-only">
        {news}
      </p>
      <CommentBox
        requestId={request.id}
        mayWrite={mayWrite}
        items={items}
        answerInCard={request.question?.mayAnswer === true}
      />
    </section>
  );
}

function CommentBox({
  requestId,
  mayWrite,
  items,
  answerInCard,
}: {
  requestId: string;
  mayWrite: boolean;
  items: RequestDetail['comments']['items'];
  /**
   * An agent's question waits for this reader's answer. This box is the text box a person finds
   * at the end of the page, and no agent reads a comment: one sentence directly above it says
   * where the answer is written (the question card at the top of the page).
   */
  answerInCard: boolean;
}) {
  const company = useCompany();
  const session = useSession();
  const queryClient = useQueryClient();
  const id = useId();
  const key = draftKey(session.user.id, company.companyId, `comment.${requestId}`);
  // Another try of the same text carries the same id, so the API stores the comment once even
  // when the first answer was lost. A changed text is a new comment, under a new id.
  const [held, setHeld] = useState(() => readDraft(key, draftSchema) ?? nothingHeld());
  const [touched, setTouched] = useState(false);
  // The comment the box holds is in the list: it was stored. This box may not have been told
  // (the send was made by an earlier mount of it, or its answer was lost and a refresh or a
  // reload brought the comment), so the list is what says it. The box starts anew and the draft
  // goes.
  if (items.some((item) => item.id === held.id)) {
    setHeld(nothingHeld());
    setTouched(false);
  }
  useEffect(() => {
    const kept = readDraft(key, draftSchema);
    if (kept && items.some((item) => item.id === kept.id)) saveDraft(key, null);
  }, [items, key]);
  const text = held.text;
  // "Taslağı at" removes the box and its own button: the focus goes to the sentence that takes
  // their place, not to the top of the page.
  const [discards, setDiscards] = useState(0);
  const whoMayWrite = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (discards > 0) whoMayWrite.current?.focus();
  }, [discards]);

  const send = useMutation({
    mutationFn: (comment: { id: string; body: string }) =>
      addRequestComment(company.companyId, requestId, comment),
    // Also runs when the person has left the page meanwhile: the draft must go then too.
    onSuccess: (detail, sent) => {
      // Only what was sent: a text typed since, in a box mounted after this one, is not this one.
      if (readDraft(key, draftSchema)?.id === sent.id) saveDraft(key, null);
      setHeld((now) => (now.id === sent.id ? nothingHeld() : now));
      setTouched(false);
      // Only the page of this request: a comment changes no list, no desk and no count.
      queryClient.setQueryData(requestKey(company.companyId, requestId), detail);
    },
    onError: (error) => {
      // The page on screen is older than the API's: the right to comment or the request itself
      // went away meanwhile. It is read again; the text stays in the box (see below). The send
      // button goes with the right: a focus that is on it moves to the box first, so that it
      // does not fall to the top of the page.
      if (
        error instanceof ApiError &&
        (error.code === 'comment_not_allowed' || error.status === 404)
      ) {
        if (form.current?.contains(document.activeElement)) box.current?.focus();
        void queryClient.invalidateQueries({
          queryKey: requestKey(company.companyId, requestId),
          exact: true,
        });
      }
    },
  });

  const busy = send.isPending;
  const empty = text.trim() === '';
  const tooLong = text.trim().length > REQUEST_COMMENT_MAX;
  const problem = tooLong
    ? 'Yorum en çok 10.000 karakter olabilir.'
    : touched && empty
      ? 'Yorum yazın.'
      : null;
  // A closed session is not said here: the panel opens the login screen, which says it, and the
  // draft brings the text back afterwards.
  // Nor a failure whose comment is in the list after all (the answer was lost, not the comment).
  const arrived = send.isError && items.some((item) => item.id === send.variables.id);
  const failure =
    send.isError && !arrived && !isUnauthorized(send.error) ? userMessage(send.error) : null;
  // The right went away while a text was in the box (the routing was corrected to another unit):
  // the text is not taken from the person. It can be copied or discarded, not sent or changed.
  const gone = !mayWrite && !empty;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    if (gone) return;
    setTouched(true);
    if (busy || empty || tooLong || !mayWrite) return;
    send.mutate({ id: held.id, body: text });
  }

  if (!mayWrite && empty) {
    return (
      <p ref={whoMayWrite} tabIndex={-1} className="text-sm text-ink-secondary">
        Bu talebe yalnızca talep sahibi, birimin onaylayıcısı ve kurucu yorum yazabilir.
      </p>
    );
  }

  // One form and one box for the person who may write and for the one who no longer may: the box
  // a person is typing in is never replaced by another element, so the focus and the caret stay
  // in it when a refresh brings the news.
  return (
    <form
      ref={form}
      className={gone ? 'flex flex-col gap-2' : 'flex flex-col gap-1.5'}
      noValidate
      onSubmit={submit}
    >
      {answerInCard ? (
        <p id={`${id}-answer`} className="text-sm text-ink-secondary">
          {ANSWER_IN_CARD_ABOVE}
        </p>
      ) : null}
      <label htmlFor={`${id}-text`} className={gone ? 'sr-only' : 'text-sm font-medium'}>
        Yorum yaz
      </label>
      {gone ? (
        <p id={`${id}-gone`} role="status" className="text-sm">
          Bu talebe artık yorum yazamazsınız. Yazdığınız metin aşağıda duruyor; gerekiyorsa
          kopyalayın.
        </p>
      ) : null}
      <Textarea
        id={`${id}-text`}
        ref={box}
        rows={3}
        className="max-h-60"
        value={text}
        // Not disabled while the comment is being sent: the box keeps the focus.
        readOnly={busy || gone}
        aria-invalid={!gone && problem !== null}
        aria-describedby={`${answerInCard ? `${id}-answer ` : ''}${
          gone ? `${id}-gone` : `${id}-help ${id}-keys${problem ? ` ${id}-error` : ''}`
        }`}
        onChange={(event) => {
          if (gone) return;
          // A new text is a new comment, and the reason the last one failed no longer applies.
          const next = { id: crypto.randomUUID(), text: event.target.value };
          setHeld(next);
          if (send.isError) send.reset();
          saveDraftSoon(key, next.text.trim() === '' ? null : next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
        }}
      />
      {gone ? (
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            saveDraft(key, null);
            setHeld(nothingHeld());
            setDiscards((count) => count + 1);
          }}
        >
          Taslağı at
        </Button>
      ) : (
        <>
          {problem ? (
            <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          ) : null}
          <p id={`${id}-help`} className="text-sm text-ink-secondary">
            Yorumları yalnızca insanlar okur: talebi görebilen herkes. Ajanlar yorumları görmez;
            yorum talebi ve işin gidişini değiştirmez.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <p id={`${id}-keys`} className="shrink-0 text-xs text-ink-secondary">
              {SEND_KEY}+Enter ile de gönderilir.
            </p>
            {failure === null ? (
              <span className="flex-1" />
            ) : (
              <p role="alert" className="min-w-0 flex-1 text-right text-sm text-destructive">
                Yorum gönderilemedi. {failure}
              </p>
            )}
            <Button type="submit" {...busyProps(busy)}>
              {busy ? 'Gönderiliyor' : 'Yorumu gönder'}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
