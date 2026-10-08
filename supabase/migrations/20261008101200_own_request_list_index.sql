-- An index for the list of a person's own requests.
--
-- The request list has two variants: every request the person may see, and their own
-- (GET /api/requests?mine=true, which the Talepler screen reads every half minute while its "own"
-- tab is open). The index of the previous round, tasks_requests_by_movement (company_id,
-- updated_at desc, id), serves the first one only: it has no requester column, so the pick of a
-- page of own requests walked every request of the company, evaluating the row policy for each,
-- until it had found 201 of the person's own; for a person with fewer own requests that is every
-- request the company has. This index serves that pick: the company, the requester, then the
-- order of the list (updated_at desc, id).

create index tasks_requests_of_requester
  on office.tasks (company_id, requester_user_id, updated_at desc, id)
  where kind = 'request';
