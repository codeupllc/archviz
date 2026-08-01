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
  | { type: 'service'; url: string; swaggerUrl: string; webUrl?: string }
  | { type: 'exit'; code: number; ok: boolean; changes: boolean | null }
  | { type: 'error'; message: string };

type OpKind = 'plan' | 'apply' | 'destroy' | 'start' | 'stop';

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
  /**
   * Absolute path to projects/<slug>/app on disk. Prefer this over appFiles so
   * binary assets (JPEG/PNG) are not corrupted by UTF-8 JSON transport.
   */
  appSourceDir?: string | null;
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
  /** Generated admin UI on that task (…/web/). Cleared on destroy / new apply. */
  localstackWebUrl: string | null;
}

function webUrlFromServiceBase(url: string): string {
  return `${url.replace(/\/$/, '')}/web/`;
}

/** Restore LocalStack ECS links after refresh from the runner’s last Apply. */
function serviceLinksFromOpsEvents(
  events: RunnerEvent[],
): { url: string; swaggerUrl: string; webUrl: string } | null {
  let last: { url: string; swaggerUrl: string; webUrl: string } | null = null;
  let applyOk = false;
  for (const event of events) {
    if (event.type === 'service') {
      last = {
        url: event.url,
        swaggerUrl: event.swaggerUrl,
        webUrl: event.webUrl ?? webUrlFromServiceBase(event.url),
      };
    }
    if (event.type === 'exit' && event.ok) applyOk = true;
    if (event.type === 'exit' && !event.ok) {
      last = null;
      applyOk = false;
    }
    if (event.type === 'error') {
      last = null;
      applyOk = false;
    }
  }
  return applyOk ? last : null;
}

const RUNNER_URL_KEY = 'archviz:runner-url:v1';
const SERVICE_LINKS_KEY_PREFIX = 'archviz:localstack-service:v1:';
/** @deprecated pre-project-scoped cache — cleared on read so Open UI cannot leak across diagrams */
const SERVICE_LINKS_KEY_LEGACY = 'archviz:localstack-service:v1';
const DEFAULT_RUNNER_URL = 'http://127.0.0.1:4180';
const HEALTH_POLL_MS = 5000;

type ServiceLinks = { url: string; swaggerUrl: string; webUrl: string };

function serviceLinksStorageKey(projectName?: string | null): string {
  const slug = (projectName ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return SERVICE_LINKS_KEY_PREFIX + (slug || '_default');
}

function readCachedServiceLinks(projectName?: string | null): ServiceLinks | null {
  try {
    // Drop the old global key so watch-app URLs cannot shadow Agape (etc.).
    window.localStorage.removeItem(SERVICE_LINKS_KEY_LEGACY);
    const raw = window.localStorage.getItem(serviceLinksStorageKey(projectName));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServiceLinks>;
    if (
      typeof parsed.url === 'string' &&
      typeof parsed.swaggerUrl === 'string' &&
      typeof parsed.webUrl === 'string'
    ) {
      return { url: parsed.url, swaggerUrl: parsed.swaggerUrl, webUrl: parsed.webUrl };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCachedServiceLinks(links: ServiceLinks, projectName?: string | null): void {
  try {
    window.localStorage.removeItem(SERVICE_LINKS_KEY_LEGACY);
    window.localStorage.setItem(serviceLinksStorageKey(projectName), JSON.stringify(links));
  } catch {
    /* ignore */
  }
}

function clearCachedServiceLinks(projectName?: string | null): void {
  try {
    window.localStorage.removeItem(SERVICE_LINKS_KEY_LEGACY);
    window.localStorage.removeItem(serviceLinksStorageKey(projectName));
  } catch {
    /* ignore */
  }
}

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

function statusForOpKind(kind: OpKind): PlanStatus {
  if (kind === 'plan') return 'planning';
  if (kind === 'apply') return 'applying';
  if (kind === 'destroy') return 'destroying';
  return 'starting';
}

async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunnerEvent) => void,
): Promise<void> {
  const reader = body.getReader();
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
      onEvent(JSON.parse(line) as RunnerEvent);
    }
  }
}

/**
 * Talks to the local archviz-runner companion: polls /api/health and streams
 * terraform plan / LocalStack apply-destroy output. Reattaches after refresh
 * when the runner still has an in-flight op (`/api/ops/stream`).
 *
 * Pass `projectName` (diagram meta.name) so Open UI / Open API URLs stay scoped
 * to the active project — never reuse another diagram's LocalStack ECS port.
 */
export function usePlanRunner(projectName?: string | null) {
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
  const [localstackWebUrl, setLocalstackWebUrl] = useState<string | null>(null);
  const [localstackSwaggerUrl, setLocalstackSwaggerUrl] = useState<string | null>(null);
  const runningRef = useRef(false);
  const logRef = useRef('');
  const opKindRef = useRef<OpKind | null>(null);
  const reattachAttempted = useRef(false);
  const hydrateLinksAttempted = useRef(false);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  // Switching diagrams must drop the previous project's ECS URLs immediately.
  useEffect(() => {
    setLocalstackServiceUrl(null);
    setLocalstackSwaggerUrl(null);
    setLocalstackWebUrl(null);
    hydrateLinksAttempted.current = false;
  }, [projectName]);

  const appendLog = useCallback((text: string) => {
    logRef.current += text;
    setLog(logRef.current);
  }, []);

  const handleEvent = useCallback(
    (event: RunnerEvent, kind: OpKind) => {
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
          if (event.phase === 'stop') setStatus('starting');
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
        case 'service': {
          const webUrl = event.webUrl ?? webUrlFromServiceBase(event.url);
          const links = { url: event.url, swaggerUrl: event.swaggerUrl, webUrl };
          setLocalstackServiceUrl(links.url);
          setLocalstackSwaggerUrl(links.swaggerUrl);
          setLocalstackWebUrl(links.webUrl);
          writeCachedServiceLinks(links, projectNameRef.current);
          appendLog(
            `[LocalStack] API ${event.url} — Swagger ${event.swaggerUrl} — UI ${webUrl}\n`,
          );
          break;
        }
        case 'exit':
          if (event.ok) {
            setStatus('done');
            if (kind === 'apply') {
              setOutcome('applied');
              setSummary(extractSummary(logRef.current) ?? 'Applied to LocalStack');
            } else if (kind === 'destroy') {
              setOutcome('destroyed');
              setSummary(extractSummary(logRef.current) ?? 'Destroyed on LocalStack');
            } else if (kind === 'start' || kind === 'stop') {
              setOutcome('no-changes');
              setSummary(kind === 'start' ? 'LocalStack ready' : 'LocalStack stopped');
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
    },
    [appendLog],
  );

  const attachToOpsStream = useCallback(
    async (kind: OpKind) => {
      if (runningRef.current) return;
      runningRef.current = true;
      opKindRef.current = kind;
      logRef.current = '';
      setLog('');
      setOutcome(null);
      setSummary(null);
      setWarnings([]);
      setStatus(statusForOpKind(kind));
      appendLog(`[reattached] Runner still running ${kind} — resuming log stream…\n`);

      try {
        const res = await fetch(`${getRunnerUrl()}/api/ops/stream`);
        if (!res.ok || !res.body) {
          appendLog(`[reattach] failed (${res.status})\n`);
          setStatus('error');
          setOutcome('error');
          setSummary('Could not reattach to runner operation.');
          return;
        }
        await readNdjsonStream(res.body, (event) => handleEvent(event, kind));
      } catch (err) {
        const message =
          err instanceof Error
            ? `Lost connection while reattached: ${err.message}`
            : 'Lost connection while reattached.';
        setStatus('error');
        setOutcome('error');
        setSummary(message);
        appendLog(`${message}\n`);
      } finally {
        runningRef.current = false;
        opKindRef.current = null;
      }
    },
    [appendLog, handleEvent],
  );

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
          busy?: boolean;
          op?: { kind: OpKind; startedAt: string | null } | null;
        };
        if (cancelled) return;
        setConnected(true);
        setRunnerDir(body.cwd);
        setTerraformVersion(body.terraform);
        setLocalstack(body.localstack ?? null);

        if (
          !reattachAttempted.current &&
          body.busy &&
          body.op?.kind &&
          !runningRef.current
        ) {
          reattachAttempted.current = true;
          void attachToOpsStream(body.op.kind);
        }

        // After Apply (or runner restart), restore ECS URLs for THIS project only.
        if (!hydrateLinksAttempted.current && !body.busy && !runningRef.current) {
          hydrateLinksAttempted.current = true;
          const project = projectNameRef.current;
          const applyLinks = (links: ServiceLinks | null | undefined) => {
            if (!links?.url || !links.swaggerUrl || !links.webUrl) return false;
            setLocalstackServiceUrl(links.url);
            setLocalstackSwaggerUrl(links.swaggerUrl);
            setLocalstackWebUrl(links.webUrl);
            writeCachedServiceLinks(links, project);
            return true;
          };
          try {
            const q = new URLSearchParams();
            if (project?.trim()) q.set('project', project.trim());
            const svcRes = await fetch(
              `${getRunnerUrl()}/api/localstack/service${q.toString() ? `?${q}` : ''}`,
            );
            if (!cancelled && svcRes.ok) {
              const svc = (await svcRes.json()) as ServiceLinks & { ok?: boolean };
              if (svc.ok !== false && applyLinks(svc)) return;
            }

            applyLinks(readCachedServiceLinks(project));
          } catch {
            applyLinks(readCachedServiceLinks(project));
          }
        }
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
  }, [attachToOpsStream, projectName]);

  const streamNdjson = useCallback(
    async (path: string, body: unknown, kind: OpKind) => {
      if (runningRef.current) return;
      runningRef.current = true;
      opKindRef.current = kind;
      reattachAttempted.current = true;
      logRef.current = '';
      setLog('');
      setOutcome(null);
      setSummary(null);
      setWarnings([]);
      if (kind === 'apply' || kind === 'destroy') {
        setLocalstackServiceUrl(null);
        setLocalstackSwaggerUrl(null);
        setLocalstackWebUrl(null);
        hydrateLinksAttempted.current = false;
        if (kind === 'destroy') clearCachedServiceLinks(projectNameRef.current);
      }
      setStatus(statusForOpKind(kind));

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
          if (res.status === 409) {
            // Another tab / prior session owns the op — reattach instead of failing hard.
            runningRef.current = false;
            try {
              const cur = await fetch(`${getRunnerUrl()}/api/ops/current`);
              if (cur.ok) {
                const snap = (await cur.json()) as {
                  busy: boolean;
                  kind: OpKind | null;
                };
                if (snap.busy && snap.kind) {
                  appendLog(`${message} Reattaching…\n`);
                  await attachToOpsStream(snap.kind);
                  return;
                }
              }
            } catch {
              /* fall through */
            }
          }
          setStatus('error');
          setOutcome('error');
          setSummary(message);
          appendLog(`${message}\n`);
          return;
        }

        await readNdjsonStream(res.body, (event) => handleEvent(event, kind));
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
        opKindRef.current = null;
      }
    },
    [appendLog, attachToOpsStream, handleEvent],
  );

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
          appSourceDir: opts.appSourceDir,
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

  /**
   * Restore LocalStack ECS URLs without Apply (disk cache + live rediscovery).
   * Pass force=true from Open UI/API so a runner restart / port change is picked up.
   */
  const ensureLocalstackServiceUrls = useCallback(
    async (
      name?: string | null,
      opts?: { force?: boolean },
    ): Promise<ServiceLinks | null> => {
      const project = name?.trim() || projectNameRef.current?.trim() || null;
      if (
        !opts?.force &&
        localstackServiceUrl &&
        localstackSwaggerUrl &&
        localstackWebUrl
      ) {
        return {
          url: localstackServiceUrl,
          swaggerUrl: localstackSwaggerUrl,
          webUrl: localstackWebUrl,
        };
      }
      const apply = (links: ServiceLinks | null | undefined) => {
        if (!links?.url || !links.swaggerUrl || !links.webUrl) return null;
        setLocalstackServiceUrl(links.url);
        setLocalstackSwaggerUrl(links.swaggerUrl);
        setLocalstackWebUrl(links.webUrl);
        writeCachedServiceLinks(links, project);
        return links;
      };
      try {
        const q = new URLSearchParams();
        if (project) q.set('project', project);
        // Prefer cache unless force; rediscover when force or cache miss handled server-side.
        if (opts?.force) q.set('rediscover', '1');
        const res = await fetch(`${getRunnerUrl()}/api/localstack/service?${q}`);
        if (res.ok) {
          const body = (await res.json()) as ServiceLinks & {
            ok?: boolean;
            projectSlug?: string;
          };
          if (body.ok !== false) {
            const want = project
              ? project
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '')
              : '';
            // Ignore a runner payload that belongs to a different diagram.
            if (
              !want ||
              !body.projectSlug ||
              body.projectSlug === want ||
              body.projectSlug === project
            ) {
              const links = apply(body);
              if (links) return links;
            }
          }
        }
      } catch {
        /* fall through */
      }
      // Only fall back to this project's browser cache — never another diagram.
      return apply(readCachedServiceLinks(project));
    },
    [localstackServiceUrl, localstackSwaggerUrl, localstackWebUrl],
  );

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
    localstackWebUrl,
  };

  return {
    ...state,
    running,
    runPlan,
    runLocalstackApply,
    runLocalstackDestroy,
    startLocalstack,
    ensureLocalstackServiceUrls,
  };
}
