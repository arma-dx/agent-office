import type { AgentState, OfficeUnit } from '@/lib/office/model';

function unit(
  code: string,
  name: string,
  agents: readonly (readonly [string, string])[],
  state: AgentState = 'closed',
): OfficeUnit {
  return {
    code,
    name,
    agents: agents.map(([agentCode, agentName]) => ({
      code: agentCode,
      name: agentName,
      state,
      ready: true,
    })),
  };
}

// The pilot cards in agents/*.yaml on 6 October 2026. No company has opened an agent yet, so every
// agent is "closed". Units in the order GET /api/office gives them: shared units by code, then the
// company's own by code.
export const ARMADX_OFFICE: OfficeUnit[] = [
  unit('HAF', 'Kurumsal Hafıza', [
    ['HAF-1', 'Bilgi Tabanı Ajanı'],
    ['HAF-2', 'Kurumsal Arama Ajanı'],
  ]),
  unit('KOR', 'Koordinasyon Katmanı', [
    ['KOR-1', 'Ofis Koordinatörü'],
    ['KOR-2', 'Görev Takip Ajanı'],
    ['KOR-3', 'Onay Masası Ajanı'],
    ['KOR-5', 'Toplantı Ajanı'],
  ]),
  unit('SOS', 'Sosyal Medya', [['SOS-2', 'Sosyal İçerik Yazım Ajanı']]),
  unit('TAS', 'Tasarım ve Kreatif Stüdyo', [
    ['TAS-3', 'UI/UX Tasarım Ajanı'],
    ['TAS-6', 'Sosyal Medya Görsel Ajanı'],
  ]),
  unit('A-KES', 'Keşif ve Dönüşüm Danışmanlığı', [['A-KES-2', 'Süreç Analizi Ajanı']]),
  unit('A-PRJ', 'Proje Teslimat', [['A-PRJ-2', 'Proje Takip Ajanı']]),
  unit('A-TEK', 'Çözüm ve Teklif', [['A-TEK-2', 'Teklif Ajanı']]),
];

export const PILLIKA_OFFICE: OfficeUnit[] = [
  ...ARMADX_OFFICE.slice(0, 4),
  unit('P-IST', 'İstasyon Verisi ve Şarj Operasyonları', [
    ['P-IST-1', 'İstasyon Veri Toplama Ajanı'],
  ]),
];

export const FOUNDER_OFFICE: OfficeUnit[] = [
  unit('KOR', 'Koordinasyon Katmanı', [['KOR-4', 'Yönetici Asistanı']]),
];

// Agents per unit in the design report: 37 units, 173 agents, at most 9 in one unit.
const REPORT_COUNTS = [
  5, 3, 4, 5, 8, 9, 6, 5, 5, 9, 7, 4, 4, 4, 8, 6, 4, 4, 4, 5, 3, 3, 5, 4, 4, 4, 5, 4, 5, 4, 3, 3, 6,
  3, 2, 2, 4,
];
const MIXED_STATES: AgentState[] = ['enabled', 'closed', 'enabled', 'stopped', 'closed'];

/** The upper bound of the scene: every unit of the report, with a mix of states. */
export const REPORT_OFFICE: OfficeUnit[] = REPORT_COUNTS.map((count, index) => ({
  code: `B${index + 1}`,
  name: `Birim ${index + 1}`,
  agents: Array.from({ length: count }, (_, i) => ({
    code: `B${index + 1}-${i + 1}`,
    name: `Örnek ajan ${i + 1}`,
    state: MIXED_STATES[(index + i) % MIXED_STATES.length] ?? 'closed',
    ready: true,
  })),
}));

/** Gives the agents of a list a mix of the three states; the pilot data has only closed agents. */
export function withMixedStates(units: readonly OfficeUnit[]): OfficeUnit[] {
  let n = 0;
  return units.map((item) => ({
    ...item,
    agents: item.agents.map((agent) => ({
      ...agent,
      state: MIXED_STATES[n++ % MIXED_STATES.length] ?? 'closed',
    })),
  }));
}
