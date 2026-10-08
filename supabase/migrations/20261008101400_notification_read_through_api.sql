-- A notification is marked read through the API only (rule 9; KALAN-ISLER 0.4: a person's acts are
-- made with the API's role alone).
--
-- The read mark is a person's act: "Okundu" on the Bugün screen. Until now the column could be
-- written by every role of the application: with a context that held a person and no agent, the
-- worker's role, which carries no session of that person, could mark that person's notifications
-- read (and a closing notice would have gone quiet unread). No worker code builds such a context;
-- this is the database line that makes it impossible whatever the code does, as for an approval
-- decision and a membership change.
--
-- From here on the column privilege and the policy belong to the API-only group. The rule itself is
-- unchanged: the recipient, in the context company, never in an agent run.

drop policy recipient_marks_read on office.notifications;
revoke update (read_at) on office.notifications from office_app;
grant update (read_at) on office.notifications to office_api_private;
create policy recipient_marks_read on office.notifications for update to office_api_private
  using (
    company_id = office.ctx_company_id()
    and recipient_user_id = office.ctx_user_id()
    and office.ctx_agent_code() is null
  );
