import type { ProjectDetail, ProjectMember } from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError, userMessage } from '@/lib/api';
import { useReturnFocus } from '@/lib/focus';
import { notifyError } from '@/lib/notify';
import { memberLine, sortedByName } from '@/lib/projects/labels';
import {
  addProjectMember,
  memberCandidatesKey,
  memberCandidatesQueryOptions,
  removeProjectMember,
} from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { personName } from '@/lib/requests/labels';
import { useCompany, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

function MemberRow({
  member,
  own,
  onRemove,
}: {
  member: ProjectMember;
  own: boolean;
  /** Asks to take the person off the project; absent where that is not offered. */
  onRemove?: () => void;
}) {
  const nameId = useId();
  const line = memberLine(member);
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      {/* A group named after the person, as the member rows of Kullanıcılar: a screen reader
          names the row before its one button. */}
      <div
        role="group"
        aria-labelledby={nameId}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="truncate text-sm font-medium">
            {personName(member)}
            {own ? ' (siz)' : ''}
          </span>
          {line ? <span className="text-sm text-ink-secondary">{line}</span> : null}
        </div>
        {onRemove ? (
          <Button variant="outline" onClick={onRemove}>
            Projeden çıkar
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Takes a person off the project after a plain confirmation: no passkey (5 October 2026,
 * decision 4). The row and its button go away with the person, so the focus goes to the heading
 * of the section; a confirmation that is given up returns it to the button.
 */
function RemoveMemberDialog({
  project,
  member,
  onClose,
  onCloseAutoFocus,
  heading,
}: {
  project: ProjectDetail;
  member: ProjectMember;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const company = useCompany();
  const store = useStoreProject(company.companyId);
  const removed = useRef(false);
  const name = personName(member);
  const remove = useMutation({
    mutationFn: () => removeProjectMember(company.companyId, project.id, member.userId),
    onSuccess: (updated) => {
      removed.current = true;
      store(updated);
      toast.success(`${name} projeden çıkarıldı.`);
      onClose();
    },
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !remove.isPending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (removed.current) {
            event.preventDefault();
            heading.current?.focus();
          } else {
            onCloseAutoFocus(event);
          }
        }}
      >
        <AlertDialogTitle>{name} projeden çıkarılsın mı?</AlertDialogTitle>
        <AlertDialogDescription>
          {member.role === 'founder'
            ? 'Kurucu, üye olmasa da bütün projeleri görür.'
            : 'Bu projeyi ve projeye bağlı kayıtları artık göremez. Gerekirse yeniden ekleyebilirsiniz.'}
        </AlertDialogDescription>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {userMessage(remove.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            autoFocus
            {...busyProps(remove.isPending)}
            onClick={(event) => {
              if (remove.isPending) event.preventDefault();
            }}
          >
            Vazgeç
          </AlertDialogCancel>
          <Button
            variant="destructive"
            size="lg"
            {...busyProps(remove.isPending)}
            onClick={() => {
              if (!remove.isPending) remove.mutate();
            }}
          >
            Projeden çıkar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Adds a founder or an employee of the company who is not a member yet. The people come from the
 * API (active founders and employees); the database refuses anybody else whoever is named.
 */
function AddMember({
  project,
  heading,
}: {
  project: ProjectDetail;
  /** Takes the focus when the last person was added and the controls go away. */
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const store = useStoreProject(company.companyId);
  const candidates = useQuery(memberCandidatesQueryOptions(company.companyId));
  const [chosen, setChosen] = useState('');
  const [missing, setMissing] = useState(false);
  const selectId = useId();
  const errorId = useId();

  const memberIds = new Set(project.members.map((member) => member.userId));
  const offered = sortedByName(candidates.data ?? []).filter(
    (person) => !memberIds.has(person.userId),
  );
  // A person who became a member meanwhile is no choice any more.
  const person = offered.find((candidate) => candidate.userId === chosen);

  const add = useMutation({
    mutationFn: (userId: string) => addProjectMember(company.companyId, project.id, userId),
    onSuccess: (updated, userId) => {
      store(updated);
      const added = updated.members.find((member) => member.userId === userId);
      toast.success(`${added ? personName(added) : 'Kişi'} projeye eklendi.`);
      setChosen('');
      const members = new Set(updated.members.map((member) => member.userId));
      if ((candidates.data ?? []).every((candidate) => members.has(candidate.userId))) {
        heading.current?.focus();
      }
    },
    onError: (error) => {
      notifyError(error);
      // The list the person chose from is stale: it is read again.
      if (error instanceof ApiError && error.code === 'member_not_allowed') {
        setChosen('');
        void queryClient.invalidateQueries({ queryKey: memberCandidatesKey(company.companyId) });
      }
    },
  });

  if (candidates.isError) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm">
          Kişi listesi alınamadı.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void candidates.refetch();
          }}
        >
          Yeniden dene
        </Button>
      </div>
    );
  }
  if (candidates.isSuccess && offered.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">
        Şirketteki bütün kurucu ve çalışanlar bu projenin üyesi.
      </p>
    );
  }

  const loading = candidates.isPending;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium">
        Eklenecek kişi
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={selectId}
          className="w-64"
          value={person ? chosen : ''}
          aria-invalid={missing}
          aria-describedby={missing ? errorId : undefined}
          {...busyProps(loading)}
          onChange={(event) => {
            setChosen(event.target.value);
            setMissing(false);
          }}
        >
          {loading ? (
            <option value="">Kişiler yükleniyor</option>
          ) : (
            <>
              <option value="">Kişi seçin</option>
              {offered.map((candidate) => (
                <option key={candidate.userId} value={candidate.userId}>
                  {candidate.name}
                  {candidate.role === 'founder' ? ', kurucu' : ''}
                </option>
              ))}
            </>
          )}
        </NativeSelect>
        <Button
          variant="outline"
          {...busyProps(!person || add.isPending)}
          onClick={() => {
            if (add.isPending || loading) return;
            if (!person) {
              setMissing(true);
              return;
            }
            add.mutate(person.userId);
          }}
        >
          Üye ekle
        </Button>
      </div>
      {missing ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          Önce bir kişi seçin.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The members of a project (8 October 2026, decision 15): the people who, with the founder, see
 * the project and the records tied to it. Who adds and who removes is the API's answer (decision
 * 44: the owner, the managers and the founder): the add form follows `actions.addMembers` and the
 * button of a row follows `member.removable`. Nothing is shown as changed before the API has
 * stored it.
 */
export function ProjectMembers({ project }: { project: ProjectDetail }) {
  const session = useSession();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const focus = useReturnFocus();
  const [removing, setRemoving] = useState<ProjectMember | null>(null);
  const members = sortedByName(project.members);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* The heading takes the focus when a row goes away with its button. */}
      <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[0.9375rem] font-semibold">
        Üyeler <span className="font-normal text-ink-secondary tabular-nums">{members.length}</span>
      </h3>
      {members.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          Bu projenin üyesi yok. Projeyi yalnızca kurucu görür.
        </p>
      ) : (
        <ul className="rounded-lg border border-line">
          {members.map((member) => {
            const own = member.userId === session.user.id;
            return (
              <MemberRow
                key={member.userId}
                member={member}
                own={own}
                {...(member.removable
                  ? {
                      onRemove: () => {
                        focus.remember();
                        setRemoving(member);
                      },
                    }
                  : {})}
              />
            );
          })}
        </ul>
      )}
      {project.actions.addMembers ? <AddMember project={project} heading={heading} /> : null}
      {removing ? (
        <RemoveMemberDialog
          project={project}
          member={removing}
          heading={heading}
          onClose={() => {
            setRemoving(null);
          }}
          onCloseAutoFocus={focus.onCloseAutoFocus}
        />
      ) : null}
    </section>
  );
}
