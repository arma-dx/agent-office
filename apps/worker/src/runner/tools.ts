import { agentCodeSchema, unitCodeSchema } from '@agent-office/shared';
import { z } from 'zod';
import type { ModelTool } from '../model/client.ts';

/**
 * The tools of the first slice: one per agent, each the tool that ends its run. A card may name
 * more tools than the runner has a handler for (KOR-1 and SOS-2 name twelve between them); the
 * model is offered only the tools that are on the card AND defined here.
 *
 * Each tool has two descriptions of its input that must agree: the JSON schema the model is given
 * (strict: the provider keeps the model to it) and the zod schema the runner parses the input
 * with before the gate (the input is still what a model wrote). No input has a field for a
 * status, an approver or a requester: those are never the model's to write.
 *
 * The sentence that describes a tool to the model is written here, next to the input it speaks
 * of. The catalog's sentence (agents/tools.yaml) is the text for people: it names what the tool
 * will do one day (sources, a change diff) and the decisions it comes from, and the model is not
 * given it.
 */

export const ROUTE_TASK = 'route_task';
export const SUBMIT_FOR_APPROVAL = 'submit_for_approval';

/**
 * Text a model wrote that is about to be stored. PostgreSQL holds neither the NUL character nor a
 * lone surrogate; a text with one is refused here as invalid input, so that the database is never
 * asked to store it (its error would quote the text, and an error thrown out of a job ends up in
 * the queue's own tables, which no row policy guards: rule 10).
 */
const storable = (value: string): boolean => !value.includes('\u0000') && value.isWellFormed();
const NOT_STORABLE = { message: 'not_storable' };
const text = (max: number, min = 1): z.ZodType<string> =>
  z.string().trim().min(min).max(max).refine(storable, NOT_STORABLE);

// The limits below are told to the model in the tool descriptions, and a refused input says which
// field broke which limit: the JSON schema the provider enforces cannot carry them.
export const LIMITS = {
  reason: 600,
  title: 200,
  summary: 1000,
  rationale: 4000,
  riskNote: 2000,
  optionText: 5000,
  hashtag: 60,
  hashtags: 15,
} as const;

export const routeTaskInput = z
  .strictObject({
    // An empty text: the request fits no unit, or it cannot be told whose work it is. Nothing is
    // routed then and the request falls to the founder, who reads the reason. The coordinator is
    // made to answer through this tool (run.ts), so the tool itself must be able to say "none".
    unit_code: z.union([unitCodeSchema, z.literal('')]),
    // An empty text: no enabled agent of the unit can take the work; the request is then returned
    // to its requester and closed.
    agent_code: z.union([agentCodeSchema, z.literal('')]),
    reason: text(LIMITS.reason),
  })
  // No unit and still an agent says nothing the runner could act on.
  .refine((input) => input.unit_code !== '' || input.agent_code === '', {
    path: ['agent_code'],
    message: 'agent_without_unit',
  });
export type RouteTaskInput = z.output<typeof routeTaskInput>;

const optionSchema = z.strictObject({
  code: z.enum(['A', 'B', 'C']),
  text: text(LIMITS.optionText),
  hashtags: z.array(text(LIMITS.hashtag)).max(LIMITS.hashtags),
});

export const submitForApprovalInput = z
  .strictObject({
    title: text(LIMITS.title),
    summary: text(LIMITS.summary),
    rationale: text(LIMITS.rationale),
    // An empty text: nothing to flag.
    risk_note: text(LIMITS.riskNote, 0),
    options: z.array(optionSchema).min(2).max(3),
    // 5 October decision 2: the agent that submits must state both; unstated means no approval.
    involves_money: z.boolean(),
    goes_external: z.boolean(),
  })
  .refine(
    (input) => new Set(input.options.map((option) => option.code)).size === input.options.length,
    { path: ['options'], message: 'duplicate_code' },
  );
export type SubmitForApprovalInput = z.output<typeof submitForApprovalInput>;

/**
 * What was wrong with a refused input, for the model: the field and the limit it broke, as fixed
 * sentences made from the schema's own paths and numbers. Nothing of the input's text is repeated
 * (the result of a refused call is stored with the run).
 */
export function inputProblems(error: z.ZodError): string[] {
  return error.issues.slice(0, 6).map((issue) => {
    const field = issue.path.map(String).join('.') || 'girdi';
    switch (issue.code) {
      case 'too_big':
        return `${field}: en çok ${String(issue.maximum)} ${issue.origin === 'string' ? 'karakter' : 'öğe'} olabilir`;
      case 'too_small':
        return `${field}: en az ${String(issue.minimum)} ${issue.origin === 'string' ? 'karakter' : 'öğe'} olmalı`;
      case 'unrecognized_keys':
        return `${field}: tanımlı olmayan alan gönderildi`;
      case 'invalid_type':
        return `${field}: eksik ya da türü yanlış`;
      case 'custom':
        return issue.message === 'duplicate_code'
          ? `${field}: her seçeneğin kodu farklı olmalı`
          : issue.message === 'not_storable'
            ? `${field}: saklanamayan karakter içeriyor`
            : issue.message === 'agent_without_unit'
              ? `${field}: unit_code boşken bu alan da boş metin ("") olmalı; bir ajana vereceksen o ajanın biriminin kodunu da yaz`
              : `${field}: geçersiz değer`;
      default:
        return `${field}: geçersiz değer`;
    }
  });
}

const field = (description: string): { type: 'string'; description: string } => ({
  type: 'string',
  description,
});

const DEFINITIONS: Record<string, ModelTool> = {
  [ROUTE_TASK]: {
    name: ROUTE_TASK,
    description:
      'Talebi bir birime ve o birimin açık bir ajanına yönlendirir; birimin onaylayıcısını sen değil sistem belirler. Yalnızca bu çalışmanın kendi talebinde çalışır. Birimde işi alabilecek açık ajan yoksa ajan boş bırakılır; talep o zaman nedeni yazılarak talep sahibine geri çevrilir ve kapanır. Talep hiçbir birime oturmuyorsa ya da kimin işi olduğu anlaşılmıyorsa birim de ajan da boş bırakılır; talep o zaman yönlendirilmez ve kurucuya düşer. Çalışmayı bitiren araçtır; bir kez çağrılır.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        unit_code: field(
          'Talebin gideceği birimin kodu; units_and_agents bloğundaki kodlardan biri. Talep hiçbir birime oturmuyorsa ya da kimin işi olduğu anlaşılmıyorsa boş metin (""): talep o zaman yönlendirilmez ve kurucuya düşer.',
        ),
        agent_code: field(
          'O birimin işi yapabilecek açık ajanının kodu. Birimde uygun açık ajan yoksa boş metin (""): talep o zaman, birimde işi alabilecek açık ajan olmadığı yazılarak talep sahibine geri çevrilir ve kapanır. unit_code boşsa bu alan da boş metin olmalı.',
        ),
        reason: field(
          `Bu birimin neden seçildiğini anlatan bir iki cümle (en çok ${String(LIMITS.reason)} karakter). unit_code boşsa talebin hangi birimler arasında kaldığını ya da neden hiçbirine oturmadığını yaz. Kurucu okur; talep bir ajana verildiyse birimin onaylayıcısı da okur.`,
        ),
      },
      required: ['unit_code', 'agent_code', 'reason'],
      additionalProperties: false,
    },
  },
  [SUBMIT_FOR_APPROVAL]: {
    name: SUBMIT_FOR_APPROVAL,
    description:
      "Hazırladığın sonucu seçenekleri ve gerekçesiyle Onay Masası'na koyar. Metinde para geçip geçmediğini ve onaydan sonra bir kişi eliyle şirket dışına gönderilip gönderilmeyeceğini belirtmek zorunludur. Çalışmayı bitiren araçtır; bir kez çağrılır.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        title: field(
          `İçeriğin ne olduğunu söyleyen kısa başlık (en çok ${String(LIMITS.title)} karakter).`,
        ),
        summary: field(
          `Ne hazırladığının bir iki cümlelik özeti (en çok ${String(LIMITS.summary)} karakter).`,
        ),
        rationale: field(
          `Hangi bilgiyi nereden aldığın, neyi varsaydığın ve neyin eksik kaldığı (en çok ${String(LIMITS.rationale)} karakter).`,
        ),
        risk_note: field(
          `Onaylayanın bilmesi gereken risk (müşteri adı, doğrulanmamış bilgi; en çok ${String(LIMITS.riskNote)} karakter). Yoksa boş metin ("").`,
        ),
        options: {
          type: 'array',
          description:
            'En az iki, en çok üç seçenek; tek metin istenmiş olsa da iki seçenek sun. Her seçeneğin kodu farklıdır.',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', enum: ['A', 'B', 'C'] },
              text: field(
                `Seçeneğin tam metni (en çok ${String(LIMITS.optionText)} karakter); etiketler bu metnin içinde yer almaz.`,
              ),
              hashtags: {
                type: 'array',
                items: { type: 'string' },
                description: `Etiketler (en çok ${String(LIMITS.hashtags)}).`,
              },
            },
            required: ['code', 'text', 'hashtags'],
            additionalProperties: false,
          },
        },
        involves_money: {
          type: 'boolean',
          description:
            'Metinde para, fiyat ya da ödeme geçiyor mu. Geçiyorsa true; bu işaret onay kaydına "ajan belirtti" diye yazılır.',
        },
        goes_external: {
          type: 'boolean',
          description:
            'Onaydan sonra bir kişi eliyle şirket dışına gönderilecek ya da yayınlanacak mı.',
        },
      },
      required: [
        'title',
        'summary',
        'rationale',
        'risk_note',
        'options',
        'involves_money',
        'goes_external',
      ],
      additionalProperties: false,
    },
  },
};

/** The names of the tools the runner has a handler for. */
export const HANDLED_TOOLS: readonly string[] = Object.keys(DEFINITIONS);

/** The tool as the model is given it. */
export function modelTool(name: string): ModelTool | null {
  return DEFINITIONS[name] ?? null;
}
