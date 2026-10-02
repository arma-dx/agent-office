import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiHatasi, apiIstegi, kaliciHataMi, kullaniciMesaji } from './api.ts';

const sema = z.object({ status: z.literal('ok') });

function fetchYanit(govde: unknown, durum = 200) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(govde), {
        status: durum,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiIstegi', () => {
  it('yalnızca göreli /api yoluna aynı kökenden istek atar ve yanıtı doğrular', async () => {
    const fetchSahte = fetchYanit({ status: 'ok' });
    vi.stubGlobal('fetch', fetchSahte);
    await expect(apiIstegi('/health', { sema })).resolves.toEqual({ status: 'ok' });
    expect(fetchSahte).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('başarısız yanıtı durum koduyla ApiHatasi yapar', async () => {
    vi.stubGlobal('fetch', fetchYanit({}, 503));
    await expect(apiIstegi('/health', { sema })).rejects.toMatchObject({ durum: 503 });
  });

  it('ağ hatasını durum 0 ile bildirir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('ağ yok'))),
    );
    await expect(apiIstegi('/health', { sema })).rejects.toMatchObject({ durum: 0 });
  });

  it('şemaya uymayan yanıtı reddeder', async () => {
    vi.stubGlobal('fetch', fetchYanit({ status: 'bozuk' }));
    await expect(apiIstegi('/health', { sema })).rejects.toBeInstanceOf(ApiHatasi);
  });

  it('gövdesiz yanıtı (204) kabul eder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    await expect(
      apiIstegi('/x', { yontem: 'DELETE', sema: z.undefined() }),
    ).resolves.toBeUndefined();
  });

  it('JSON olmayan yanıtı ApiHatasi yapar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html></html>', { status: 200 }))),
    );
    await expect(apiIstegi('/health', { sema })).rejects.toBeInstanceOf(ApiHatasi);
  });

  it('iptal edilen isteği ApiHatasi yapmaz', async () => {
    const kontrol = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        kontrol.abort();
        return Promise.reject(new DOMException('iptal', 'AbortError'));
      }),
    );
    await expect(apiIstegi('/health', { sema, sinyal: kontrol.signal })).rejects.not.toBeInstanceOf(
      ApiHatasi,
    );
  });

  it('mutlak adrese istek atmaz', async () => {
    await expect(apiIstegi('https://ornek.com/x', { sema })).rejects.toThrow(/ile başlamalı/);
  });
});

describe('kullaniciMesaji', () => {
  it('ne olduğunu ve ne yapılacağını söyler', () => {
    expect(kullaniciMesaji(new ApiHatasi(0, ''))).toMatch(/Bağlantınızı kontrol/);
    expect(kullaniciMesaji(new ApiHatasi(401, ''))).toMatch(/Yeniden giriş/);
    expect(kullaniciMesaji(new ApiHatasi(500, ''))).toMatch(/yeniden deneyin/);
    expect(kullaniciMesaji(new ApiHatasi(429, ''))).toMatch(/Biraz bekleyip/);
    expect(kullaniciMesaji(new ApiHatasi(409, 'iç ayrıntı'))).toMatch(/kontrol edip/);
    expect(kullaniciMesaji(new Error('iç ayrıntı'))).not.toMatch(/iç ayrıntı/);
  });

  it('4xx hataları kalıcı sayar, ağ ve sunucu hatalarını saymaz', () => {
    expect(kaliciHataMi(new ApiHatasi(401, ''))).toBe(true);
    expect(kaliciHataMi(new ApiHatasi(0, ''))).toBe(false);
    expect(kaliciHataMi(new ApiHatasi(503, ''))).toBe(false);
  });
});
