import { z } from 'zod';
import { modelProfileSchema } from './models.ts';

/**
 * Codes and file shapes of the unit catalog (agents/units.yaml) and the agent cards
 * (agents/<code>.yaml). Schemas only: reading the files is the job of the definitions sync in
 * packages/db. The three code patterns are the database's own check constraints
 * (supabase/migrations/20261003100100_global_and_identity.sql).
 */

export const unitCodeSchema = z.string().regex(/^[A-Z]{1,3}(-[A-Z]{2,4})?$/);
export const agentCodeSchema = z.string().regex(/^[A-Z]{1,3}(-[A-Z]{2,4})?-[0-9]+$/);
export const companyCodeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** agents/units.yaml */
export const unitsFileSchema = z.strictObject({
  units: z
    .array(
      z.strictObject({
        code: unitCodeSchema,
        name: z.string().trim().min(1),
        // Absent: a unit every company has. Set: that company's short code.
        company: companyCodeSchema.optional(),
        pilot_enabled: z.boolean(),
      }),
    )
    .min(1),
});
export type UnitsFile = z.output<typeof unitsFileSchema>;

/**
 * The fields of a card (agents/<code>.yaml) that the definitions sync writes. The rest of the card
 * passes through: the full card schema belongs to the runner (KALAN-ISLER 1.1).
 */
export const cardDefinitionSchema = z.looseObject({
  code: agentCodeSchema,
  name: z.string().trim().min(1),
  unit: unitCodeSchema,
  companies: z.array(companyCodeSchema).min(1),
});
export type CardDefinition = z.output<typeof cardDefinitionSchema>;

// The full card ------------------------------------------------------------------------------------

export const authorityLevelSchema = z.enum(['Y0', 'Y1', 'Y2', 'Y3']);
export type AuthorityLevel = z.output<typeof authorityLevelSchema>;

/**
 * What a card's status means for a run:
 *   draft   no run: the card is still being written;
 *   trial   runs only for requests the founder wrote;
 *   active  runs for every founder and employee of the company.
 * No card is on trial now: the first cards are active, so the agents work for everybody's requests
 * from the first runs on (8 October decision 1). The status stays as a rule the API's door and the
 * runner hold; whether a later agent uses it is the founder's decision.
 * The switch that opens an agent for a company is separate (company_agents); both must allow it.
 */
export const cardStatusSchema = z.enum(['draft', 'trial', 'active']);
export type CardStatus = z.output<typeof cardStatusSchema>;

/**
 * Names the runner keeps for its own paths (CLAUDE.md "İnsana sor"): never a row of the catalog
 * and never on a card. `ask_requester` is the runner's tool for a question to the requester of
 * a request; the runner offers it by itself and it never passes the gate of catalog tools.
 */
export const RUNNER_PATH_TOOLS: readonly string[] = ['ask_requester'];

export const toolNameSchema = z
  .string()
  .regex(/^[a-z][a-z_]*$/)
  .refine((name) => !RUNNER_PATH_TOOLS.includes(name), {
    message: 'This name is reserved for the runner and cannot be a catalog tool',
  });
export const skillNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const toolKindSchema = z.enum(['read', 'draft', 'internal_write', 'external_effect']);
export type ToolKind = z.output<typeof toolKindSchema>;

const line = z.string().trim().min(1);

/**
 * One item of a list of sentences. YAML reads an unquoted item with a colon in it ("İç rapor:
 * durum, riskler") as a mapping with one key; the cards are written that way, so such an item is
 * read back as the sentence it was meant to be.
 */
const item = z.union([line, z.record(z.string().min(1), line)]).transform((value, ctx) => {
  if (typeof value === 'string') {
    return value;
  }
  const entries = Object.entries(value);
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Must be one sentence' });
    return z.NEVER;
  }
  return `${entry[0]}: ${entry[1]}`;
});

/**
 * agents/<code>.yaml, every field. Strict: a key the schema does not know stops the sync, so a
 * typo in "prohibitions" can never silently drop a rule. The sync and the runner parse with this
 * one schema.
 */
export const cardSchema = z.strictObject({
  code: agentCodeSchema,
  name: line,
  unit: unitCodeSchema,
  companies: z.array(companyCodeSchema).min(1),
  version: line,
  status: cardStatusSchema,
  owner: line,
  purpose: line,
  triggers: z
    .array(
      z.strictObject({
        type: z.enum(['request', 'scheduled', 'event', 'handoff']),
        description: line,
        schedule: line.optional(),
      }),
    )
    .min(1),
  inputs: z.array(item),
  outputs: z.array(item).min(1),
  skills: z.array(skillNameSchema),
  tools: z.array(toolNameSchema).min(1),
  knowledge_sources: z.array(item),
  // `level` is what the runner applies. A card may name a lower level for one kind of output
  // (customer_report: Y1); those are kept and not applied until the per output levels are decided
  // (docs/SONRA.md M19).
  authority: z
    .object({ level: authorityLevelSchema, target: authorityLevelSchema })
    .catchall(authorityLevelSchema),
  approval_points: z.array(item),
  escalation: z.array(item),
  prohibitions: z.array(item),
  model: line,
  model_hard: line.optional(),
  limits: z.strictObject({
    tool_calls: z.number().int().min(1).max(100),
    duration_minutes: z.number().int().min(1).max(60),
  }),
  metrics: z.array(item),
  project_context: z.enum(['required', 'if_available', 'per_project']).optional(),
  // The agent's output is sent outside the company by a person after it is approved (5 October
  // decision 2 names the social media post). The approval then always states "goes outside",
  // whatever the model stated: the passkey of an important approval cannot be talked away.
  output_goes_external: z.boolean().optional(),
  // Does the agent's output involve money, prices or a payment. The approval's money mark comes
  // from here, never from the model's word alone (the rule of the step-up migration): the model
  // may raise it for one output and can never lower it. A card that says nothing gets the safe
  // side: its results are opened as involving money, so approving them asks for the passkey.
  output_involves_money: z.boolean().optional(),
});
export type Card = z.output<typeof cardSchema>;

/** One row of the tool catalog. */
export const catalogToolSchema = z.strictObject({
  name: toolNameSchema,
  kind: toolKindSchema,
  description: line,
  approval_rule: line.optional(),
});
export type CatalogToolRow = z.output<typeof catalogToolSchema>;

/** agents/tools.yaml */
export const toolsFileSchema = z.strictObject({
  tools: z.array(catalogToolSchema).min(1),
});
export type ToolsFile = z.output<typeof toolsFileSchema>;

/**
 * What a card version holds (card_versions.content): everything of the repository's files a run
 * of this card is decided by, so that a run points at exactly what it ran with and the worker
 * reads no file of the repository at run time:
 *   - the common rules, the card and the text of every skill it names (the instructions);
 *   - the catalog rows of the card's own tools: the kind and the approval rule are what the gate
 *     decides a tool call with;
 *   - the profile of the card's model: how it is called and what it costs.
 * A change of any of them writes a new version for the cards it touches. What lives in code is
 * not here: the input schema and the model-facing sentence of a tool the runner has a handler for.
 */
export const storedCardSchema = z.strictObject({
  card: cardSchema,
  // agents/tools.yaml: the rows of the tools the card names, in the card's order.
  tools: z.array(catalogToolSchema),
  // agents/models.yaml: the row of card.model.
  model: modelProfileSchema,
  // agents/common-rules.md: the rules every agent gets before its card.
  rules: z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), body: z.string().min(1) }),
  skills: z.array(
    z.strictObject({
      name: skillNameSchema,
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      body: z.string().min(1),
    }),
  ),
});
export type StoredCard = z.output<typeof storedCardSchema>;
