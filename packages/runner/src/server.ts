import http from 'node:http';
import { existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkLocalstackHobbyCompatibility } from '@archviz/provider-aws';
import { assertSafeRelativePath, writeGeneratedFiles } from './files.js';
import {
  getLocalstackStatus,
  localstackEndpoint,
  startLocalstack,
  stopLocalstack,
  type LocalstackStatus,
} from './localstack.js';
import { withLocalstackProvider } from './localstack-provider.js';
import {
  buildAndPublishLocalstackImages,
  shouldBuildEcsImages,
  withMutableEcrTags,
} from './ecr-image.js';
import { discoverLocalstackEcsServiceUrl } from './ecs-service-url.js';
import {
  clearServiceLinks,
  findLatestServiceLinks,
  resolveLocalstackServiceLinks,
  writeServiceLinks,
} from './localstack-service-links.js';
import { createOpsSession, type OpKind } from './ops-session.js';
import type { PlanEvent } from './plan-events.js';
import {
  collectDeclaredVariables,
  isValidVariableName,
  projectSlug,
  readManifest,
  removeStaleGeneratedFiles,
  syncPlaceholderVariables,
  writeManifest,
  type ProjectRef,
} from './workspace.js';

export type { PlanEvent } from './plan-events.js';

export interface LocalstackHooks {
  getStatus: () => Promise<LocalstackStatus>;
  start: (
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ) => Promise<LocalstackStatus>;
  stop: (
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
  ) => Promise<LocalstackStatus>;
  endpoint: () => string;
}

export interface RunnerOptions {
  /** Directory terraform runs in — the user's exported Terraform folder. */
  cwd: string;
  /** Browser origins allowed to talk to the runner. */
  origins?: string[];
  /** Terraform executable (overridable for tests). */
  terraformBin?: string;
  /** LocalStack lifecycle hooks (overridable for tests). */
  localstack?: LocalstackHooks;
}

export const DEFAULT_PORT = 4180;
export const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

const MAX_BODY_BYTES = 20 * 1024 * 1024;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function runTerraform(
  bin: string,
  args: string[],
  cwd: string,
  onOutput: (stream: 'stdout' | 'stderr', text: string) => void,
  env?: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      shell: false,
      env: env ? { ...process.env, ...env } : process.env,
    });
    child.stdout.on('data', (chunk: Buffer) => onOutput('stdout', chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => onOutput('stderr', chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function terraformVersion(bin: string, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    try {
      const child = spawn(bin, ['version'], { cwd, shell: false });
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        resolve(code === 0 ? (out.split('\n')[0]?.trim() ?? null) : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

interface PlanBody {
  files: Record<string, string>;
  project: ProjectRef | null;
  requiredVariables: string[];
  resourceTypes: string[];
  region: string;
  /** Optional app build context (Dockerfile + sources) for LocalStack ECS image build. */
  appFiles: Record<string, string>;
}

async function parsePlanBody(req: http.IncomingMessage): Promise<PlanBody> {
  const parsed = JSON.parse(await readBody(req)) as {
    files?: unknown;
    project?: unknown;
    requiredVariables?: unknown;
    resourceTypes?: unknown;
    region?: unknown;
    appFiles?: unknown;
  };
  if (
    !parsed.files ||
    typeof parsed.files !== 'object' ||
    Array.isArray(parsed.files) ||
    Object.values(parsed.files).some((v) => typeof v !== 'string')
  ) {
    throw new Error('body must be { files: Record<string, string> }');
  }
  const files = parsed.files as Record<string, string>;
  for (const filePath of Object.keys(files)) {
    assertSafeRelativePath(filePath);
  }

  let project: ProjectRef | null = null;
  if (parsed.project !== undefined) {
    const p = parsed.project as { id?: unknown; name?: unknown };
    if (!p || typeof p !== 'object' || typeof p.name !== 'string' || p.name.trim() === '') {
      throw new Error('project must be { id?: string; name: string }');
    }
    project = { name: p.name, ...(typeof p.id === 'string' ? { id: p.id } : {}) };
  }

  let requiredVariables: string[] = [];
  if (parsed.requiredVariables !== undefined) {
    if (
      !Array.isArray(parsed.requiredVariables) ||
      parsed.requiredVariables.some((v) => typeof v !== 'string' || !isValidVariableName(v))
    ) {
      throw new Error('requiredVariables must be valid variable names');
    }
    requiredVariables = parsed.requiredVariables as string[];
  }

  let resourceTypes: string[] = [];
  if (parsed.resourceTypes !== undefined) {
    if (
      !Array.isArray(parsed.resourceTypes) ||
      parsed.resourceTypes.some((v) => typeof v !== 'string')
    ) {
      throw new Error('resourceTypes must be string[]');
    }
    resourceTypes = parsed.resourceTypes as string[];
  }

  let appFiles: Record<string, string> = {};
  if (parsed.appFiles !== undefined) {
    if (
      !parsed.appFiles ||
      typeof parsed.appFiles !== 'object' ||
      Array.isArray(parsed.appFiles) ||
      Object.values(parsed.appFiles).some((v) => typeof v !== 'string')
    ) {
      throw new Error('appFiles must be Record<string, string>');
    }
    appFiles = parsed.appFiles as Record<string, string>;
    for (const filePath of Object.keys(appFiles)) {
      assertSafeRelativePath(filePath);
    }
  }

  const region =
    typeof parsed.region === 'string' && parsed.region.trim() !== ''
      ? parsed.region.trim()
      : 'us-east-1';

  return { files, project, requiredVariables, resourceTypes, region, appFiles };
}

function workspaceDirFor(cwd: string, project: ProjectRef | null, localstack: boolean): string {
  if (!project) {
    return localstack ? path.join(cwd, 'localstack') : cwd;
  }
  const base = path.join(cwd, projectSlug(project.name));
  return localstack ? path.join(base, 'localstack') : base;
}

export function createRunnerServer(options: RunnerOptions): http.Server {
  const cwd = options.cwd;
  const origins = new Set(options.origins ?? DEFAULT_ORIGINS);
  const terraformBin = options.terraformBin ?? 'terraform';
  const ls: LocalstackHooks = options.localstack ?? {
    getStatus: getLocalstackStatus,
    start: startLocalstack,
    stop: stopLocalstack,
    endpoint: localstackEndpoint,
  };
  const ops = createOpsSession();

  function beginOp(kind: OpKind, res: http.ServerResponse, conflictMessage: string): ((event: PlanEvent) => void) | null {
    if (!ops.begin(kind)) {
      sendJson(res, 409, { error: conflictMessage });
      return null;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    return (event: PlanEvent) => {
      ops.emit(event);
      try {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify(event)}\n`);
        }
      } catch {
        /* client disconnected — op continues; subscribers still get events */
      }
    };
  }

  function endOp(res: http.ServerResponse): void {
    ops.end();
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* ignore */
    }
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    // Non-browser clients (no Origin header) are allowed; browsers must come
    // from a whitelisted studio origin — this server executes terraform, so
    // arbitrary websites must not be able to reach it.
    if (origin && !origins.has(origin)) {
      sendJson(res, 403, { error: `origin not allowed: ${origin}` });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      res.end();
      return;
    }

    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/api/health') {
      const version = await terraformVersion(terraformBin, cwd);
      const localstack = await ls.getStatus();
      const snap = ops.snapshot();
      const lastService = await findLatestServiceLinks(cwd);
      sendJson(res, 200, {
        ok: true,
        cwd,
        terraform: version,
        localstack,
        busy: snap.busy,
        op: snap.busy
          ? { kind: snap.kind, startedAt: snap.startedAt, eventCount: snap.events.length }
          : null,
        lastService,
      });
      return;
    }

    if (req.method === 'GET' && url === '/api/ops/current') {
      const snap = ops.snapshot();
      const lastService = await findLatestServiceLinks(cwd);
      sendJson(res, 200, { ...snap, lastService });
      return;
    }

    if (req.method === 'GET' && url.startsWith('/api/localstack/service')) {
      const parsedUrl = new URL(url, 'http://127.0.0.1');
      const projectName = parsedUrl.searchParams.get('project');
      const rediscover = parsedUrl.searchParams.get('rediscover') === '1';
      const resolved = await resolveLocalstackServiceLinks({
        cwd,
        projectName,
        region: 'us-east-1',
        endpoint: ls.endpoint(),
        rediscover,
      });
      sendJson(res, resolved.ok ? 200 : 404, {
        ok: resolved.ok,
        ...resolved.links,
        message: resolved.message,
        source: resolved.source,
      });
      return;
    }

    if (req.method === 'GET' && url === '/api/ops/stream') {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const snap = ops.snapshot();
      let sawTerminal = false;
      for (const event of snap.events) {
        res.write(`${JSON.stringify(event)}\n`);
        if (event.type === 'exit' || event.type === 'error') sawTerminal = true;
      }
      if (!snap.busy || sawTerminal) {
        res.end();
        return;
      }
      const unsubscribe = ops.subscribe((event) => {
        try {
          if (!res.writableEnded) {
            res.write(`${JSON.stringify(event)}\n`);
          }
        } catch {
          unsubscribe();
        }
        if (event.type === 'exit' || event.type === 'error') {
          unsubscribe();
          try {
            if (!res.writableEnded) res.end();
          } catch {
            /* ignore */
          }
        }
      });
      req.on('close', () => unsubscribe());
      return;
    }

    if (req.method === 'GET' && url === '/api/localstack/status') {
      sendJson(res, 200, await ls.getStatus());
      return;
    }

    if (req.method === 'POST' && url === '/api/localstack/start') {
      const emit = beginOp('start', res, 'a terraform operation is already running');
      if (!emit) return;
      try {
        emit({ type: 'phase', phase: 'start' });
        const status = await ls.start((stream, text) => emit({ type: 'output', stream, text }));
        if (status.message) emit({ type: 'info', message: status.message });
        emit({
          type: 'exit',
          code: status.running ? 0 : 1,
          ok: Boolean(status.running),
          changes: null,
        });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        endOp(res);
      }
      return;
    }

    if (req.method === 'POST' && url === '/api/localstack/stop') {
      const emit = beginOp('stop', res, 'a terraform operation is already running');
      if (!emit) return;
      try {
        emit({ type: 'phase', phase: 'stop' });
        const status = await ls.stop((stream, text) => emit({ type: 'output', stream, text }));
        if (status.message) emit({ type: 'info', message: status.message });
        emit({ type: 'exit', code: 0, ok: true, changes: null });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        endOp(res);
      }
      return;
    }

    if (req.method === 'POST' && url === '/api/plan') {
      let body: PlanBody;
      try {
        body = await parsePlanBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid JSON body' });
        return;
      }

      const emit = beginOp('plan', res, 'a plan is already running');
      if (!emit) return;

      try {
        await runPlanPipeline({
          emit,
          cwd,
          terraformBin,
          files: body.files,
          project: body.project,
          requiredVariables: body.requiredVariables,
          localstack: false,
          action: 'plan',
          region: body.region,
          endpoint: ls.endpoint(),
        });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        endOp(res);
      }
      return;
    }

    if (
      req.method === 'POST' &&
      (url === '/api/localstack/apply' || url === '/api/localstack/destroy')
    ) {
      let body: PlanBody;
      try {
        body = await parsePlanBody(req);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid JSON body' });
        return;
      }

      const hobby = checkLocalstackHobbyCompatibility(body.resourceTypes, {
        paidEntitlements: Boolean(process.env.LOCALSTACK_AUTH_TOKEN?.trim()),
      });
      if (!hobby.ok && body.resourceTypes.length > 0) {
        sendJson(res, 400, {
          error: hobby.message,
          unsupported: hobby.unsupported,
          ultimateHints: hobby.ultimateHints,
        });
        return;
      }

      const action = url.endsWith('/destroy') ? 'destroy' : 'apply';
      const emit = beginOp(action, res, 'a terraform operation is already running');
      if (!emit) return;

      try {
        const status = await ls.getStatus();
        const needsStart =
          !status.running ||
          !status.healthy ||
          status.dockerSockMounted === false ||
          status.ecrPortsPublished === false;
        if (needsStart) {
          emit({ type: 'phase', phase: 'start' });
          if (status.dockerSockMounted === false || status.ecrPortsPublished === false) {
            emit({
              type: 'info',
              message:
                'Recreating LocalStack with Docker socket + ECR ports (required for ECS/Lambda images).',
            });
          }
          const started = await ls.start((stream, text) =>
            emit({ type: 'output', stream, text }),
          );
          if (started.message) emit({ type: 'info', message: started.message });
          if (!started.running) {
            emit({
              type: 'error',
              message: started.message ?? 'Failed to start LocalStack',
            });
            emit({ type: 'exit', code: 1, ok: false, changes: null });
            return;
          }
          if (started.dockerSockMounted === false) {
            emit({
              type: 'warning',
              message:
                'LocalStack started without Docker socket — ECS RunTask / Lambda will fail. Ensure /var/run/docker.sock exists (Docker Desktop: enable default socket).',
            });
          }
        } else if (!status.authTokenConfigured) {
          emit({
            type: 'info',
            message: `LocalStack community image (${status.image}) — no auth token. Pin LOCALSTACK_IMAGE=localstack/localstack:latest + LOCALSTACK_AUTH_TOKEN for current releases — docs/localstack.md`,
          });
        }

        await runPlanPipeline({
          emit,
          cwd,
          terraformBin,
          files: body.files,
          project: body.project,
          requiredVariables: body.requiredVariables,
          resourceTypes: body.resourceTypes,
          appFiles: body.appFiles,
          localstack: true,
          action,
          region: body.region,
          endpoint: ls.endpoint(),
        });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        endOp(res);
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}

async function runPlanPipeline(args: {
  emit: (event: PlanEvent) => void;
  cwd: string;
  terraformBin: string;
  files: Record<string, string>;
  project: ProjectRef | null;
  requiredVariables: string[];
  resourceTypes?: string[];
  appFiles?: Record<string, string>;
  localstack: boolean;
  action: 'plan' | 'apply' | 'destroy';
  region: string;
  endpoint: string;
}): Promise<void> {
  const {
    emit,
    cwd,
    terraformBin,
    project,
    requiredVariables,
    resourceTypes = [],
    appFiles = {},
    localstack,
    action,
    region,
    endpoint,
  } = args;
  let files = args.files;

  if (localstack) {
    files = withMutableEcrTags(
      withLocalstackProvider(files, {
        region,
        endpoint,
      }),
    );
  }

  const workspaceDir = workspaceDirFor(cwd, project, localstack);
  await fsPromises.mkdir(workspaceDir, { recursive: true });
  emit({ type: 'workspace', dir: workspaceDir });

  const previous = await readManifest(workspaceDir);
  if (previous && project?.id && previous.project.id && previous.project.id !== project.id) {
    emit({
      type: 'warning',
      message: `This workspace was last used by a different diagram ("${previous.project.name}"). Its state may not match this diagram — rename one of them if that's unintended.`,
    });
  }

  emit({ type: 'phase', phase: 'write' });
  const removed = await removeStaleGeneratedFiles(workspaceDir, previous, files);
  if (removed.length > 0) {
    emit({
      type: 'info',
      message: `Removed stale generated files: ${removed.join(', ')}`,
    });
  }
  await writeGeneratedFiles(workspaceDir, files);
  await writeManifest(workspaceDir, {
    project: { id: project?.id ?? null, name: project?.name ?? '(no project)' },
    files: Object.keys(files),
  });

  const { created, removed: staleVars } = await syncPlaceholderVariables(
    workspaceDir,
    requiredVariables,
    collectDeclaredVariables(files),
  );
  if (created.length > 0) {
    emit({
      type: 'warning',
      message: `Created placeholder value(s) in terraform.tfvars for: ${created.join(', ')} — edit ${path.join(workspaceDir, 'terraform.tfvars')} with real values before applying.`,
    });
  }
  if (staleVars.length > 0) {
    emit({
      type: 'info',
      message: `Removed placeholder(s) from terraform.tfvars for variable(s) the config no longer declares: ${staleVars.join(', ')}`,
    });
  }

  const onOutput = (stream: 'stdout' | 'stderr', text: string) =>
    emit({ type: 'output', stream, text });

  const localstackEnv: NodeJS.ProcessEnv | undefined = localstack
    ? {
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_DEFAULT_REGION: region,
        AWS_ENDPOINT_URL: endpoint,
      }
    : undefined;

  // LocalStack workspaces always re-init so provider endpoint changes stick.
  const needsInit = localstack || !existsSync(path.join(workspaceDir, '.terraform'));
  if (needsInit) {
    emit({ type: 'phase', phase: 'init' });
    const initArgs = localstack
      ? ['init', '-input=false', '-no-color', '-reconfigure']
      : ['init', '-input=false', '-no-color'];
    const initCode = await runTerraform(
      terraformBin,
      initArgs,
      workspaceDir,
      onOutput,
      localstackEnv,
    );
    if (initCode !== 0) {
      emit({ type: 'exit', code: initCode, ok: false, changes: null });
      return;
    }
  }

  if (action === 'plan') {
    emit({ type: 'phase', phase: 'plan' });
    const planCode = await runTerraform(
      terraformBin,
      ['plan', '-input=false', '-no-color', '-detailed-exitcode'],
      workspaceDir,
      onOutput,
      localstackEnv,
    );
    emit({
      type: 'exit',
      code: planCode,
      ok: planCode === 0 || planCode === 2,
      changes: planCode === 1 ? null : planCode === 2,
    });
    return;
  }

  if (action === 'apply') {
    emit({ type: 'phase', phase: 'apply' });
    const applyCode = await runTerraform(
      terraformBin,
      ['apply', '-input=false', '-no-color', '-auto-approve'],
      workspaceDir,
      onOutput,
      localstackEnv,
    );
    if (applyCode !== 0) {
      emit({
        type: 'exit',
        code: applyCode,
        ok: false,
        changes: null,
      });
      return;
    }

    if (localstack && shouldBuildEcsImages(resourceTypes)) {
      emit({ type: 'phase', phase: 'image' });
      emit({
        type: 'info',
        message: 'Building container image for LocalStack ECS (Dockerfile → ECR tag).',
      });
      const imageResult = await buildAndPublishLocalstackImages({
        appFiles,
        terraformFiles: files,
        region,
        endpoint,
        onOutput,
      });
      if (imageResult.ok) {
        emit({ type: 'info', message: imageResult.message });
      } else {
        emit({ type: 'warning', message: imageResult.message });
      }

      emit({ type: 'phase', phase: 'service' });
      const serviceResult = await discoverLocalstackEcsServiceUrl({
        terraformFiles: files,
        region,
        endpoint,
        onOutput,
      });
      if (
        serviceResult.ok &&
        serviceResult.url &&
        serviceResult.swaggerUrl &&
        serviceResult.webUrl
      ) {
        emit({
          type: 'service',
          url: serviceResult.url,
          swaggerUrl: serviceResult.swaggerUrl,
          webUrl: serviceResult.webUrl,
        });
        emit({ type: 'info', message: serviceResult.message });
        await writeServiceLinks(workspaceDir, {
          url: serviceResult.url,
          swaggerUrl: serviceResult.swaggerUrl,
          webUrl: serviceResult.webUrl,
          projectSlug: project ? projectSlug(project.name) : '',
        });
      } else {
        emit({ type: 'warning', message: serviceResult.message });
      }
    }

    emit({
      type: 'exit',
      code: 0,
      ok: true,
      changes: true,
    });
    return;
  }

  emit({ type: 'phase', phase: 'destroy' });
  const destroyCode = await runTerraform(
    terraformBin,
    ['destroy', '-input=false', '-no-color', '-auto-approve'],
    workspaceDir,
    onOutput,
    localstackEnv,
  );
  if (localstack && destroyCode === 0) {
    await clearServiceLinks(workspaceDir);
    emit({
      type: 'info',
      message: 'LocalStack workspace destroyed — previous ECS Swagger URL is no longer valid.',
    });
  }
  emit({
    type: 'exit',
    code: destroyCode,
    ok: destroyCode === 0,
    changes: destroyCode === 0 ? true : null,
  });
}
