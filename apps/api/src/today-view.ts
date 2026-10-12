import type { NotificationRow, RequestRow } from '@agent-office/db';
import type { RequestSummary, TodayNotification } from '@agent-office/shared';

/**
 * What the Bugün screen is made of, from rows the person could read. Pure functions.
 */

export type ExpectedKind = 'approval' | 'acceptance' | 'answer' | 'fallen';

/**
 * What a request expects of the reader, or null when it expects nothing of them.
 *   approval    a result waits for the unit approver's decision and the reader may decide it: the
 *               founder, or the appointed approver (the rule of the approval desk, GET
 *               /api/approvals; `reader_may_decide` is that rule asked of the active step, whose
 *               approver the pending result carries);
 *   acceptance  the approved result waits for its requester, and the reader is the requester;
 *   answer      an agent's question waits for the reader's answer;
 *   fallen      the request fell to a person and it is the reader's turn.
 */
export function expectedKind(row: RequestRow, summary: RequestSummary): ExpectedKind | null {
  switch (summary.stage) {
    case 'unit_approval':
      return row.reader_may_decide ? 'approval' : null;
    case 'requester_approval':
      return summary.waitingForMe ? 'acceptance' : null;
    case 'awaiting_reply':
      // The agent's question waits for the reader: the requester, or the founder while the
      // requester cannot read the request.
      return summary.waitingForMe ? 'answer' : null;
    case 'fell_to_person':
      return summary.waitingForMe ? 'fallen' : null;
    default:
      return null;
  }
}

/**
 * A notification as the panel reads it: the template and ids, never a text. Null for a row the
 * panel has no sentence for (the statement lists none) and for a flow notification without its
 * request.
 */
export function toNotification(row: NotificationRow): TodayNotification | null {
  const base = { id: row.id, createdAt: row.created_at.toISOString(), read: row.read };
  const request =
    row.request_id !== null && row.request_title !== null
      ? { id: row.request_id, title: row.request_title }
      : null;
  switch (row.template) {
    case 'passkeys_reset':
      return { ...base, template: 'passkeys_reset' };
    case 'request_returned':
      return request === null
        ? null
        : {
            ...base,
            template: 'request_returned',
            request,
            unit:
              row.unit_code !== null && row.unit_name !== null
                ? { code: row.unit_code, name: row.unit_name }
                : null,
          };
    case 'request_rejected':
    case 'request_stopped':
      return request === null ? null : { ...base, template: row.template, request };
    default:
      return null;
  }
}
