-- An index for the requests that are still open.
--
-- The Bugün screen and the counts of the sidebar ask, every half minute from every open panel, for
-- the open requests of the company that may wait for the reader (kind = 'request', status neither
-- done nor cancelled), the one that has not moved for longest first. The indexes of the request
-- list (tasks_requests_by_movement, tasks_requests_of_requester) hold every request the company
-- ever had, newest first: read from the other end, the pick would walk the closed requests of
-- every past month, evaluating the row policy for each, before it reached the open ones. This
-- index holds the open requests alone, in the order of the pick: the company, then updated_at, id.

create index tasks_requests_open on office.tasks (company_id, updated_at, id)
  where kind = 'request' and status not in ('done', 'cancelled');
