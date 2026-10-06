import { useId, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import {
  AGENT_STATE_LABEL,
  AGENT_STATE_SENTENCE,
  agentId,
  unitId,
  type OfficeAgent,
  type OfficeSelection,
  type OfficeUnit,
} from '@/lib/office/model';

// The names take a fixed column, so the values start at the same place for a unit and for an agent.
const FIELDS = 'grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-2';
const FIELD_NAME = 'text-ink-secondary';

/** A unit: its code, how many agents it has, and the agents; each agent can be chosen from here. */
function UnitDetails({ unit, onSelect }: { unit: OfficeUnit; onSelect: (id: string) => void }) {
  const agentsHeading = useId();
  return (
    <>
      <dl className={FIELDS}>
        <dt className={FIELD_NAME}>Kod</dt>
        <dd>{unit.code}</dd>
        <dt className={FIELD_NAME}>Ajan sayısı</dt>
        <dd className="tabular-nums">{unit.agents.length}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <h4 id={agentsHeading} className="font-medium">
          Ajanlar
        </h4>
        {/* Pulled out by the padding of a row: the text of the rows lines up with the heading. */}
        <ul role="list" aria-labelledby={agentsHeading} className="-mx-2 flex flex-col">
          {unit.agents.map((agent) => (
            <li key={agent.code}>
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-row-hover"
                // One name, as on the label in the scene; the unit is the heading of this panel.
                aria-label={`${agent.code} ${agent.name}, ${AGENT_STATE_LABEL[agent.state]}`}
                onClick={() => {
                  onSelect(agentId(agent.code));
                }}
              >
                <span>
                  <span className="font-semibold tabular-nums">{agent.code}</span> {agent.name}
                </span>
                <span className="text-xs text-ink-secondary">{AGENT_STATE_LABEL[agent.state]}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

/** An agent: its code, its unit (which can be chosen from here) and the company's switch for it. */
function AgentDetails({
  unit,
  agent,
  onSelect,
}: {
  unit: OfficeUnit;
  agent: OfficeAgent;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <dl className={FIELDS}>
        <dt className={FIELD_NAME}>Kod</dt>
        <dd className="tabular-nums">{agent.code}</dd>
        <dt className={FIELD_NAME}>Birim</dt>
        <dd>
          <button
            type="button"
            className="text-left font-medium text-brand underline underline-offset-4"
            onClick={() => {
              onSelect(unitId(unit.code));
            }}
          >
            {unit.name}
          </button>
        </dd>
        <dt className={FIELD_NAME}>Durum</dt>
        <dd>{AGENT_STATE_LABEL[agent.state]}</dd>
      </dl>
      <p className="text-ink-secondary">{AGENT_STATE_SENTENCE[agent.state]}</p>
    </>
  );
}

/**
 * The selected unit or agent, for the properties panel: what the label, the card and the legend
 * say in the scene, in one place, and nothing the office does not know. The heading can take the
 * focus: a choice made in here removes the button that was pressed.
 */
export function OfficeDetails({
  selection,
  headingRef,
  onSelect,
  onClear,
}: {
  selection: OfficeSelection;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Another unit or agent was chosen from this content. */
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <h3 ref={headingRef} tabIndex={-1} className="text-[0.9375rem] font-semibold">
        {selection.kind === 'unit' ? selection.unit.name : selection.agent.name}
      </h3>
      {selection.kind === 'unit' ? (
        <UnitDetails unit={selection.unit} onSelect={onSelect} />
      ) : (
        <AgentDetails unit={selection.unit} agent={selection.agent} onSelect={onSelect} />
      )}
      <Button type="button" variant="outline" className="self-start" onClick={onClear}>
        Seçimi kaldır
      </Button>
    </div>
  );
}
