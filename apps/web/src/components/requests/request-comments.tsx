import { REQUEST_COMMENT_MAX, type RequestDetail } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type SyntheticEvent } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, isUnauthorized, userMessage } from '@/lib/api';
import { formatFull, formatMessageTime } from '@/lib/dates';
import { draftKey, readDraft, saveDraft, saveDraftSoon } from '@/lib/drafts';
import { personName } from '@/lib/requests/labels';
import { addRequestComment, requestKey } from '@/lib/requests/query';
import { useCompany, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

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
 * above the box and never touches the box, its text, its caret or the focus. The page mounts the
 * section with the request's id as its key: a text typed for one request never opens in the box
 * of another.
 */

const draftSchema = z.string();
// What sends: the Command key on a Mac, the Control key elsewhere. The hint names the right one.
const SEND_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

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
      <CommentBox requestId={request.id} mayWrite={mayWrite} />
    </section>
  );
}

function CommentBox({ requestId, mayWrite }: { requestId: string; mayWrite: boolean }) {
  const company = useCompany();
  const session = useSession();
  const queryClient = useQueryClient();
  const id = useId();
  const key = draftKey(session.user.id, company.companyId, `comment.${requestId}`);
  const [text, setText] = useState(() => readDraft(key, draftSchema) ?? '');
  const [touched, setTouched] = useState(false);
  // The id of the comment being sent: another try of the same text carries it again, so the API
  // stores the comment once even when the first answer was lost. A changed text is a new comment.
  const sendId = useRef<string | null>(null);

  const send = useMutation({
    mutationFn: (body: string) => {
      sendId.current ??= crypto.randomUUID();
      return addRequestComment(company.companyId, requestId, { id: sendId.current, body });
    },
    onSuccess: (detail) => {
      sendId.current = null;
      saveDraft(key, null);
      setText('');
      setTouched(false);
      // Only the page of this request: a comment changes no list, no desk and no count.
      queryClient.setQueryData(requestKey(company.companyId, requestId), detail);
    },
    onError: (error) => {
      // The page on screen is older than the API's: the right to comment or the request itself
      // went away meanwhile. It is read again; the text stays in the box (see below).
      if (
        error instanceof ApiError &&
        (error.code === 'comment_not_allowed' || error.status === 404)
      ) {
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
  const failure = send.isError && !isUnauthorized(send.error) ? userMessage(send.error) : null;

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    setTouched(true);
    if (busy || empty || tooLong || !mayWrite) return;
    send.mutate(text);
  }

  if (!mayWrite) {
    if (empty) {
      return (
        <p className="text-sm text-ink-secondary">
          Bu talebe yalnızca talep sahibi, birimin onaylayıcısı ve kurucu yorum yazabilir.
        </p>
      );
    }
    // The right went away while a text was in the box (the routing was corrected to another
    // unit): the text is not taken from the person. It can be copied or discarded, not sent.
    return (
      <div className="flex flex-col gap-2">
        <p id={`${id}-gone`} role="status" className="text-sm">
          Bu talebe artık yorum yazamazsınız. Yazdığınız metin aşağıda duruyor; gerekiyorsa
          kopyalayın.
        </p>
        <Textarea
          aria-label="Yorum yaz"
          aria-describedby={`${id}-gone`}
          className="max-h-60"
          readOnly
          value={text}
        />
        <Button
          type="button"
          variant="ghost"
          className="self-start"
          onClick={() => {
            saveDraft(key, null);
            setText('');
          }}
        >
          Taslağı at
        </Button>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-1.5" noValidate onSubmit={submit}>
      <label htmlFor={`${id}-text`} className="text-sm font-medium">
        Yorum yaz
      </label>
      <Textarea
        id={`${id}-text`}
        rows={3}
        className="max-h-60"
        value={text}
        // Not disabled while the comment is being sent: the box keeps the focus.
        readOnly={busy}
        aria-invalid={problem !== null}
        aria-describedby={`${id}-help ${id}-keys${problem ? ` ${id}-error` : ''}`}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          // A new text is a new comment, and the reason the last one failed no longer applies.
          sendId.current = null;
          if (send.isError) send.reset();
          saveDraftSoon(key, next.trim() === '' ? null : next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
        }}
      />
      {problem ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <p id={`${id}-help`} className="text-sm text-ink-secondary">
        Yorumları yalnızca insanlar okur: talebi görebilen herkes. Ajanlar yorumları görmez; yorum
        talebi ve işin gidişini değiştirmez.
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
    </form>
  );
}
