import { z } from 'zod';

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
