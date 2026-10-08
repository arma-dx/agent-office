import { describe, expect, it } from 'vitest';
import { ARMADX_OFFICE, FOUNDER_OFFICE, PILLIKA_OFFICE } from '@/test/office-fixtures';
import {
  AGENT_STATE_LABEL,
  AGENT_STATE_SENTENCE,
  NO_WORK,
  agentId,
  isOpen,
  selectionOf,
  shortName,
  stateOf,
  unitId,
} from './model.ts';

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

  it('keeps the switch that says more, and reads an open agent without work as idle', () => {
    expect(stateOf('enabled')).toBe('idle');
    expect(stateOf('enabled', NO_WORK)).toBe('idle');
    expect(stateOf('stopped')).toBe('stopped');
  });

  it('shows what the open requests of an open agent say, by the shared rule', () => {
    const one = { count: 1, requestId: '00000000-0000-4000-8000-000000000001' };
    const two = { count: 2, requestId: null };
    expect(stateOf('enabled', { ...NO_WORK, running: one })).toBe('running');
    expect(stateOf('enabled', { ...NO_WORK, running: two, awaitingApproval: one })).toBe(
      'awaiting_approval',
    );
    expect(stateOf('enabled', { running: two, awaitingApproval: one, failed: one })).toBe('error');
    // The switch comes first.
    expect(stateOf('stopped', { ...NO_WORK, failed: one })).toBe('stopped');
    expect(stateOf(null, { ...NO_WORK, awaitingApproval: one })).toBe('closed');
  });

  it('knows an open agent from one that takes no work', () => {
    expect(
      (['closed', 'idle', 'running', 'awaiting_approval', 'error', 'stopped'] as const).map(isOpen),
    ).toEqual([false, true, true, true, true, false]);
  });

  it('has a Turkish word for every state', () => {
    expect(AGENT_STATE_LABEL).toEqual({
      closed: 'Kapalı',
      idle: 'Boşta',
      running: 'Çalışıyor',
      awaiting_approval: 'Onay bekliyor',
      error: 'Hata',
      stopped: 'Durduruldu',
    });
  });

  it('has a sentence for every state that claims no history and names no company', () => {
    expect(AGENT_STATE_SENTENCE).toEqual({
      closed: 'Bu ajan kapalı.',
      idle: 'Bu ajan açık ve boşta.',
      running: 'Bu ajan çalışıyor.',
      awaiting_approval: 'Bu ajanın sonucu onay bekliyor.',
      error: 'Bu ajanın yürüttüğü bir talep insana düştü.',
      stopped: 'Bu ajan durduruldu, yeni iş almaz.',
    });
  });
});

describe('ids', () => {
  it('tells a unit from an agent with the same code prefix', () => {
    expect(unitId('KOR')).toBe('unit:KOR');
    expect(agentId('KOR-1')).toBe('agent:KOR-1');
  });
});

describe('selectionOf', () => {
  it('finds a unit by its id', () => {
    const selection = selectionOf(ARMADX_OFFICE, 'unit:A-KES');
    expect(selection).toEqual({ kind: 'unit', unit: ARMADX_OFFICE[4] });
    expect(selection?.unit.name).toBe('Keşif ve Dönüşüm Danışmanlığı');
  });

  it('finds an agent together with the unit it sits in', () => {
    const selection = selectionOf(ARMADX_OFFICE, 'agent:KOR-3');
    expect(selection).toEqual({
      kind: 'agent',
      unit: ARMADX_OFFICE[1],
      agent: {
        code: 'KOR-3',
        name: 'Onay Masası Ajanı',
        state: 'closed',
        ready: true,
        work: NO_WORK,
      },
    });
  });

  it('gives null for a thing the list does not hold, and for an id of the other kind', () => {
    // P-IST is Pillika's unit; a selection never outlives the data it was made in.
    expect(selectionOf(ARMADX_OFFICE, 'unit:P-IST')).toBeNull();
    expect(selectionOf(ARMADX_OFFICE, 'agent:KOR-4')).toBeNull();
    expect(selectionOf(ARMADX_OFFICE, 'agent:KOR')).toBeNull();
    expect(selectionOf(ARMADX_OFFICE, 'unit:KOR-1')).toBeNull();
    expect(selectionOf([], 'unit:KOR')).toBeNull();
  });
});
