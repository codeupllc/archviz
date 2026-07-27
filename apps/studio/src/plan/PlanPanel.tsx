import { useEffect, useRef, useState } from 'react';
import type { PlanOutcome, PlanStatus } from './usePlanRunner';

const STATUS_LABEL: Record<PlanStatus, string> = {
  idle: '',
  initializing: 'terraform init…',
  planning: 'terraform plan…',
  done: 'done',
  error: 'failed',
};

function outcomeClass(outcome: PlanOutcome | null): string {
  if (outcome === 'changes') return 'plan-panel__badge--changes';
  if (outcome === 'no-changes') return 'plan-panel__badge--ok';
  if (outcome === 'error') return 'plan-panel__badge--error';
  return '';
}

export function PlanPanel(props: {
  status: PlanStatus;
  log: string;
  outcome: PlanOutcome | null;
  summary: string | null;
  warnings: string[];
  running: boolean;
}) {
  const { status, log, outcome, summary, warnings, running } = props;
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (running) setOpen(true);
  }, [running]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (status === 'idle') return null;

  return (
    <div className="plan-panel">
      <button
        type="button"
        className="plan-panel__header"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Collapse plan output' : 'Expand plan output'}
      >
        <span className="plan-panel__title">
          Plan
          {running && <span className="plan-panel__spinner" aria-hidden="true" />}
        </span>
        {outcome ? (
          <span className={`plan-panel__badge ${outcomeClass(outcome)}`}>{summary}</span>
        ) : (
          <span className="plan-panel__status">{STATUS_LABEL[status]}</span>
        )}
        <span className="plan-panel__chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && warnings.length > 0 && (
        <ul className="plan-panel__warnings">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {open && (
        <pre ref={bodyRef} className="plan-panel__body">
          {log || 'Waiting for output…'}
        </pre>
      )}
    </div>
  );
}
