import type { RequestSummary } from '@agent-office/shared';
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

/** Said to a screen reader once when it changes. Empty when nothing waits and nothing is unread. */
export function statusLine(expected: number, unread: number): string {
  return [
    expected > 0 ? `${String(expected)} iş sizden bekleniyor.` : '',
    unread > 0 ? `${String(unread)} okunmamış bildirim var.` : '',
  ]
    .filter((part) => part !== '')
    .join(' ');
}
