import { describe, expect, it } from 'vitest';
import {
  handOverDescription,
  memberLine,
  PROJECT_ROLE,
  ROLE_ACT,
  ROLE_ACT_ORDER,
  roleGivenSentence,
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
