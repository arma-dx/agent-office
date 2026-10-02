import pg from 'pg';

export {
  ajanAdimi,
  ajanBaglamiSemasi,
  baglamKur,
  baglamliIslem,
  baglamSemasi,
  type AjanBaglami,
  type Baglam,
  type BaglamGirdisi,
} from './baglam.ts';

/**
 * Bağlantı havuzu. Adres kısıtlı uygulama rolüne aittir (ofis_uygulama üyesi, BYPASSRLS yok);
 * yetkili rolün adresi uygulamaya hiç verilmez (kural 9). Adres loglara yazılmaz.
 * Boştaki bir bağlantı koparsa havuz hata yayar; dinleyici olmazsa süreç çöker, bu yüzden zorunlu.
 */
export function havuzOlustur(
  baglantiAdresi: string,
  uygulamaAdi: string,
  hataDinleyici: (hata: Error) => void,
): pg.Pool {
  const havuz = new pg.Pool({ connectionString: baglantiAdresi, application_name: uygulamaAdi });
  havuz.on('error', hataDinleyici);
  return havuz;
}
