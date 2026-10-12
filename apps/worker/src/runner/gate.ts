import type { AuthorityLevel, ToolKind } from '@agent-office/shared';

/**
 * The gate every tool call passes before anything is executed (rule 4; CLAUDE.md, "Y1 kapısı kodla
 * uygulanır"). Pure: the card's authority level and tool list, the catalog's row for the tool, and
 * nothing the model wrote but the tool's name. The runner's own question is handled before it
 * (run.ts); every catalogue tool passes it.
 *
 *   refuse        the tool is not in the catalog or not on the card;
 *   to_approval   the call may not take effect by itself: every external effect; every call of a
 *                 tool whose catalog row has a written approval rule (whether the rule applies to
 *                 one call is decided with the tool; until then it always does); every shared
 *                 write (internal_write) of a Y0 or Y1 card;
 *   execute       reading; writing to the agent's own protected space (draft); a shared write of
 *                 a Y2 or Y3 card without a written rule.
 */
export interface CatalogTool {
  name: string;
  kind: ToolKind;
  approvalRule: string | null;
}

export type GateDecision =
  | { kind: 'execute' }
  | { kind: 'to_approval' }
  | { kind: 'refuse'; code: 'tool_not_in_catalog' | 'tool_not_on_card' };

export function gateToolCall(
  card: { level: AuthorityLevel; tools: readonly string[] },
  tool: CatalogTool | undefined,
  name: string,
): GateDecision {
  if (!tool || tool.name !== name) {
    return { kind: 'refuse', code: 'tool_not_in_catalog' };
  }
  if (!card.tools.includes(name)) {
    return { kind: 'refuse', code: 'tool_not_on_card' };
  }
  if (tool.kind === 'external_effect' || tool.approvalRule !== null) {
    return { kind: 'to_approval' };
  }
  if (tool.kind === 'internal_write' && (card.level === 'Y0' || card.level === 'Y1')) {
    return { kind: 'to_approval' };
  }
  return { kind: 'execute' };
}
