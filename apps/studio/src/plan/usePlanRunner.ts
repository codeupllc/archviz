import { useCallback, useEffect, useRef, useState } from 'react';

/** Mirrors the NDJSON events emitted by @archviz/runner. */
type RunnerEvent =
  | { type: 'workspace'; dir: string }
  | {
      type: 'phase';
      phase: 'write' | 'init' | 'plan' | 'apply' | 'destroy' | 'start' | 'stop' | 'image' | 'service';
    }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'info'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'service'; url: string; swaggerUrl: string }
  | { type: 'exit'; code: number; ok: boolean; changes: boolean | null }
  | { type: 'error'; message: string };

export interface PlanRequestOptions {
  /** Current diagram identity — the runner plans each diagram in its own workspace subfolder. */
  project?: { id?: string; name: string };
  /** Variables without defaults; the runner seeds terraform.tfvars placeholders for them. */
  requiredVariables?: string[];
  /** Palette resource types — used for LocalStack Hobby allowlist. */
  resourceTypes?: string[];
  /**
   * App build context for LocalStack ECS (e.g. app/Dockerfile + sources from Generate).
   * When ECS is on the diagram, Apply builds and tags the image for LocalStack ECR.
   */
  appFiles?: Record<string, string>;
}

export type PlanStatus =
  | 'idle'
  | 'initializing'
  | 'planning'
  | 'applying'
  | 'destroying'
  | 'starting'
  | 'done'
  | 'error';
export type PlanOutcome = 'changes' | 'no-changes' | 'error' | 'applied' | 'destroyed';

export interface LocalstackHealth {
  running: boolean;
  healthy: boolean | null;
  endpoint: string;
  image?: string;
  authTokenConfigured: boolean;
  dockerAvailable: boolean;
  /** False when LocalStack cannot spawn ECS/Lambda containers (socket not mounted). */
  dockerSockMounted?: boolean | null;
  message?: string;
}

export interface PlanRunnerState {
  /** Whether the local archviz-runner responded to a recent health check. */
  connected: boolean;
  /** The directory the runner executes terraform in (from health). */
  runnerDir: string | null;
  /** null when the runner can't find a terraform binary. */
  terraformVersion: string | null;
  localstack: LocalstackHealth | null;
  status: PlanStatus;
  log: string;
  outcome: PlanOutcome | null;
  /** Human summary, e.g. "Plan: 1 to add, 0 to change, 0 to destroy." */
  summary: string | null;
  /** Runner-side warnings (placeholder tfvars created, workspace mismatch, ...). */
  warnings: string[];
  /** Base URL of the LocalStack ECS task after Apply (e.g. http://127.0.0.1:45139). */
  localstackServiceUrl: string | null;
  /** Swagger UI on that task (…/swagger/). Cleared on destroy / new apply. */
  localstackSwaggerUrl: string | null;
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
    if (
      line.startsWith('Plan:') ||
      line.startsWith('No changes.') ||
      line.startsWith('Apply complete') ||
      line.startsWith('Destroy complete')
    ) {
      return line;
    }
  }
  return null;
}

/**
 * Talks to the local archviz-runner companion: polls /api/health and streams
 * terraform plan / LocalStack apply-destroy output.
 */
export function usePlanRunner() {
  const [connected, setConnected] = useState(false);
  const [runnerDir, setRunnerDir] = useState<string | null>(null);
  const [terraformVersion, setTerraformVersion] = useState<string | null>(null);
  const [localstack, setLocalstack] = useState<LocalstackHealth | null>(null);
  const [status, setStatus] = useState<PlanStatus>('idle');
  const [log, setLog] = useState('');
  const [outcome, setOutcome] = useState<PlanOutcome | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [localstackServiceUrl, setLocalstackServiceUrl] = useState<string | null>(null);
  const [localstackSwaggerUrl, setLocalstackSwaggerUrl] = useState<string | null>(null);
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
        const body = (await res.json()) as {
          cwd: string;
          terraform: string | null;
          localstack?: LocalstackHealth;
        };
        if (cancelled) return;
        setConnected(true);
        setRunnerDir(body.cwd);
        setTerraformVersion(body.terraform);
        setLocalstack(body.localstack ?? null);
      } catch {
        if (!cancelled) {
          setConnected(false);
          setRunnerDir(null);
          setTerraformVersion(null);
          setLocalstack(null);
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

  const streamNdjson = useCallback(async (path: string, body: unknown, kind: 'plan' | 'apply' | 'destroy' | 'start') => {
    if (runningRef.current) return;
    runningRef.current = true;
    logRef.current = '';
    setLog('');
    setOutcome(null);
    setSummary(null);
    setWarnings([]);
    if (kind === 'apply' || kind === 'destroy') {
      setLocalstackServiceUrl(null);
      setLocalstackSwaggerUrl(null);
    }
    if (kind === 'plan') setStatus('planning');
    else if (kind === 'apply') setStatus('applying');
    else if (kind === 'destroy') setStatus('destroying');
    else setStatus('starting');

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
          if (
            event.phase === 'apply' ||
            event.phase === 'image' ||
            event.phase === 'service'
          ) {
            setStatus('applying');
          }
          if (event.phase === 'destroy') setStatus('destroying');
          if (event.phase === 'start') setStatus('starting');
          if (event.phase === 'image') appendLog('[phase] building container image…\n');
          if (event.phase === 'service') appendLog('[phase] discovering LocalStack API URL…\n');
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
        case 'service':
          setLocalstackServiceUrl(event.url);
          setLocalstackSwaggerUrl(event.swaggerUrl);
          appendLog(`[LocalStack] API ${event.url} — Swagger ${event.swaggerUrl}\n`);
          break;
        case 'exit':
          if (event.ok) {
            setStatus('done');
            if (kind === 'apply') {
              setOutcome('applied');
              setSummary(extractSummary(logRef.current) ?? 'Applied to LocalStack');
            } else if (kind === 'destroy') {
              setOutcome('destroyed');
              setSummary(extractSummary(logRef.current) ?? 'Destroyed on LocalStack');
            } else if (kind === 'start') {
              setOutcome('no-changes');
              setSummary('LocalStack ready');
            } else {
              setOutcome(event.changes ? 'changes' : 'no-changes');
              setSummary(
                extractSummary(logRef.current) ??
                  (event.changes ? 'Changes detected' : 'No changes.'),
              );
            }
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
      const res = await fetch(`${getRunnerUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        let message =
          res.status === 409
            ? 'A terraform operation is already running in the runner.'
            : `Runner rejected the request (${res.status}).`;
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody.error) message = errBody.error;
        } catch {
          /* keep default */
        }
        setStatus('error');
        setOutcome('error');
        setSummary(message);
        appendLog(`${message}\n`);
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
      const message =
        err instanceof Error
          ? `Lost connection to the runner: ${err.message}`
          : 'Lost connection to the runner.';
      setStatus('error');
      setOutcome('error');
      setSummary(message);
      appendLog(`${message}\n`);
    } finally {
      runningRef.current = false;
    }
  }, []);

  const runPlan = useCallback(
    async (files: Record<string, string>, opts: PlanRequestOptions = {}) => {
      await streamNdjson(
        '/api/plan',
        {
          files,
          project: opts.project,
          requiredVariables: opts.requiredVariables,
        },
        'plan',
      );
    },
    [streamNdjson],
  );

  const runLocalstackApply = useCallback(
    async (files: Record<string, string>, opts: PlanRequestOptions = {}) => {
      await streamNdjson(
        '/api/localstack/apply',
        {
          files,
          project: opts.project,
          requiredVariables: opts.requiredVariables,
          resourceTypes: opts.resourceTypes,
          appFiles: opts.appFiles,
        },
        'apply',
      );
    },
    [streamNdjson],
  );

  const runLocalstackDestroy = useCallback(
    async (files: Record<string, string>, opts: PlanRequestOptions = {}) => {
      await streamNdjson(
        '/api/localstack/destroy',
        {
          files,
          project: opts.project,
          requiredVariables: opts.requiredVariables,
          resourceTypes: opts.resourceTypes,
        },
        'destroy',
      );
    },
    [streamNdjson],
  );

  const startLocalstack = useCallback(async () => {
    await streamNdjson('/api/localstack/start', {}, 'start');
  }, [streamNdjson]);

  const running =
    status === 'initializing' ||
    status === 'planning' ||
    status === 'applying' ||
    status === 'destroying' ||
    status === 'starting';

  const state: PlanRunnerState = {
    connected,
    runnerDir,
    terraformVersion,
    localstack,
    status,
    log,
    outcome,
    summary,
    warnings,
    localstackServiceUrl,
    localstackSwaggerUrl,
  };

  return {
    ...state,
    running,
    runPlan,
    runLocalstackApply,
    runLocalstackDestroy,
    startLocalstack,
  };
}
