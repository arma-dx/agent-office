import { NOTIFICATION_LIST_LIMIT, type Today, type TodayNotification } from '@agent-office/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { linkOptions } from '@tanstack/react-router';
import { useId } from 'react';
import { ListRow } from '@/components/list-row';
import { Button } from '@/components/ui/button';
import { formatFull, formatWhen } from '@/lib/dates';
import { notifyError } from '@/lib/notify';
import { useCompany } from '@/lib/session';
import { useRowFocus } from '@/lib/today/focus';
import {
  notificationLabel,
  notificationSentence,
  notificationTitle,
  PASSKEYS_RESET_NEXT,
} from '@/lib/today/labels';
import { markNotificationsRead, todayKey } from '@/lib/today/query';
import { busyProps, cn } from '@/lib/utils';

/**
 * "Bildirimler": what happened to the reader's requests without their doing anything (returned,
 * rejected, stopped), and a reset of their passkeys. Each row is a fixed sentence and a link; the
 * reason of a rejection or a stop is on the page of the request. A notification is unread until
 * the person opens its link or presses "Okundu"; a read one stays, quieter (docs/SONRA.md W-o).
 * Nothing is shown as read before the API has stored the mark.
 */
function NotificationRow({
  notification,
  company,
  busy,
  onRead,
}: {
  notification: TodayNotification;
  company: string;
  busy: boolean;
  /** `quiet`: the mark is sent by opening the link; a failure is not shown. */
  onRead: (quiet: boolean) => void;
}) {
  const title = notificationTitle(notification);
  const label = notificationLabel(notification);
  // Opening the link from here is reading the notification.
  const onClick = notification.read
    ? undefined
    : () => {
        onRead(true);
      };
  const link =
    notification.template === 'passkeys_reset'
      ? linkOptions({
          to: '/c/$company/settings/security',
          params: { company },
          'aria-label': label,
          onClick,
        })
      : linkOptions({
          to: '/c/$company/requests/$requestId',
          params: { company, requestId: notification.request.id },
          'aria-label': label,
          onClick,
        });
  return (
    <ListRow
      className={notification.read ? 'text-ink-secondary' : 'font-medium'}
      // The mark of an unread row; the link's name says "Okunmadı" in words.
      leading={
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', !notification.read && 'bg-brand')}
        />
      }
      title={title}
      subtitle={
        notification.template === 'passkeys_reset'
          ? PASSKEYS_RESET_NEXT
          : notificationSentence(notification)
      }
      link={link}
      trailing={
        <>
          {notification.read ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-label={`Okundu: ${title}`}
              {...busyProps(busy)}
              onClick={(event) => {
                if (busy) return;
                // The button goes away with the mark: the keyboard stays on the row.
                event.currentTarget.closest('li')?.querySelector('a')?.focus();
                onRead(false);
              }}
            >
              Okundu
            </Button>
          )}
          <time
            dateTime={notification.createdAt}
            title={formatFull(notification.createdAt)}
            className="w-20 text-right text-xs font-normal text-ink-secondary tabular-nums"
          >
            {formatWhen(notification.createdAt)}
          </time>
        </>
      }
    />
  );
}

export function NotificationsSection({
  notifications,
  truncated,
}: {
  notifications: readonly TodayNotification[];
  truncated: boolean;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const headingId = useId();
  const { headingRef, onFocusCapture, onBlurCapture } = useRowFocus(
    notifications.map((notification) => notification.id).join(' '),
  );
  const mark = useMutation({
    mutationFn: (input: { ids: readonly string[]; quiet: boolean }) =>
      markNotificationsRead(company.companyId, input.ids),
    // On the options of the hook, not of the call: it also runs when the person has left the
    // screen through the link that sent the mark.
    onSuccess: (_data, input) => {
      queryClient.setQueryData<Today>(
        todayKey(company.companyId),
        (today) =>
          today && {
            ...today,
            notifications: today.notifications.map((notification) =>
              input.ids.includes(notification.id) ? { ...notification, read: true } : notification,
            ),
          },
      );
    },
    onError: (error, input) => {
      if (!input.quiet) notifyError(error);
    },
  });
  const unread = notifications.filter((notification) => !notification.read);
  const sending = mark.isPending ? mark.variables.ids : [];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex min-h-8 items-center justify-between gap-4 px-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-sm font-semibold">
          Bildirimler
        </h2>
        {unread.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            {...busyProps(mark.isPending)}
            onClick={() => {
              if (mark.isPending) return;
              // The button goes away when nothing is unread: the keyboard goes to the heading.
              headingRef.current?.focus();
              mark.mutate({ ids: unread.map((notification) => notification.id), quiet: false });
            }}
          >
            Tümünü okundu say
          </Button>
        ) : null}
      </div>
      {notifications.length === 0 ? (
        <p className="px-2 text-sm text-ink-secondary">
          {company.role === 'external'
            ? 'Bildiriminiz yok.'
            : 'Bildiriminiz yok. Talebiniz siz bir şey yapmadan kapanırsa burada haber verilir.'}
        </p>
      ) : (
        <ul className="flex flex-col" onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              company={company.code}
              busy={sending.includes(notification.id)}
              onRead={(quiet) => {
                mark.mutate({ ids: [notification.id], quiet });
              }}
            />
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="px-2 text-sm text-ink-secondary">
          Liste en yeni {NOTIFICATION_LIST_LIMIT} bildirimi gösteriyor.
        </p>
      ) : null}
    </section>
  );
}
