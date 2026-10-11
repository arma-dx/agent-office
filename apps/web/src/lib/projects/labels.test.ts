import { describe, expect, it } from 'vitest';
import { project } from '../../test/project-fixtures.ts';
import {
  agentsWord,
  approvalLine,
  handOverDescription,
  LIMIT_REACHED,
  memberLine,
  NO_REQUEST_AT_LIMIT,
  PROJECT_ROLE,
  projectRowSentence,
  ROLE_ACT,
  ROLE_ACT_ORDER,
  roleGivenSentence,
  runDurationText,
  runResultReason,
} from './labels.ts';

describe('project labels: roles (8 October decision 44)', () => {
  it("the line under a member's name: project role, company role, devre dışı", () => {
    expect(memberLine({ projectRole: 'owner', role: 'founder', active: true })).toBe(
      'Sahip, Kurucu',
    );
    expect(memberLine({ projectRole: 'manager', role: 'employee', active: true })).toBe(
      'Yönetici, Çalışan',
    );
    expect(memberLine({ projectRole: 'member', role: 'employee', active: false })).toBe(
      'Üye, Çalışan, devre dışı',
    );
    // A person who is no founder or employee of the company any more has no company role.
    expect(memberLine({ projectRole: 'member', role: null, active: false })).toBe(
      'Üye, devre dışı',
    );
    expect(memberLine({ projectRole: 'member', role: null, active: true })).toBe('Üye');
  });

  it('the three roles have one word each, and each act says what it does', () => {
    expect(PROJECT_ROLE).toEqual({ owner: 'Sahip', manager: 'Yönetici', member: 'Üye' });
    expect(ROLE_ACT).toEqual({
      manager: 'Yönetici yap',
      member: 'Yöneticilikten al',
      owner: 'Sahipliği devret',
    });
    // The act that asks first comes last in the menu.
    expect(ROLE_ACT_ORDER).toEqual(['manager', 'member', 'owner']);
  });

  it('what is said once a role is stored names the person', () => {
    expect(roleGivenSentence('manager', 'Ayşe Yılmaz')).toBe('Ayşe Yılmaz yönetici yapıldı.');
    expect(roleGivenSentence('member', 'Ayşe Yılmaz')).toBe('Ayşe Yılmaz artık yönetici değil.');
    expect(roleGivenSentence('owner', 'Ayşe Yılmaz')).toBe('Projenin yeni sahibi: Ayşe Yılmaz.');
  });

  it('the hand-over confirmation says what changes for the reader who confirms it', () => {
    // The owner, an employee: the owner's rights go away with the ownership.
    expect(handOverDescription({ founder: false, owner: true, projectHasOwner: true })).toBe(
      'Projenin sahibi bu kişi olur. Siz üye olarak kalırsınız; üye ekleyip çıkaramaz, rol veremezsiniz. Sahipliği size yeni sahip ya da kurucu geri verebilir.',
    );
    // The founder who owns the project keeps managing it: only the first half is true for them.
    expect(handOverDescription({ founder: true, owner: true, projectHasOwner: true })).toBe(
      'Projenin sahibi bu kişi olur. Siz üye olarak kalırsınız.',
    );
    // The founder hands over somebody else's ownership.
    expect(handOverDescription({ founder: true, owner: false, projectHasOwner: true })).toBe(
      'Projenin sahibi bu kişi olur. Şimdiki sahip üye olarak kalır.',
    );
    // A project without an owner: nobody is a former owner.
    expect(handOverDescription({ founder: true, owner: false, projectHasOwner: false })).toBe(
      'Projenin sahibi bu kişi olur.',
    );
  });
});

describe('project labels: the result of an agent run', () => {
  it('a reason stands after the status word for the codes the list knows', () => {
    expect(runResultReason('limit_reached', 'tool_call_limit')).toBe('araç çağrısı sınırı');
    expect(runResultReason('limit_reached', 'time_limit')).toBe('süre sınırı');
    expect(runResultReason('stopped', 'agent_stopped')).toBe('ajan durduruldu');
    expect(runResultReason('stopped', 'ai_permission_closed')).toBe('yapay zekâ izni kapandı');
    expect(runResultReason('stopped', 'identity_changed')).toBe('kurucunun adına yeniden başladı');
    expect(runResultReason('stopped', 'spending_limit_reached')).toBe('harcama sınırı doldu');
    // A run no switch stopped was stopped because its request changed.
    expect(runResultReason('stopped', 'request_changed')).toBe('talep değişti');
    expect(runResultReason('stopped', 'routing_changed')).toBe('talep değişti');
    expect(runResultReason('failed', 'card_not_runnable')).toBe('ajan kartı çalışmaya açık değil');
    expect(runResultReason('failed', 'model_unavailable')).toBe('model kullanılamadı');
  });

  it('a code is never shown raw: an unknown one gives no reason, and a code of another status none', () => {
    expect(runResultReason('failed', 'runner_error')).toBeNull();
    expect(runResultReason('limit_reached', 'something_new')).toBeNull();
    expect(runResultReason('completed', null)).toBeNull();
    expect(runResultReason('running', null)).toBeNull();
    expect(runResultReason('stopped', null)).toBeNull();
    // A reason belongs to its status: a stop code on a failed run says nothing.
    expect(runResultReason('failed', 'agent_stopped')).toBeNull();
    expect(runResultReason('completed', 'time_limit')).toBeNull();
  });

  it('a duration is seconds under a minute and minutes from a minute on; an open run says Sürüyor', () => {
    expect(runDurationText(null)).toBe('Sürüyor');
    expect(runDurationText(38_000)).toBe('38 sn.');
    expect(runDurationText(200)).toBe('1 sn.');
    expect(runDurationText(59_400)).toBe('59 sn.');
    expect(runDurationText(60_000)).toBe('1 dk.');
    expect(runDurationText(605_000)).toBe('10 dk.');
  });
});

describe('project labels: a result in the list of approvals', () => {
  const agent = { code: 'SOS-2', name: 'Sosyal İçerik Yazım Ajanı' };
  const by = { userId: '33333333-3333-4333-8333-333333333333', name: 'Ayşe Yılmaz' };
  const line = (
    status: Parameters<typeof approvalLine>[0]['status'],
    attempt = 1,
    decidedBy: Parameters<typeof approvalLine>[0]['decidedBy'] = by,
  ) => approvalLine({ agent, status, attempt, decidedBy });

  it('one sentence for each thing that became of a result, with the agent by its code', () => {
    expect(line('pending', 1, null)).toBe('SOS-2 sonucu onay bekliyor.');
    expect(line('pending', 2, null)).toBe('SOS-2 düzeltilmiş sonucu onay bekliyor.');
    expect(line('approved')).toBe('SOS-2 sonucunu Ayşe Yılmaz onayladı.');
    expect(line('changes_requested')).toBe('SOS-2 sonucu için Ayşe Yılmaz düzeltme istedi.');
    expect(line('rejected')).toBe('SOS-2 sonucunu Ayşe Yılmaz reddetti.');
    // Closed is not a decision: nobody is named, also when a name came with it.
    expect(line('closed', 1, null)).toBe('SOS-2 sonucu karar verilmeden kapandı: talep değişti.');
    expect(line('closed', 1, by)).toBe('SOS-2 sonucu karar verilmeden kapandı: talep değişti.');
  });

  it('a person whose name cannot be read any more is "Eski üye"', () => {
    expect(line('approved', 1, { userId: by.userId, name: null })).toBe(
      'SOS-2 sonucunu Eski üye onayladı.',
    );
    expect(line('rejected', 2, null)).toBe('SOS-2 sonucunu Eski üye reddetti.');
  });
});

describe('project labels: a reached AI spending limit (8 October decision 17)', () => {
  it('the word of a project: the permission first, then the limit, then that agents may work', () => {
    expect(agentsWord(true)).toBe('Ajanlar çalışabilir');
    expect(agentsWord(false)).toBe('Ajanlar çalışamaz');
    expect(agentsWord(true, true)).toBe('Harcama sınırı doldu');
    // While agents may not work the limit changes nothing, and is not what is said.
    expect(agentsWord(false, true)).toBe('Ajanlar çalışamaz');
    expect(agentsWord(true, false)).toBe('Ajanlar çalışabilir');
  });

  it("the row's sentence names the limit in the place of the word about agents", () => {
    const open = { aiAllowed: true, agentsMayWork: true, customer: null, targetDate: null };
    expect(projectRowSentence(project({ ...open, spendingLimitReached: true }))).toBe(
      'Depo otomasyonu. Sürüyor. 2 üye. Harcama sınırı doldu.',
    );
    expect(projectRowSentence(project(open))).toBe(
      'Depo otomasyonu. Sürüyor. 2 üye. Ajanlar çalışabilir.',
    );
  });

  it('the banner of the page and the reason of the Talepler tab, for the founder and for the others', () => {
    expect(LIMIT_REACHED).toEqual({
      founder:
        'Bu projenin yapay zekâ harcama sınırı doldu: ajanlar yeni çalışma başlatmıyor. Sınırı "Çalışmalar" sekmesinden yükseltebilirsiniz.',
      others:
        'Bu projenin yapay zekâ harcama sınırı doldu: ajanlar yeni çalışma başlatmıyor. Sınırı yalnızca kurucu yükseltir.',
    });
    expect(NO_REQUEST_AT_LIMIT).toEqual({
      founder:
        'Bu projenin yapay zekâ harcama sınırı dolduğu için talep açılamaz. Sınırı "Çalışmalar" sekmesinden yükseltebilirsiniz.',
      others:
        'Bu projenin yapay zekâ harcama sınırı dolduğu için talep açılamaz. Sınırı kurucu yükseltir.',
    });
    // Nobody but the founder is told an amount or where the limit is set.
    for (const text of [LIMIT_REACHED.others, NO_REQUEST_AT_LIMIT.others]) {
      expect(text).not.toMatch(/\d|\$|dolar|sekme/);
    }
  });
});
