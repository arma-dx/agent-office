import { restartWaitingWork, type AgentRunSender, type Queryable } from '@agent-office/db';

/**
 * Starts the waiting work again after the founder opened an agent or an AI permission (8 October
 * decision 49). The database says which requests (office.restart_waiting_work) and has written
 * its trace on each; here one job per request is put on the queue, in the caller's transaction:
 * the opening, the traces and the jobs are stored together or not at all. A job carries ids only
 * (rule 10): the company, the request, the agent and the requester. In whose name the run goes
 * is resolved by the database when the run opens (decision 45). Returns how many were started.
 */
export async function startWaitingWork(
  client: Queryable,
  jobs: AgentRunSender,
  companyId: string,
  scope: Parameters<typeof restartWaitingWork>[1],
): Promise<number> {
  const work = await restartWaitingWork(client, scope);
  for (const row of work) {
    await jobs.send(client, {
      companyId,
      userId: row.requester_user_id,
      taskId: row.task_id,
      agentCode: row.agent_code,
    });
  }
  return work.length;
}
