import { requestCauseSchema, type RequestCause } from '@agent-office/shared';
import { describe, expect, it } from 'vitest';
import {
  REJECTED_NOTE,
  RESET_NOTE,
  RETURNED_NOTE,
  STOPPED_NOTE,
} from '../../test/request-fixtures.ts';
import { textWidth } from '../../test/text-width.ts';
import {
  expectationText,
  notificationLabel,
  notificationSentence,
  notificationTitle,
  statusLine,
} from './labels.ts';

describe('the words of the Bugün screen', () => {
  it('says what is expected in the words of the request page', () => {
    expect(expectationText({ stage: 'unit_approval', cause: null, delayed: false })).toBe(
      'Onayınız bekleniyor',
    );
    expect(expectationText({ stage: 'requester_approval', cause: null, delayed: false })).toBe(
      'Sonucu onaylamanız bekleniyor',
    );
    expect(
      expectationText({ stage: 'fell_to_person', cause: 'no_submission', delayed: false }),
    ).toBe('Sizden bekleniyor: ajan sonuç sunmadı');
    // Also for a summary that names somebody else as the one whose turn it is: a result the
    // founder may decide while another person is appointed is still expected of the founder.
    const appointed = {
      stage: 'unit_approval' as const,
      cause: null,
      delayed: false,
      waitingForMe: false,
    };
    expect(expectationText(appointed)).toBe('Onayınız bekleniyor');
  });

  it('keeps every expectation inside its column of the row', () => {
    // The column of the Bugün row is 336 px wide (w-84 in components/today/expected-section.tsx)
    // and cuts what does not fit. The cut part could be read nowhere on the screen, because a
    // tooltip under the row's link is never shown. A reason that fails here needs a shorter
    // wording in CAUSE_SHORT or a wider column, and then a new number here.
    const COLUMN = 336;
    // A closed request waits for nobody and is never on the list; every other cause, and so
    // every cause that is added later, is one a request can fall to a person with.
    const closed: readonly RequestCause[] = [
      'returned_no_agent',
      'cancelled_by_requester',
      'stopped',
      'closed_after_delivery',
      'rejected',
    ];
    const fallen = requestCauseSchema.options.filter((cause) => !closed.includes(cause));
    // Sixteen since a closed AI permission holds a request (two causes of Projects step 2).
    expect(fallen).toHaveLength(16);
    expect(fallen).toEqual(
      expect.arrayContaining(['ai_permission_closed', 'ai_permission_interrupted']),
    );
    const texts = [
      expectationText({ stage: 'unit_approval', cause: null, delayed: false }),
      expectationText({ stage: 'requester_approval', cause: null, delayed: false }),
      // A request that fell to a person is never "gecikti": nothing runs that could be late.
      ...fallen.map((cause) => expectationText({ stage: 'fell_to_person', cause, delayed: false })),
    ];
    expect(texts.filter((text) => textWidth(text) > COLUMN)).toEqual([]);
    // The widest today, and the measure itself: 320.6 px without kerning, 320.4 px in a browser.
    const widest = texts.reduce((a, b) => (textWidth(a) >= textWidth(b) ? a : b));
    expect(widest).toBe('Sizden bekleniyor: model hesabında ödeme sorunu');
    expect(textWidth(widest)).toBeCloseTo(320.6, 1);
  });

  it('says to a screen reader only what is above zero', () => {
    expect(statusLine(3, 2)).toBe('3 iş sizden bekleniyor. 2 okunmamış bildirim var.');
    expect(statusLine(0, 1)).toBe('1 okunmamış bildirim var.');
    expect(statusLine(2, 0)).toBe('2 iş sizden bekleniyor.');
    expect(statusLine(0, 0)).toBe('');
  });

  it('builds every notification sentence from the template and the names of records', () => {
    expect(notificationSentence(RETURNED_NOTE)).toBe(
      'Talebiniz geri çevrildi: Hukuk ve Uyum biriminde bu işi alabilecek açık ajan yok.',
    );
    // The unit is gone: the sentence stays true without its name.
    if (RETURNED_NOTE.template !== 'request_returned') throw new Error('Not a return');
    expect(notificationSentence({ ...RETURNED_NOTE, unit: null })).toBe(
      'Talebiniz geri çevrildi: birimde bu işi alabilecek açık ajan yok.',
    );
    expect(notificationSentence(REJECTED_NOTE)).toBe('Talebinizin sonucu reddedildi.');
    expect(notificationSentence(STOPPED_NOTE)).toBe('Talebiniz durduruldu.');
    expect(notificationSentence(RESET_NOTE)).toBe(
      "Passkey'leriniz sıfırlandı. Güvenlik sayfasından yeni bir passkey ekleyin.",
    );

    expect(notificationTitle(RETURNED_NOTE)).toBe('KVKK metni');
    expect(notificationTitle(STOPPED_NOTE)).toBe('Fuar davetiyesi');
    expect(notificationTitle(RESET_NOTE)).toBe("Passkey'leriniz sıfırlandı");

    // The link's name says in words that a notification is unread, and stops saying so once read.
    expect(notificationLabel(REJECTED_NOTE)).toBe(
      'Okunmadı. Ekim duyurusu, Talebinizin sonucu reddedildi.',
    );
    expect(notificationLabel({ ...REJECTED_NOTE, read: true })).toBe(
      'Ekim duyurusu, Talebinizin sonucu reddedildi.',
    );
    expect(notificationLabel(RESET_NOTE)).toBe(
      "Okunmadı. Passkey'leriniz sıfırlandı. Güvenlik sayfasından yeni bir passkey ekleyin.",
    );
    expect(notificationLabel({ ...RESET_NOTE, read: true })).toBe(
      "Passkey'leriniz sıfırlandı. Güvenlik sayfasından yeni bir passkey ekleyin.",
    );
  });
});
