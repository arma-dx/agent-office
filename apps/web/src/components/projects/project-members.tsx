import type { ProjectDetail, ProjectMember, ProjectMemberRole } from '@agent-office/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NativeSelect } from '@/components/ui/native-select';
import { ApiError, userMessage } from '@/lib/api';
import { useReturnFocus } from '@/lib/focus';
import { notifyError } from '@/lib/notify';
import {
  handOverDescription,
  memberLine,
  MEMBERS_TEXT,
  ROLE_ACT,
  ROLE_ACT_ORDER,
  roleGivenSentence,
  sortedByName,
} from '@/lib/projects/labels';
import {
  addProjectMember,
  memberCandidatesKey,
  memberCandidatesQueryOptions,
  removeProjectMember,
  setProjectMemberRole,
} from '@/lib/projects/query';
import { useStoreProject } from '@/lib/projects/store';
import { personName } from '@/lib/requests/labels';
import { useCompany, useSession } from '@/lib/session';
import { busyProps } from '@/lib/utils';

/**
 * The role control of a row: a menu of acts, not a select (8 October 2026, decision 44). A closed
 * select changes its value with every arrow key on some systems, so a person going from "Üye" to
 * "Sahip" by keyboard would make somebody a manager on the way. Here nothing is given by moving:
 * an item is chosen with Enter, and each says what it does. The member's present role is no item;
 * it is the line under the name.
 *
 * The menu goes away when no role is left to give (a deactivated manager who was dismissed), and
 * its button may hold the focus just then: the focus is handed on to the heading of the section,
 * or the keyboard would start again from the top of the page.
 */
function RoleMenu({
  member,
  busy,
  onGive,
  onHandOver,
  heading,
}: {
  member: ProjectMember;
  /** A change of this row is on its way: the menu opens nothing. */
  busy: boolean;
  /** Appoints or dismisses a manager at once; one more choice takes it back. */
  onGive: (role: ProjectMemberRole) => void;
  /** Asks first; gets the menu button, which takes the focus if the hand-over is given up. */
  onHandOver: (trigger: HTMLElement | null) => void;
  /** Takes the focus when the menu button goes away while it holds it. */
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A layout effect: its cleanup runs while the button is still in the page, so whether the
  // button holds the focus can still be asked. (Moving the focus when the answer arrives is too
  // early: the closing menu returns it to the button afterwards.) The heading stands before the
  // list and stays as long as the section does, so it is there when a menu is first shown.
  useLayoutEffect(() => {
    const button = trigger.current;
    const next = heading.current;
    return () => {
      if (button !== null && document.activeElement === button) next?.focus();
    };
  }, [heading]);
  // The confirmation of a hand-over takes the focus itself; the closing menu must not pull it back
  // to its button first.
  const confirming = useRef(false);
  const offered = ROLE_ACT_ORDER.filter((role) => member.roleChanges.includes(role));
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next || !busy) setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="outline" {...busyProps(busy)}>
          Rolü değiştir
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onCloseAutoFocus={(event) => {
          if (confirming.current) {
            confirming.current = false;
            event.preventDefault();
          }
        }}
      >
        {offered.map((role) => (
          <DropdownMenuItem
            key={role}
            onSelect={() => {
              if (role === 'owner') {
                confirming.current = true;
                onHandOver(trigger.current);
              } else {
                onGive(role);
              }
            }}
          >
            {ROLE_ACT[role]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MemberRow({
  project,
  member,
  own,
  onRemove,
  onHandOver,
  heading,
}: {
  project: ProjectDetail;
  member: ProjectMember;
  own: boolean;
  /** Asks to take the person off the project; absent where that is not offered. */
  onRemove?: () => void;
  /** Asks to hand the ownership over to this member. */
  onHandOver: (trigger: HTMLElement | null) => void;
  /** The heading of the section: takes the focus when the row's role menu goes away. */
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const company = useCompany();
  const store = useStoreProject(company.companyId);
  const nameId = useId();
  const name = personName(member);
  // Appointing and dismissing a manager: sent at once, and shown only when the API has stored it.
  const give = useMutation({
    mutationFn: (role: ProjectMemberRole) =>
      setProjectMemberRole(company.companyId, project.id, member.userId, role),
    onSuccess: (updated, role) => {
      store(updated);
      toast.success(roleGivenSentence(role, name));
    },
    onError: notifyError,
  });
  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      {/* A group named after the person, as the member rows of Kullanıcılar: a screen reader
          names the row before its buttons. */}
      <div
        role="group"
        aria-labelledby={nameId}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="truncate text-sm font-medium">
            {name}
            {own ? ' (siz)' : ''}
          </span>
          <span className="text-sm text-ink-secondary">{memberLine(member)}</span>
        </div>
        {member.roleChanges.length > 0 || onRemove ? (
          <div className="flex shrink-0 items-center gap-2">
            {/* A member whose role the reader cannot change has no menu: the role is the text
                under the name. */}
            {member.roleChanges.length > 0 ? (
              <RoleMenu
                member={member}
                busy={give.isPending}
                onGive={(role) => {
                  if (!give.isPending) give.mutate(role);
                }}
                onHandOver={onHandOver}
                heading={heading}
              />
            ) : null}
            {onRemove ? (
              <Button variant="outline" onClick={onRemove}>
                Projeden çıkar
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Hands the ownership of the project over to a member after a plain confirmation: no passkey (5
 * October 2026, decision 4). The owner until now becomes a plain member, so the reader's own
 * controls may be gone afterwards: the focus then goes to the heading of the section. A
 * confirmation that is given up returns it to the menu button of the row (the menu item that
 * opened the confirmation is gone by then).
 */
function HandOverDialog({
  project,
  member,
  description,
  trigger,
  onClose,
  heading,
}: {
  project: ProjectDetail;
  member: ProjectMember;
  /** What the hand-over does, as the page stood when it was asked. */
  description: string;
  trigger: HTMLElement | null;
  onClose: () => void;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const company = useCompany();
  const store = useStoreProject(company.companyId);
  const handed = useRef(false);
  const name = personName(member);
  const handOver = useMutation({
    mutationFn: () => setProjectMemberRole(company.companyId, project.id, member.userId, 'owner'),
    onSuccess: (updated) => {
      handed.current = true;
      store(updated);
      toast.success(roleGivenSentence('owner', name));
      onClose();
    },
  });
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !handOver.isPending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (handed.current) heading.current?.focus();
          else if (trigger?.isConnected) trigger.focus();
        }}
      >
        <AlertDialogTitle>Sahiplik {name} adlı üyeye devredilsin mi?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {handOver.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {userMessage(handOver.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel
            autoFocus
            {...busyProps(handOver.isPending)}
            onClick={(event) => {
              if (handOver.isPending) event.preventDefault();
            }}
          >
            Vazgeç
          </AlertDialogCancel>
          <Button
            variant="default"
            size="lg"
            {...busyProps(handOver.isPending)}
            onClick={() => {
              if (!handOver.isPending) handOver.mutate();
            }}
          >
            Sahipliği devret
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
 * the project and the records tied to it. Each has one of three roles (decision 44): the owner,
 * a manager, a member. Who adds, who removes and who gives a role is the API's answer: the add
 * form follows `actions.addMembers`, the button of a row `member.removable` and the role menu of
 * a row `member.roleChanges`. Nothing is shown as changed before the API has stored it. A row
 * without a button does not explain itself, so one sentence under the list says who can act.
 */
export function ProjectMembers({ project }: { project: ProjectDetail }) {
  const session = useSession();
  const company = useCompany();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const focus = useReturnFocus();
  const [removing, setRemoving] = useState<ProjectMember | null>(null);
  const [handingOver, setHandingOver] = useState<{
    member: ProjectMember;
    description: string;
    trigger: HTMLElement | null;
  } | null>(null);
  const members = sortedByName(project.members);
  const founder = company.role === 'founder';
  const reader = members.find((member) => member.userId === session.user.id);
  const hasOwner = members.some((member) => member.projectRole === 'owner');
  const readerOwns = reader?.projectRole === 'owner';
  // At most one hint: the hand-over for who gives roles, who removes a manager for a manager.
  // The hand-over's menu is named only when a row has it with that act in it.
  const handOverOffered = members.some((member) => member.roleChanges.includes('owner'));
  let hint: string | null = null;
  if ((founder || readerOwns) && hasOwner) {
    hint = handOverOffered ? MEMBERS_TEXT.handOverHint : MEMBERS_TEXT.ownerStaysHint;
  } else if (!founder && reader?.projectRole === 'manager') hint = MEMBERS_TEXT.managerHint;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* The heading takes the focus when a row's controls go away. */}
      <h3 id={headingId} ref={heading} tabIndex={-1} className="text-[0.9375rem] font-semibold">
        Üyeler <span className="font-normal text-ink-secondary tabular-nums">{members.length}</span>
      </h3>
      {members.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          Bu projenin üyesi yok. Projeyi yalnızca kurucu görür.
        </p>
      ) : (
        <>
          {hasOwner ? null : (
            <p className="text-sm text-ink-secondary">
              {founder ? MEMBERS_TEXT.noOwnerForFounder : MEMBERS_TEXT.noOwner}
            </p>
          )}
          <ul className="rounded-lg border border-line">
            {members.map((member) => {
              const own = member.userId === session.user.id;
              return (
                <MemberRow
                  key={member.userId}
                  project={project}
                  member={member}
                  own={own}
                  heading={heading}
                  onHandOver={(trigger) => {
                    setHandingOver({
                      member,
                      trigger,
                      description: handOverDescription({
                        founder,
                        owner: readerOwns,
                        projectHasOwner: hasOwner,
                      }),
                    });
                  }}
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
          {hint ? <p className="text-sm text-ink-secondary">{hint}</p> : null}
        </>
      )}
      {project.actions.addMembers ? (
        <AddMember project={project} heading={heading} />
      ) : (
        <p className="text-sm text-ink-secondary">{MEMBERS_TEXT.whoManages}</p>
      )}
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
      {handingOver ? (
        <HandOverDialog
          project={project}
          member={handingOver.member}
          description={handingOver.description}
          trigger={handingOver.trigger}
          heading={heading}
          onClose={() => {
            setHandingOver(null);
          }}
        />
      ) : null}
    </section>
  );
}
