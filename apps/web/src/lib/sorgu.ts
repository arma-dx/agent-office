import { QueryClient } from '@tanstack/react-query';
import { kaliciHataMi } from './api.ts';

/** Sorgu istemcisi: yeniden denemekle düzelmeyecek hatalarda (4xx) yeniden denenmez, diğerlerinde en fazla 3 kez. */
export function sorguIstemcisiOlustur(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (sayi, hata) => !kaliciHataMi(hata) && sayi < 3,
      },
    },
  });
}
