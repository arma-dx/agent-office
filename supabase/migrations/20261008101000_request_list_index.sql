-- An index for the order of the request list.
--
-- The list of requests is read by every open panel every half minute: the requests of the company
-- (kind = 'request'), the newest movement first (updated_at), cut at a limit. The one index made
-- for requests, tasks_requests (company_id, status, created_at desc), matches no query: nothing
-- filters requests by status or orders them by created_at. The list statement now picks its page
-- from the requests themselves before it reads anything else about them, and this index serves
-- that pick: the company, then the order of the list (updated_at desc, id).

drop index office.tasks_requests;
create index tasks_requests_by_movement on office.tasks (company_id, updated_at desc, id)
  where kind = 'request';
