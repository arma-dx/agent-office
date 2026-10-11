import { z } from 'zod';
import { agentCodeSchema } from './cards.ts';
import { usdSchema } from './projects.ts';
import { runStatusSchema } from './requests.ts';

/**
 * The sections of the project page that only read (8 October decision 17): the agent runs of a
 * project with their cost. What changes the project itself (its fields, its members, the budget,
 * the milestones) is in projects.ts.
 *
 * Nothing an agent wrote is in any answer here (docs/SONRA.md V-c): a row carries the title of
 * its request, which a person wrote, and times, codes and numbers.
 */

const instantSchema = z.iso.datetime({ offset: true });
const requestRefSchema = z.object({ id: z.uuid(), title: z.string() });
const agentRefSchema = z.object({ code: agentCodeSchema, name: z.string() });

/** Tokens and cost of one run or of all runs of a project. The founder's alone (SONRA P-t). */
export const runUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  costUsd: usdSchema,
});
export type RunUsage = z.output<typeof runUsageSchema>;

/**
 * One agent run of a project, for everybody who may read the project. No text of an agent and no
 * sentence about the work: the request's title, the agent, times and codes. `usage` is null for
 * a reader who is not the founder.
 */
export const projectRunSchema = z.object({
  id: z.uuid(),
  // Null: the run is not on a request (none exists today).
  request: requestRefSchema.nullable(),
  agent: agentRefSchema,
  status: runStatusSchema,
  errorCode: z.string().nullable(),
  startedAt: instantSchema,
  finishedAt: instantSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  usage: runUsageSchema.nullable(),
});
export type ProjectRun = z.output<typeof projectRunSchema>;

export const PROJECT_RUN_LIST_LIMIT = 200;

/** GET /api/projects/:projectId/runs: the newest runs, and totals over ALL runs of the project. */
export const projectRunsSchema = z.object({
  runs: z.array(projectRunSchema),
  truncated: z.boolean(),
  totals: z.object({
    runCount: z.number().int().nonnegative(),
    // Null for a reader who is not the founder.
    usage: runUsageSchema.nullable(),
  }),
  // The clock the durations of open runs are read on.
  serverTime: instantSchema,
});
export type ProjectRuns = z.output<typeof projectRunsSchema>;
