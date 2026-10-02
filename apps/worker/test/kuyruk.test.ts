import { randomUUID } from 'node:crypto';
import { describe, expect, inject, it, vi } from 'vitest';
import { isGonder, isVerisiSemasi, kuyrukOlustur } from '../src/kuyruk.ts';

describe('iş verisi (kural 10)', () => {
  it('yalnızca kimlik alanlarını kabul eder', () => {
    const id = randomUUID();
    expect(isVerisiSemasi.safeParse({ gorevId: id, calismaId: id }).success).toBe(true);
    expect(isVerisiSemasi.safeParse({ gorev: id }).success).toBe(false);
    expect(isVerisiSemasi.safeParse({ gorevId: 'Müşteriye teklif gönder' }).success).toBe(false);
    expect(isVerisiSemasi.safeParse({ gorevId: { metin: 'x' } }).success).toBe(false);
    const cok = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${String(i)}Id`, id]));
    expect(isVerisiSemasi.safeParse(cok).success).toBe(false);
  });

  it('kuyruğa yalnızca doğrulanmış veriyi koyar', async () => {
    const send = vi.fn(() => Promise.resolve('is-1'));
    const id = randomUUID();
    await expect(isGonder({ send }, 'kor_talep', { gorevId: id })).resolves.toBe('is-1');
    expect(send).toHaveBeenCalledWith('kor_talep', { gorevId: id });
    await expect(isGonder({ send }, 'kor_talep', { ozet: 'metin' })).rejects.toThrow();
    await expect(isGonder({ send }, 'Kötü Ad', { gorevId: id })).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

const veritabani = inject('veritabani');

describe.skipIf(veritabani === null)('kuyruk veritabanında', () => {
  it('kısıtlı uygulama rolüyle başlar, iş koyar ve alır', async () => {
    const hatalar: unknown[] = [];
    const kuyruk = kuyrukOlustur(veritabani?.uygulama ?? '', (hata) => hatalar.push(hata));
    await kuyruk.start();
    try {
      await kuyruk.createQueue('deneme_kuyrugu');
      const gorevId = randomUUID();
      expect(await isGonder(kuyruk, 'deneme_kuyrugu', { gorevId })).toEqual(expect.any(String));
      const isler = await kuyruk.fetch('deneme_kuyrugu');
      expect(isler.map((is) => is.data)).toEqual([{ gorevId }]);
    } finally {
      await kuyruk.stop({ graceful: false });
    }
    expect(hatalar).toEqual([]);
  });
});
