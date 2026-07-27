import http from 'node:http';
import { existsSync, promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertSafeRelativePath, writeGeneratedFiles } from './files.js';
import {
  ensurePlaceholderVariables,
  isValidVariableName,
  projectSlug,
  readManifest,
  removeStaleGeneratedFiles,
  writeManifest,
  type ProjectRef,
} from './workspace.js';

export interface RunnerOptions {
  /** Directory terraform runs in — the user's exported Terraform folder. */
  cwd: string;
  /** Browser origins allowed to talk to the runner. */
  origins?: string[];
  /** Terraform executable (overridable for tests). */
  terraformBin?: string;
}

export type PlanEvent =
  | { type: 'workspace'; dir: string }
  | { type: 'phase'; phase: 'write' | 'init' | 'plan' }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'info'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'exit'; code: number; ok: boolean; changes: boolean | null }
  | { type: 'error'; message: string };

export const DEFAULT_PORT = 4180;
export const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

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
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, shell: false });
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

export function createRunnerServer(options: RunnerOptions): http.Server {
  const cwd = options.cwd;
  const origins = new Set(options.origins ?? DEFAULT_ORIGINS);
  const terraformBin = options.terraformBin ?? 'terraform';
  let busy = false;

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
      sendJson(res, 200, { ok: true, cwd, terraform: version });
      return;
    }

    if (req.method === 'POST' && url === '/api/plan') {
      if (busy) {
        sendJson(res, 409, { error: 'a plan is already running' });
        return;
      }

      let files: Record<string, string>;
      let project: ProjectRef | null = null;
      let requiredVariables: string[] = [];
      try {
        const parsed = JSON.parse(await readBody(req)) as {
          files?: unknown;
          project?: unknown;
          requiredVariables?: unknown;
        };
        if (
          !parsed.files ||
          typeof parsed.files !== 'object' ||
          Array.isArray(parsed.files) ||
          Object.values(parsed.files).some((v) => typeof v !== 'string')
        ) {
          sendJson(res, 400, { error: 'body must be { files: Record<string, string> }' });
          return;
        }
        files = parsed.files as Record<string, string>;
        for (const filePath of Object.keys(files)) {
          assertSafeRelativePath(filePath);
        }

        if (parsed.project !== undefined) {
          const p = parsed.project as { id?: unknown; name?: unknown };
          if (!p || typeof p !== 'object' || typeof p.name !== 'string' || p.name.trim() === '') {
            sendJson(res, 400, { error: 'project must be { id?: string; name: string }' });
            return;
          }
          project = { name: p.name, ...(typeof p.id === 'string' ? { id: p.id } : {}) };
        }

        if (parsed.requiredVariables !== undefined) {
          if (
            !Array.isArray(parsed.requiredVariables) ||
            parsed.requiredVariables.some((v) => typeof v !== 'string' || !isValidVariableName(v))
          ) {
            sendJson(res, 400, { error: 'requiredVariables must be valid variable names' });
            return;
          }
          requiredVariables = parsed.requiredVariables as string[];
        }
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid JSON body' });
        return;
      }

      busy = true;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const emit = (event: PlanEvent) => {
        res.write(`${JSON.stringify(event)}\n`);
      };

      try {
        // Each diagram plans in its own workspace subfolder so state, tfvars,
        // and provider caches never cross-contaminate between projects.
        const workspaceDir = project ? path.join(cwd, projectSlug(project.name)) : cwd;
        await fsPromises.mkdir(workspaceDir, { recursive: true });
        emit({ type: 'workspace', dir: workspaceDir });

        const previous = await readManifest(workspaceDir);
        if (previous && project?.id && previous.project.id && previous.project.id !== project.id) {
          emit({
            type: 'warning',
            message: `This workspace was last planned by a different diagram ("${previous.project.name}"). Its state may not match this diagram — rename one of them if that's unintended.`,
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

        const created = await ensurePlaceholderVariables(workspaceDir, requiredVariables);
        if (created.length > 0) {
          emit({
            type: 'warning',
            message: `Created placeholder value(s) in terraform.tfvars for: ${created.join(', ')} — edit ${path.join(workspaceDir, 'terraform.tfvars')} with real values before applying.`,
          });
        }

        const onOutput = (stream: 'stdout' | 'stderr', text: string) =>
          emit({ type: 'output', stream, text });

        if (!existsSync(path.join(workspaceDir, '.terraform'))) {
          emit({ type: 'phase', phase: 'init' });
          const initCode = await runTerraform(
            terraformBin,
            ['init', '-input=false', '-no-color'],
            workspaceDir,
            onOutput,
          );
          if (initCode !== 0) {
            emit({ type: 'exit', code: initCode, ok: false, changes: null });
            return;
          }
        }

        emit({ type: 'phase', phase: 'plan' });
        const planCode = await runTerraform(
          terraformBin,
          ['plan', '-input=false', '-no-color', '-detailed-exitcode'],
          workspaceDir,
          onOutput,
        );
        // -detailed-exitcode: 0 = no changes, 2 = changes present, 1 = error.
        emit({
          type: 'exit',
          code: planCode,
          ok: planCode === 0 || planCode === 2,
          changes: planCode === 1 ? null : planCode === 2,
        });
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        busy = false;
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });
}
