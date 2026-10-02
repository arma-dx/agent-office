// GEÇİCİ: Giriş görevine (KALAN-ISLER 0.3) kadar şirket seçicinin görünmesi için örnek liste.
// Şirket adları koda gömülmez; 0.3'te bu dosya silinir ve liste API'den, kullanıcının üyeliklerinden gelir.

export interface SirketSecenegi {
  kod: string;
  ad: string;
  tur: 'sirket' | 'ozel_alan' | 'holding';
}

export const GECICI_SIRKETLER: readonly SirketSecenegi[] = [
  { kod: 'armadx', ad: 'Arma DX', tur: 'sirket' },
  { kod: 'pillika', ad: 'Pillika', tur: 'sirket' },
  { kod: 'holding', ad: 'Holding görünümü', tur: 'holding' },
  { kod: 'kurucu_alani', ad: 'Kurucu alanı', tur: 'ozel_alan' },
];
