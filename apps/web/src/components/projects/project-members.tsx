import type { ProjectDetail, ProjectMember } from '@agent-office/shared';
import { useId } from 'react';
import { memberLine, sortedByName } from '@/lib/projects/labels';
import { personName } from '@/lib/requests/labels';
import { useSession } from '@/lib/session';

function MemberRow({ member, own }: { member: ProjectMember; own: boolean }) {
  const nameId = useId();
  const line = memberLine(member);
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      {/* A group named after the person, as the member rows of Kullanıcılar. */}
      <div role="group" aria-labelledby={nameId} className="flex min-w-0 flex-col">
        <span id={nameId} className="truncate text-sm font-medium">
          {personName(member)}
          {own ? ' (siz)' : ''}
        </span>
        {line ? <span className="text-sm text-ink-secondary">{line}</span> : null}
      </div>
    </li>
  );
}

/**
 * The members of a project (8 October 2026, decision 15): the people who, with the founder, see
 * the project and the records tied to it.
 */
export function ProjectMembers({ project }: { project: ProjectDetail }) {
  const session = useSession();
  const headingId = useId();
  const members = sortedByName(project.members);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-[0.9375rem] font-semibold">
        Üyeler <span className="font-normal text-ink-secondary tabular-nums">{members.length}</span>
      </h3>
      {members.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          Bu projenin üyesi yok. Projeyi yalnızca kurucu görür.
        </p>
      ) : (
        <ul className="rounded-lg border border-line">
          {members.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              own={member.userId === session.user.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
