-- Comments on a request are written by three people and read by people only
-- (8 October decision 13: "talebe talep sahibi, birimin onaylayıcısı ve kurucu yorum yazar; yorum
-- yalnızca insanlar içindir, ajan görmez").
--
-- office.task_comments exists since the tasks migration: rows are inserted and never changed or
-- deleted (the application has select and insert, nothing else), the author and the time come from
-- the context, the project comes from the task, and every new comment leaves the audit row
-- task_comment_added with ids only (task audit migration). Until now the table knew one rule for
-- every task: whoever reads the task reads its comments and writes one. That let every insider
-- of the company, an agent run and the worker's role in a person's name comment on a request, and
-- let an agent run read what people wrote there.
--
-- From here on, for a comment whose task is a request (kind = 'request'):
--   writing   only a person, through the API's role (office_api_private), and only one of three:
--             the requester, the founder, or the person appointed to approve the step that is
--             active now or, when no step is active, the step that was active last, while that
--             person holds the approval right (office.may_comment_on_request). Never an agent run,
--             never the worker's role whatever person its context names, never an external person.
--             On an open and on a closed request alike: a comment moves nothing of the request.
--   reading   whoever reads the request (the row rule of the table, unchanged), but only a
--             person's request made through the API's role: no agent run and no connection of the
--             worker reads a comment of a request, so no prompt, run fact or tool result can
--             carry one whatever a later tool does.
-- Comments of a task between people (kind = 'task') keep the rules they had.
--
-- The audit row stays what it was: task_comment_added on the request, who and when from the
-- context, never the text (2 October decision 13).
--
-- Nothing of the due date needs a migration: tasks.due_at exists, a request takes it when it is
-- opened, and office.check_task refuses every later change of a request by anybody but the flow,
-- whose role has no privilege on that column.

/*
 * May the context person write a comment on this request: its requester, the founder, or its
 * approver. The approver of a request, for a comment, is the person appointed for the step that
 * is active; when no step is active (the approved result waits for the requester, or the request
 * is closed) the step of the last routing that was active last: the one a close or a rejection
 * cancelled first in the order of work, otherwise the last one that was done. A returned step was
 * never worked on and names no approver. As everywhere, the appointed person counts only while
 * they hold the approval right.
 * Runs with the caller's rights: a request the caller cannot read answers false. Never true in an
 * agent run, for an external person or outside the context company.
 */
create function office.may_comment_on_request(p_task uuid) returns boolean
  language sql stable set search_path = ''
  as $$
    select coalesce((
      select office.ctx_agent_code() is null
        and office.is_insider()
        and (
          t.requester_user_id = office.ctx_user_id()
          or office.is_founder()
          or (
            office.can_approve()
            and office.ctx_user_id() = (
              select r.approver_user_id
              from office.task_routings r
              where r.task_id = t.id
                and r.status in ('active', 'done', 'cancelled')
                and r.round = (
                  select max(r2.round) from office.task_routings r2 where r2.task_id = t.id
                )
              order by (r.status = 'active') desc, (r.status = 'cancelled') desc,
                       case when r.status = 'cancelled' then r.seq else -r.seq end
              limit 1
            )
          )
        )
      from office.tasks t
      where t.id = p_task and t.kind = 'request' and t.company_id = office.ctx_company_id()
    ), false)
  $$;
revoke execute on function office.may_comment_on_request(uuid) from public;
grant execute on function office.may_comment_on_request(uuid) to office_app;

-- The task is read with the caller's rights. A comment passes untouched only when its task is
-- known to be a task between people. A task the caller cannot read is refused here, with the error
-- the project trigger gave for it before (23503): the rule leans neither on the order in which the
-- triggers of the table fire nor on what a later policy hides from whom.
create function office.check_task_comment() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_kind text;
begin
  if new.task_id is null then
    return new; -- refused by the column's own not-null rule, as before
  end if;
  select t.kind into v_kind from office.tasks t where t.id = new.task_id;
  if v_kind is null then
    raise exception 'task_comments.task_id linked record not found'
      using errcode = 'foreign_key_violation';
  end if;
  if v_kind = 'task' then
    return new;
  end if;
  if office.ctx_agent_code() is not null then
    raise exception 'An agent writes no comment on a request'
      using errcode = 'insufficient_privilege';
  end if;
  -- A person acts through the API (the API-only group is the line, as for opening a request).
  if not pg_catalog.pg_has_role(current_user, 'office_api_private', 'member') then
    raise exception 'A comment on a request is written through the API'
      using errcode = 'insufficient_privilege';
  end if;
  if not office.may_comment_on_request(new.task_id) then
    raise exception
      'Only the requester, the approver of the request or the founder comments on it'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger check_task_comment before insert on office.task_comments
  for each row execute function office.check_task_comment();

-- Narrows what the table's own policies show (tenant_isolation; external_reads). A founder or an
-- employee who asks through the API's role reads every comment those policies show. Everybody
-- else (an agent run, a connection of the worker whatever its context, an external person) reads
-- a comment only when its task is known to be a task between people. That branch reads the task
-- with the caller's rights and fails closed: a task the caller cannot read shows no comment, so a
-- later policy that hides requests from somebody (rule 12 for agent runs) cannot open their
-- comments to them.
create policy request_comments_for_people on office.task_comments
  as restrictive for select to office_app
  using (
    (
      office.ctx_agent_code() is null
      and office.is_insider()
      and pg_catalog.pg_has_role(current_user, 'office_api_private', 'member')
    )
    or exists (select 1 from office.tasks t where t.id = task_id and t.kind = 'task')
  );
