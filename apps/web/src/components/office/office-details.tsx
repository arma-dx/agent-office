import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type Ref } from 'react';
import { AgentWorkList } from '@/components/office/agent-work';
import { StopEverywhere } from '@/components/office/stop-everywhere';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { userMessage } from '@/lib/api';
import { useReturnFocus } from '@/lib/focus';
import { useOfficeDialog } from '@/lib/office/hold';
import { officeQueryOptions } from '@/lib/office/query';
import { setAgentSwitch } from '@/lib/requests/query';
import { useCompany } from '@/lib/session';
import { busyProps } from '@/lib/utils';
import {
  AGENT_NOT_READY_SENTENCE,
  AGENT_STATE_LABEL,
  AGENT_STATE_SENTENCE,
  agentId,
  isOpen,
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

/**
 * The founder's switch for one agent in this company (CLAUDE.md: every agent has a stop switch per
 * company). Opening lets the agent take the requests routed to it; stopping keeps it from taking
 * new work and ends its open run before the next step. Nothing is shown as changed before the API
 * has stored it.
 *
 * An agent whose card has no version to run with cannot be opened: the API refuses it. The panel
 * knows that from the office answer (`ready`), so it says so in a sentence and offers no button
 * that would ask "açılsın mı?" and then refuse. Stopping stays offered for an agent that is open.
 *
 * The confirmation gives the focus back to the button that opened it, also after a stored change
 * (the button stays, with its new label).
 */
function AgentSwitch({ agent }: { agent: OfficeAgent }) {
  if (!isOpen(agent.state) && !agent.ready) {
    return <p className="text-ink-secondary">{AGENT_NOT_READY_SENTENCE}</p>;
  }
  return <AgentSwitchButton agent={agent} />;
}

function AgentSwitchButton({ agent }: { agent: OfficeAgent }) {
  const company = useCompany();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // The dialog is opened from state and has no trigger: the focus goes back to the button here.
  const focus = useReturnFocus();
  // The office is not read again by itself under the open confirmation (lib/office/hold.ts).
  useOfficeDialog(confirming);
  const next = isOpen(agent.state) ? 'stopped' : 'enabled';
  const change = useMutation({
    mutationFn: () => setAgentSwitch(company.companyId, agent.code, next),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: officeQueryOptions(company.companyId).queryKey,
      });
      setConfirming(false);
    },
  });
  const label = isOpen(agent.state)
    ? 'Ajanı durdur'
    : agent.state === 'stopped'
      ? 'Ajanı yeniden aç'
      : 'Ajanı aç';
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          focus.remember();
          change.reset();
          setConfirming(true);
        }}
      >
        {label}
      </Button>
      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!change.isPending) setConfirming(open);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
          <AlertDialogTitle>
            {next === 'stopped'
              ? `${agent.code} bu şirkette durdurulsun mu?`
              : `${agent.code} bu şirkette açılsın mı?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {next === 'stopped'
              ? 'Yeni iş almaz; süren çalışması bir sonraki adımdan önce durur.'
              : 'Açık ajan kendisine yönlendirilen talepleri çalıştırır ve yapay zekâ modelini kullanır.'}
          </AlertDialogDescription>
          {change.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {userMessage(change.error)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              {...busyProps(change.isPending)}
              onClick={(event) => {
                if (change.isPending) event.preventDefault();
              }}
            >
              Vazgeç
            </AlertDialogCancel>
            <Button
              size="lg"
              {...busyProps(change.isPending)}
              onClick={() => {
                if (!change.isPending) change.mutate();
              }}
            >
              {label}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * An agent: its code, its unit (which can be chosen from here), its state, its open requests in
 * this company and, for the founder, the company's switch and "Her yerde durdur". Kurucu alanı has
 * no request, so no count is shown there.
 */
function AgentDetails({
  unit,
  agent,
  workTruncated,
  onSelect,
}: {
  unit: OfficeUnit;
  agent: OfficeAgent;
  workTruncated: boolean;
  onSelect: (id: string) => void;
}) {
  const company = useCompany();
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
      {company.kind === 'company' ? (
        <AgentWorkList work={agent.work} truncated={workTruncated} />
      ) : null}
      {company.role === 'founder' ? (
        <>
          <AgentSwitch agent={agent} />
          <StopEverywhere agent={agent} />
        </>
      ) : null}
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
  workTruncated = false,
  headingRef,
  onSelect,
  onClear,
}: {
  selection: OfficeSelection;
  /** The company has more open requests than the office answer looked at. */
  workTruncated?: boolean;
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
        <AgentDetails
          unit={selection.unit}
          agent={selection.agent}
          workTruncated={workTruncated}
          onSelect={onSelect}
        />
      )}
      <Button type="button" variant="outline" className="self-start" onClick={onClear}>
        Seçimi kaldır
      </Button>
    </div>
  );
}
