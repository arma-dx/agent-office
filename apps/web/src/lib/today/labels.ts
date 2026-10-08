import type { RequestSummary, TodayNotification } from '@agent-office/shared';
import { stageText } from '../requests/labels.ts';

/**
 * The words of the Bugün screen. Every sentence is made here from codes and names of records; none
 * comes from the database and none is written by a model.
 */

/**
 * What is expected of the reader, in the words the request page and the Talepler list use for the
 * one whose turn it is: "Onayınız bekleniyor", "Sonucu onaylamanız bekleniyor",
 * "Sizden bekleniyor: <neden>". Every row of the list is expected of the reader, also a result the
 * founder may decide while somebody else is appointed for it.
 */
export function expectationText(
  request: Pick<RequestSummary, 'stage' | 'cause' | 'delayed'>,
): string {
  return stageText({ ...request, waitingForMe: true });
}

export const PASSKEYS_RESET_TITLE = "Passkey'leriniz sıfırlandı";
export const PASSKEYS_RESET_NEXT = 'Güvenlik sayfasından yeni bir passkey ekleyin.';

/** The fixed sentence of a notification. The reason of a rejection or a stop is on the request. */
export function notificationSentence(notification: TodayNotification): string {
  switch (notification.template) {
    case 'request_returned':
      return notification.unit === null
        ? 'Talebiniz geri çevrildi: birimde bu işi alabilecek açık ajan yok.'
        : `Talebiniz geri çevrildi: ${notification.unit.name} biriminde bu işi alabilecek açık ajan yok.`;
    case 'request_rejected':
      return 'Talebinizin sonucu reddedildi.';
    case 'request_stopped':
      return 'Talebiniz durduruldu.';
    case 'passkeys_reset':
      return `${PASSKEYS_RESET_TITLE}. ${PASSKEYS_RESET_NEXT}`;
  }
}

/** What a notification is about, as the title of its row: the request, or the reset. */
export function notificationTitle(notification: TodayNotification): string {
  return notification.template === 'passkeys_reset'
    ? PASSKEYS_RESET_TITLE
    : notification.request.title;
}

/** The accessible sentence of a notification's link: whether it is unread, what and which. */
export function notificationLabel(notification: TodayNotification): string {
  const sentence = notificationSentence(notification);
  const what =
    notification.template === 'passkeys_reset'
      ? sentence
      : `${notification.request.title}, ${sentence}`;
  return `${notification.read ? '' : 'Okunmadı. '}${what}`;
}

/** Said to a screen reader once when it changes. Empty when nothing waits and nothing is unread. */
export function statusLine(expected: number, unread: number): string {
  return [
    expected > 0 ? `${String(expected)} iş sizden bekleniyor.` : '',
    unread > 0 ? `${String(unread)} okunmamış bildirim var.` : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
