import { describe, expect, it } from 'vitest';
import { ARMADX_OFFICE, FOUNDER_OFFICE, PILLIKA_OFFICE } from '@/test/office-fixtures';
import { AGENT_STATE_LABEL, agentId, shortName, stateOf, unitId } from './model.ts';

/** Every card name of the pilot, once. */
const CARD_NAMES = [
  ...new Set(
    [...ARMADX_OFFICE, ...PILLIKA_OFFICE, ...FOUNDER_OFFICE].flatMap((unit) =>
      unit.agents.map((agent) => agent.name),
    ),
  ),
];

describe('shortName', () => {
  it('keeps "Onay Masası Ajanı" whole: the short form is the name of the approvals screen', () => {
    expect(shortName('Onay Masası Ajanı')).toBe('Onay Masası Ajanı');
  });

  it('drops the closing word of the other eleven card names that end in "Ajanı"', () => {
    const shortened = CARD_NAMES.filter((name) => shortName(name) !== name);
    expect(shortened).toHaveLength(11);
    expect(Object.fromEntries(shortened.map((name) => [name, shortName(name)]))).toEqual({
      'Bilgi Tabanı Ajanı': 'Bilgi Tabanı',
      'Kurumsal Arama Ajanı': 'Kurumsal Arama',
      'Görev Takip Ajanı': 'Görev Takip',
      'Toplantı Ajanı': 'Toplantı',
      'Sosyal İçerik Yazım Ajanı': 'Sosyal İçerik Yazım',
      'UI/UX Tasarım Ajanı': 'UI/UX Tasarım',
      'Sosyal Medya Görsel Ajanı': 'Sosyal Medya Görsel',
      'Süreç Analizi Ajanı': 'Süreç Analizi',
      'Proje Takip Ajanı': 'Proje Takip',
      'Teklif Ajanı': 'Teklif',
      'İstasyon Veri Toplama Ajanı': 'İstasyon Veri Toplama',
    });
  });

  it('leaves a name without the closing word as it is, and touches the word only at the end', () => {
    expect(shortName('Ofis Koordinatörü')).toBe('Ofis Koordinatörü');
    expect(shortName('Yönetici Asistanı')).toBe('Yönetici Asistanı');
    expect(shortName('Ajanı Takip')).toBe('Ajanı Takip');
    expect(shortName('Ajanı')).toBe('Ajanı');
  });
});

describe('stateOf', () => {
  it('draws an agent without a row and a disabled one as closed', () => {
    expect(stateOf(null)).toBe('closed');
    expect(stateOf('disabled')).toBe('closed');
  });

  it('keeps the two switches that say more', () => {
    expect(stateOf('enabled')).toBe('enabled');
    expect(stateOf('stopped')).toBe('stopped');
  });

  it('has a Turkish word for every state', () => {
    expect(AGENT_STATE_LABEL).toEqual({
      closed: 'Kapalı',
      enabled: 'Etkin',
      stopped: 'Durduruldu',
    });
  });
});

describe('ids', () => {
  it('tells a unit from an agent with the same code prefix', () => {
    expect(unitId('KOR')).toBe('unit:KOR');
    expect(agentId('KOR-1')).toBe('agent:KOR-1');
  });
});
