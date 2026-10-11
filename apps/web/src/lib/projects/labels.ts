import type {
  ProjectColor,
  ProjectIcon,
  ProjectMember,
  ProjectMemberRole,
  ProjectSummary,
} from '@agent-office/shared';
import {
  Briefcase,
  ChartColumn,
  Code,
  FileText,
  Folder,
  Globe,
  MapPin,
  Megaphone,
  Package,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { formatDay } from '../dates.ts';
import { PROJECT_STATUS } from '../status.ts';

/**
 * Every Turkish word of the Projects section that is not a status (the statuses are in
 * lib/status.ts), and the pictogram of each project icon. The colour and the icon of a project
 * come from the two fixed sets of the shared contract (8 October 2026, decision 17).
 */

/**
 * The fill class of each project colour (the tokens --project-* of index.css), for the project
 * tile and the swatches of the colour picker. Written out in full: Tailwind generates a class only
 * for a name it finds in the source.
 */
export const PROJECT_FILL: Record<ProjectColor, string> = {
  gray: 'bg-project-gray',
  red: 'bg-project-red',
  orange: 'bg-project-orange',
  green: 'bg-project-green',
  teal: 'bg-project-teal',
  blue: 'bg-project-blue',
  purple: 'bg-project-purple',
  pink: 'bg-project-pink',
};

/** The pictogram of a project icon; drawn only inside the project tile. */
export const PROJECT_ICON: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  code: Code,
  globe: Globe,
  megaphone: Megaphone,
  wrench: Wrench,
  chart: ChartColumn,
  document: FileText,
  pin: MapPin,
  bolt: Zap,
  people: Users,
  box: Package,
};

/** The name of a colour, for a screen reader and for a person who cannot tell the swatches apart. */
export const COLOR_NAME: Record<ProjectColor, string> = {
  gray: 'Gri',
  red: 'Kırmızı',
  orange: 'Turuncu',
  green: 'Yeşil',
  teal: 'Turkuaz',
  blue: 'Mavi',
  purple: 'Mor',
  pink: 'Pembe',
};

export const ICON_NAME: Record<ProjectIcon, string> = {
  folder: 'Klasör',
  briefcase: 'Çanta',
  code: 'Kod',
  globe: 'Dünya',
  megaphone: 'Megafon',
  wrench: 'Anahtar',
  chart: 'Grafik',
  document: 'Belge',
  pin: 'Konum',
  bolt: 'Şimşek',
  people: 'Kişiler',
  box: 'Kutu',
};

/**
 * Where the section is not offered: the two screens the list and the project page show, before any
 * request is sent. A project is opened in a company by its founder and employees.
 */
export const UNAVAILABLE = {
  external: {
    title: 'Projeler dış kişilere açık değil',
    description: 'Projeleri şirketin kurucusu ve çalışanları görür.',
  },
  privateSpace: {
    title: 'Kurucu alanında proje açılmaz',
    description: 'Projeler şirketlerde tutulur. Şirket menüsünden bir şirket seçin.',
  },
} as const;

/**
 * Whether agents may work in a project, in the one pair of words the list and the page use. It is
 * rule 12 as a whole: the project's own permission and, if it has a customer, the customer's.
 */
export function agentsWord(agentsMayWork: boolean): string {
  return agentsMayWork ? 'Ajanlar çalışabilir' : 'Ajanlar çalışamaz';
}

/** The same, as the sentence of the project page, with the reason when agents may not work. */
export function agentsSentence(project: { aiAllowed: boolean; agentsMayWork: boolean }): string {
  if (project.agentsMayWork) return 'Bu projede ajanlar çalışabilir.';
  if (!project.aiAllowed) return 'Bu projede ajanlar çalışamaz: yapay zekâ izni kapalı.';
  return 'Bu projede ajanlar çalışamaz: müşterinin sözleşmesi yapay zekâ kullanımına izin vermiyor.';
}

export function memberCountText(count: number): string {
  return `${String(count)} üye`;
}

/** A row of the project list as one sentence: the name of the row's link. */
export function projectRowSentence(project: ProjectSummary, now?: number): string {
  return [
    project.name,
    PROJECT_STATUS[project.status].label,
    project.customer ? `Müşteri: ${project.customer.name}` : null,
    memberCountText(project.memberCount),
    agentsWord(project.agentsMayWork),
    project.targetDate ? `Hedef tarih: ${formatDay(project.targetDate, now)}` : null,
  ]
    .filter((part) => part !== null)
    .map((part) => `${part}.`)
    .join(' ');
}

/**
 * The AI permission of a project, beside its switch. Never "Açık" or "Kapalı" alone: on the same
 * screens a project is itself open or closed, and one word must not carry two meanings side by
 * side.
 */
export const PERMISSION_WORD = { open: 'İzin açık', closed: 'İzin kapalı' } as const;

/** What a customer's contract says about one kind of use. */
export const CONTRACT_WORD = { allowed: 'İzin var', forbidden: 'İzin yok' } as const;

const MEMBER_ROLE = { founder: 'Kurucu', employee: 'Çalışan' } as const;

/**
 * The three roles of a project membership (8 October 2026, decision 44), in the one set of words
 * every screen uses. A role is a word, never a colour.
 */
export const PROJECT_ROLE: Record<ProjectMemberRole, string> = {
  owner: 'Sahip',
  manager: 'Yönetici',
  member: 'Üye',
};

/**
 * The line under a member's name: the role in the project, the role in the company, and that the
 * account is deactivated.
 */
export function memberLine(member: Pick<ProjectMember, 'projectRole' | 'role' | 'active'>): string {
  return [
    PROJECT_ROLE[member.projectRole],
    member.role ? MEMBER_ROLE[member.role] : null,
    member.active ? null : 'devre dışı',
  ]
    .filter((part) => part !== null)
    .join(', ');
}

/**
 * Giving a role, as the act the menu of a member's row names. The item says what it does, not
 * which role results: "Sahipliği devret" also makes the owner until now a plain member.
 */
export const ROLE_ACT: Record<ProjectMemberRole, string> = {
  manager: 'Yönetici yap',
  member: 'Yöneticilikten al',
  owner: 'Sahipliği devret',
};

/** The order of the acts in the menu; the hand-over, the one that asks first, comes last. */
export const ROLE_ACT_ORDER: readonly ProjectMemberRole[] = ['manager', 'member', 'owner'];

/** What is said once the API has stored the role. */
export function roleGivenSentence(role: ProjectMemberRole, name: string): string {
  if (role === 'manager') return `${name} yönetici yapıldı.`;
  if (role === 'member') return `${name} artık yönetici değil.`;
  return `Projenin yeni sahibi: ${name}.`;
}

// Why the owner's row has no button, for a reader who gives roles.
const OWNER_STAYS = 'Sahip projeden çıkarılamaz.';

/**
 * The fixed sentences of the members part of the project page: who manages the members, and what
 * a row without a button means.
 */
export const MEMBERS_TEXT = {
  noOwnerForFounder: 'Bu projenin sahibi yok. Bir üyeyi sahip yapabilirsiniz.',
  noOwner: 'Bu projenin sahibi yok. Sahibi kurucu atar.',
  // For a reader who gives roles: the owner's row has no button, the way is the hand-over. The
  // menu is named only while a row offers the hand-over in it.
  handOverHint: `${OWNER_STAYS} Sahipliği devretmek için bir üyenin "Rolü değiştir" menüsünü kullanın.`,
  // The same reader when no row offers a hand-over (the owner is the only member, or every other
  // member's account is deactivated): a sentence must not send the reader to a menu no row has.
  ownerStaysHint: OWNER_STAYS,
  // For a manager: why a manager's row has no button.
  managerHint:
    'Bir yöneticiyi projeden yalnızca sahip ya da kurucu çıkarır; rolleri de onlar verir.',
  whoManages: 'Üye eklemeyi ve çıkarmayı projenin sahibi, yöneticileri ve kurucu yapar.',
} as const;

/**
 * What handing the ownership over does, for the reader who confirms it. An owner who is not the
 * founder loses the owner's rights with it; the founder does in every project what its owner does,
 * so the founder who owns the project is told only that they stay a member.
 */
export function handOverDescription(reader: {
  founder: boolean;
  /** The reader is the owner of the project now. */
  owner: boolean;
  /** The project has an owner now. */
  projectHasOwner: boolean;
}): string {
  const becomes = 'Projenin sahibi bu kişi olur.';
  if (!reader.projectHasOwner) return becomes;
  if (!reader.owner) return `${becomes} Şimdiki sahip üye olarak kalır.`;
  if (reader.founder) return `${becomes} Siz üye olarak kalırsınız.`;
  return `${becomes} Siz üye olarak kalırsınız; üye ekleyip çıkaramaz, rol veremezsiniz. Sahipliği size yeni sahip ya da kurucu geri verebilir.`;
}

const byName = new Intl.Collator('tr');

/**
 * People by name in Turkish order (the API sorts by the database's collation, which is not the
 * Turkish alphabet); a person whose name could not be read comes last.
 */
export function sortedByName<T extends { userId: string; name: string | null }>(
  people: readonly T[],
): T[] {
  return people.toSorted((a, b) => {
    if (a.name === null || b.name === null) {
      if (a.name !== null) return -1;
      if (b.name !== null) return 1;
      return a.userId.localeCompare(b.userId);
    }
    return byName.compare(a.name, b.name) || a.userId.localeCompare(b.userId);
  });
}
