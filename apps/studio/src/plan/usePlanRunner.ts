import { useCallback, useEffect, useRef, useState } from 'react';

/** Mirrors the NDJSON events emitted by @archviz/runner's /api/plan. */
type RunnerEvent =
  | { type: 'workspace'; dir: string }
  | { type: 'phase'; phase: 'write' | 'init' | 'plan' }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'info'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'exit'; code: number; ok: boolean; changes: boolean | null }
  | { type: 'error'; message: string };

export interface PlanRequestOptions {
  /** Current diagram identity — the runner plans each diagram in its own workspace subfolder. */
  project?: { id?: string; name: string };
  /** Variables without defaults; the runner seeds terraform.tfvars placeholders for them. */
  requiredVariables?: string[];
}

export type PlanStatus = 'idle' | 'initializing' | 'planning' | 'done' | 'error';
export type PlanOutcome = 'changes' | 'no-changes' | 'error';

export interface PlanRunnerState {
  /** Whether the local archviz-runner responded to a recent health check. */
  connected: boolean;
  /** The directory the runner executes terraform in (from health). */
  runnerDir: string | null;
  /** null when the runner can't find a terraform binary. */
  terraformVersion: string | null;
  status: PlanStatus;
  log: string;
  outcome: PlanOutcome | null;
  /** Human summary, e.g. "Plan: 1 to add, 0 to change, 0 to destroy." */
  summary: string | null;
  /** Runner-side warnings (placeholder tfvars created, workspace mismatch, ...). */
  warnings: string[];
}

const RUNNER_URL_KEY = 'archviz:runner-url:v1';
const DEFAULT_RUNNER_URL = 'http://127.0.0.1:4180';
const HEALTH_POLL_MS = 5000;

export function getRunnerUrl(): string {
  try {
    return window.localStorage.getItem(RUNNER_URL_KEY) ?? DEFAULT_RUNNER_URL;
  } catch {
    return DEFAULT_RUNNER_URL;
  }
}

function extractSummary(log: string): string | null {
  const lines = log.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('Plan:') || line.startsWith('No changes.')) return line;
  }
  return null;
}

/**
 * Talks to the local archviz-runner companion: polls /api/health for a
 * connected indicator and streams `terraform plan` output from /api/plan.
 */
export function usePlanRunner() {
  const [connected, setConnected] = useState(false);
  const [runnerDir, setRunnerDir] = useState<string | null>(null);
  const [terraformVersion, setTerraformVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<PlanStatus>('idle');
  const [log, setLog] = useState('');
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const runningRef = useRef(false);
  const logRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${getRunnerUrl()}/api/health`, { signal: controller.signal });
        clearTimeout(timer);
        if (cancelled) return;
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = (await res.json()) as { cwd: string; terraform: string | null };
        if (cancelled) return;
        setConnected(true);
        setRunnerDir(body.cwd);
        setTerraformVersion(body.terraform);
      } catch {
        if (!cancelled) {
          setConnected(false);
          setRunnerDir(null);
          setTerraformVersion(null);
        }
      }
    };

    void check();
    const interval = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const runPlan = useCallback(async (files: Record<string, string>, opts: PlanRequestOptions = {}) => {
    if (runningRef.current) return;
    runningRef.current = true;
    logRef.current = '';
    setLog('');
    setOutcome(null);
    setSummary(null);
    setWarnings([]);
    setStatus('planning');

    const appendLog = (text: string) => {
      logRef.current += text;
      setLog(logRef.current);
    };

    const handleEvent = (event: RunnerEvent) => {
      switch (event.type) {
        case 'workspace':
          appendLog(`Workspace: ${event.dir}\n`);
          break;
        case 'phase':
          if (event.phase === 'init') setStatus('initializing');
          if (event.phase === 'plan') setStatus('planning');
          break;
        case 'output':
          appendLog(event.text);
          break;
        case 'info':
          appendLog(`[info] ${event.message}\n`);
          break;
        case 'warning':
          appendLog(`[warning] ${event.message}\n`);
          setWarnings((prev) => [...prev, event.message]);
          break;
        case 'exit':
          if (event.ok) {
            setStatus('done');
            setOutcome(event.changes ? 'changes' : 'no-changes');
            setSummary(extractSummary(logRef.current) ?? (event.changes ? 'Changes detected' : 'No changes.'));
          } else {
            setStatus('error');
            setOutcome('error');
            setSummary(`terraform exited with code ${event.code}`);
          }
          break;
        case 'error':
          setStatus('error');
          setOutcome('error');
          setSummary(event.message);
          break;
      }
    };

    try {
      const res = await fetch(`${getRunnerUrl()}/api/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          project: opts.project,
          requiredVariables: opts.requiredVariables,
        }),
      });

      if (!res.ok || !res.body) {
        const message =
          res.status === 409
            ? 'A plan is already running in the runner.'
            : `Runner rejected the request (${res.status}).`;
        setStatus('error');
        setOutcome('error');
        setSummary(message);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          handleEvent(JSON.parse(line) as RunnerEvent);
        }
      }
    } catch (err) {
      setStatus('error');
      setOutcome('error');
      setSummary(
        err instanceof Error
          ? `Lost connection to the runner: ${err.message}`
          : 'Lost connection to the runner.',
      );
    } finally {
      runningRef.current = false;
    }
  }, []);

  const running = status === 'initializing' || status === 'planning';

  const state: PlanRunnerState = {
    connected,
    runnerDir,
    terraformVersion,
    status,
    log,
    outcome,
    summary,
    warnings,
  };

  return { ...state, running, runPlan };
}
