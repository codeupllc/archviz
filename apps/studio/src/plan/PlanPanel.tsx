import { useEffect, useRef, useState } from 'react';
import type { PlanOutcome, PlanStatus } from './usePlanRunner';

const STATUS_LABEL: Record<PlanStatus, string> = {
  idle: '',
  initializing: 'terraform init…',
  planning: 'terraform plan…',
  applying: 'LocalStack apply…',
  destroying: 'LocalStack destroy…',
  starting: 'starting LocalStack…',
  done: 'done',
  error: 'failed',
};

function outcomeClass(outcome: PlanOutcome | null): string {
  if (outcome === 'changes' || outcome === 'applied') return 'plan-panel__badge--changes';
  if (outcome === 'no-changes' || outcome === 'destroyed') return 'plan-panel__badge--ok';
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
  title?: string;
  /** Skip collapsible chrome when parent already provides expand/collapse. */
  embedded?: boolean;
  /** LocalStack ECS Swagger URL after Apply (API test path). */
  localstackSwaggerUrl?: string | null;
}) {
  const {
    status,
    log,
    outcome,
    summary,
    warnings,
    running,
    title = 'Plan',
    embedded = false,
    localstackSwaggerUrl = null,
  } = props;
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

  const swaggerLink =
    localstackSwaggerUrl && !running ? (
      <a
        className="plan-panel__swagger"
        href={localstackSwaggerUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        Open Swagger (LocalStack)
      </a>
    ) : null;

  if (embedded) {
    return (
      <div className="plan-panel plan-panel--embedded">
        {swaggerLink && <div className="plan-panel__actions">{swaggerLink}</div>}
        {warnings.length > 0 && (
          <ul className="plan-panel__warnings">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <pre ref={bodyRef} className="plan-panel__body">
          {log ||
            (outcome === 'error' && summary
              ? summary
              : running
                ? 'Waiting for output…'
                : 'No terraform output yet. Run Plan or Apply.')}
        </pre>
      </div>
    );
  }

  return (
    <div className="plan-panel">
      <div className="plan-panel__header-row">
        <button
          type="button"
          className="plan-panel__header"
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Collapse output' : 'Expand output'}
        >
          <span className="plan-panel__title">
            {title}
            {running && <span className="plan-panel__spinner" aria-hidden="true" />}
          </span>
          {outcome ? (
            <span className={`plan-panel__badge ${outcomeClass(outcome)}`}>{summary}</span>
          ) : (
            <span className="plan-panel__status">{STATUS_LABEL[status]}</span>
          )}
          <span className="plan-panel__chevron">{open ? '▾' : '▸'}</span>
        </button>
        {swaggerLink}
      </div>
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
