import { describe, expect, it } from 'vitest';
import {
  REJECTED_NOTE,
  RESET_NOTE,
  RETURNED_NOTE,
  STOPPED_NOTE,
} from '../../test/request-fixtures.ts';
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
