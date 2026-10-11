import type { ProjectSummary } from '@agent-office/shared';

export interface ProjectOption {
  id: string;
  /** The project's own name, kept with a draft. */
  name: string;
  label: string;
  disabled: boolean;
  /**
   * Why it cannot be chosen: agents may not work in it (rule 12), or its AI spending limit is
   * reached (8 October decision 17). The form says who can change each. Null: it can be chosen.
   */
  held: 'permission' | 'limit' | null;
}

const byName = new Intl.Collator('tr');

/**
 * What the request form offers under "Proje": the open projects the person may read, by name. A
 * project where agents may not work (rule 12) is offered disabled, with the reason in its label,
 * so that nobody takes its absence for a mistake and sends the request without a project; so is a
 * project whose AI spending limit is reached (docs/SONRA.md P3-r). The permission is the reason
 * that is said when both hold. A closed project takes no request and is not offered. Two offered projects of one name are told apart by
 * their customer: the project of a request cannot be changed afterwards.
 */
export function projectOptions(projects: readonly ProjectSummary[]): ProjectOption[] {
  const open = projects.filter((project) => !project.closed);
  const count = new Map<string, number>();
  for (const project of open) count.set(project.name, (count.get(project.name) ?? 0) + 1);
  return open
    .toSorted((a, b) => byName.compare(a.name, b.name) || a.id.localeCompare(b.id))
    .map((project) => {
      const told =
        (count.get(project.name) ?? 0) > 1
          ? `${project.name} (${project.customer?.name ?? 'müşteri yok'})`
          : project.name;
      const held = !project.agentsMayWork
        ? ('permission' as const)
        : project.spendingLimitReached
          ? ('limit' as const)
          : null;
      const reason = { permission: 'ajanlar çalışamaz', limit: 'harcama sınırı doldu' } as const;
      return {
        id: project.id,
        name: project.name,
        label: held === null ? told : `${told} (${reason[held]})`,
        disabled: held !== null,
        held,
      };
    });
}
