import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRunnerServer, type PlanEvent } from './server.js';
import { assertSafeRelativePath } from './files.js';

/**
 * A fake `terraform` shell script so tests exercise the real spawn/stream
 * path without terraform installed. It logs invocations to stub.log in the
 * cwd and reads per-test knobs from plan-exit / plan-sleep files.
 */
const STUB_SCRIPT = `#!/bin/sh
echo "$1" >> stub.log
case "$1" in
  version) echo "Terraform v0.0.0-stub" ;;
  init) echo "Initializing the backend..." ;;
  plan)
    [ -f plan-sleep ] && sleep "$(cat plan-sleep)"
    echo "Plan: 1 to add, 0 to change, 0 to destroy."
    [ -f plan-exit ] && exit "$(cat plan-exit)"
    exit 2
    ;;
esac
exit 0
`;

let tmpDir: string;
let stubPath: string;
let server: http.Server;
let baseUrl: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviz-runner-'));
  stubPath = path.join(tmpDir, 'terraform-stub');
  await fs.writeFile(stubPath, STUB_SCRIPT, { mode: 0o755 });

  server = createRunnerServer({
    cwd: tmpDir,
    terraformBin: stubPath,
    origins: ['http://localhost:5173'],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function runPlan(
  files: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<{
  status: number;
  events: PlanEvent[];
}> {
  const res = await fetch(`${baseUrl}/api/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, ...extra }),
  });
  if (!res.ok) return { status: res.status, events: [] };
  const text = await res.text();
  const events = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as PlanEvent);
  return { status: res.status, events };
}

describe('assertSafeRelativePath', () => {
  it('accepts normal relative paths', () => {
    expect(() => assertSafeRelativePath('main.tf')).not.toThrow();
    expect(() => assertSafeRelativePath('network/main.tf')).not.toThrow();
  });

  it('rejects traversal, absolute, and terraform-internal paths', () => {
    expect(() => assertSafeRelativePath('../evil.tf')).toThrow();
    expect(() => assertSafeRelativePath('a/../../evil.tf')).toThrow();
    expect(() => assertSafeRelativePath('/etc/passwd')).toThrow();
    expect(() => assertSafeRelativePath('C:\\windows\\evil.tf')).toThrow();
    expect(() => assertSafeRelativePath('.terraform/providers/x.tf')).toThrow();
    expect(() => assertSafeRelativePath('')).toThrow();
  });
});

describe('runner HTTP API', () => {
  it('reports health with cwd and terraform version', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cwd: string; terraform: string | null };
    expect(body.ok).toBe(true);
    expect(body.cwd).toBe(tmpDir);
    expect(body.terraform).toBe('Terraform v0.0.0-stub');
  });

  it('rejects disallowed browser origins, allows the studio origin', async () => {
    const bad = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://evil.example' },
    });
    expect(bad.status).toBe(403);

    const good = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('rejects unsafe file paths with 400 before running anything', async () => {
    const { status } = await runPlan({ '../evil.tf': 'boom' });
    expect(status).toBe(400);
    await expect(fs.readFile(path.join(tmpDir, 'stub.log'), 'utf8')).rejects.toThrow();
  });

  it('writes files, runs init then plan, and streams NDJSON events', async () => {
    const { status, events } = await runPlan({ 'main.tf': 'resource "x" "y" {}' });
    expect(status).toBe(200);

    expect(await fs.readFile(path.join(tmpDir, 'main.tf'), 'utf8')).toBe('resource "x" "y" {}');

    const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
    expect(phases).toEqual(['write', 'init', 'plan']);

    const output = events
      .filter((e) => e.type === 'output')
      .map((e) => e.text)
      .join('');
    expect(output).toContain('Initializing the backend...');
    expect(output).toContain('Plan: 1 to add, 0 to change, 0 to destroy.');

    const exit = events.find((e) => e.type === 'exit');
    expect(exit).toEqual({ type: 'exit', code: 2, ok: true, changes: true });
  });

  it('skips init when .terraform already exists and reports no changes on exit 0', async () => {
    await fs.mkdir(path.join(tmpDir, '.terraform'));
    await fs.writeFile(path.join(tmpDir, 'plan-exit'), '0');

    const { events } = await runPlan({ 'main.tf': '# empty' });

    const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
    expect(phases).toEqual(['write', 'plan']);
    expect(await fs.readFile(path.join(tmpDir, 'stub.log'), 'utf8')).not.toContain('init');

    const exit = events.find((e) => e.type === 'exit');
    expect(exit).toEqual({ type: 'exit', code: 0, ok: true, changes: false });
  });

  it('plans each project in its own workspace subfolder', async () => {
    const { events } = await runPlan(
      { 'main.tf': '# project A' },
      { project: { id: 'proj-a', name: 'My App / Staging' } },
    );

    const workspace = events.find((e) => e.type === 'workspace');
    expect(workspace).toEqual({ type: 'workspace', dir: path.join(tmpDir, 'my-app-staging') });
    expect(
      await fs.readFile(path.join(tmpDir, 'my-app-staging', 'main.tf'), 'utf8'),
    ).toBe('# project A');
    // nothing written at the root
    await expect(fs.readFile(path.join(tmpDir, 'main.tf'), 'utf8')).rejects.toThrow();
  });

  it('removes its own stale files on re-plan but never user files', async () => {
    const project = { id: 'proj-a', name: 'demo' };
    await runPlan({ 'main.tf': '# v1', 'database.tf': '# db' }, { project });

    const userFile = path.join(tmpDir, 'demo', 'backend.tf');
    await fs.writeFile(userFile, '# user-managed backend');

    const { events } = await runPlan({ 'main.tf': '# v2' }, { project });

    await expect(fs.readFile(path.join(tmpDir, 'demo', 'database.tf'), 'utf8')).rejects.toThrow();
    expect(await fs.readFile(userFile, 'utf8')).toBe('# user-managed backend');
    expect(await fs.readFile(path.join(tmpDir, 'demo', 'main.tf'), 'utf8')).toBe('# v2');

    const info = events.find((e) => e.type === 'info');
    expect(info && 'message' in info && info.message).toContain('database.tf');
  });

  it('seeds terraform.tfvars placeholders for required variables without clobbering edits', async () => {
    const project = { id: 'proj-a', name: 'demo' };
    const first = await runPlan(
      { 'main.tf': '# v1' },
      { project, requiredVariables: ['ssm1_val', 'db_pass'] },
    );

    const warning = first.events.find((e) => e.type === 'warning');
    expect(warning && 'message' in warning && warning.message).toContain('ssm1_val');

    const tfvarsPath = path.join(tmpDir, 'demo', 'terraform.tfvars');
    const seeded = await fs.readFile(tfvarsPath, 'utf8');
    expect(seeded).toContain('ssm1_val = "CHANGEME"');
    expect(seeded).toContain('db_pass = "CHANGEME"');

    // user fills in a real value; re-plan must not touch it or re-warn for it
    await fs.writeFile(tfvarsPath, 'ssm1_val = "real-secret"\ndb_pass = "CHANGEME" # placeholder\n');
    const second = await runPlan({ 'main.tf': '# v2' }, { project, requiredVariables: ['ssm1_val', 'db_pass'] });

    expect(await fs.readFile(tfvarsPath, 'utf8')).toContain('ssm1_val = "real-secret"');
    expect(second.events.find((e) => e.type === 'warning')).toBeUndefined();
  });

  it('prunes its own placeholders once the config stops declaring the variable', async () => {
    const project = { id: 'proj-a', name: 'demo' };
    const config = 'variable "ssm1_val" {}\n';
    await runPlan({ 'main.tf': config }, { project, requiredVariables: ['ssm1_val'] });

    const tfvarsPath = path.join(tmpDir, 'demo', 'terraform.tfvars');
    expect(await fs.readFile(tfvarsPath, 'utf8')).toContain('ssm1_val = "CHANGEME"');

    // The property is re-promoted under a new name: the old line would otherwise
    // linger and Terraform would report "Value for undeclared variable".
    const { events } = await runPlan(
      { 'main.tf': 'variable "ssm1_value" {}\n' },
      { project, requiredVariables: ['ssm1_value'] },
    );

    const tfvars = await fs.readFile(tfvarsPath, 'utf8');
    expect(tfvars).not.toContain('ssm1_val =');
    expect(tfvars).toContain('ssm1_value = "CHANGEME"');

    const info = events.find((e) => e.type === 'info' && 'message' in e && e.message.includes('no longer declares'));
    expect(info && 'message' in info && info.message).toContain('ssm1_val');
  });

  it('keeps a value the user edited even when its variable disappears', async () => {
    const project = { id: 'proj-a', name: 'demo' };
    const tfvarsPath = path.join(tmpDir, 'demo', 'terraform.tfvars');
    await fs.mkdir(path.join(tmpDir, 'demo'), { recursive: true });
    await fs.writeFile(tfvarsPath, 'db_pass = "real-secret"\n');

    await runPlan({ 'main.tf': '# no variables at all' }, { project });

    // Unstamped lines are never touched — losing a real secret to silence a
    // warning is the worse trade.
    expect(await fs.readFile(tfvarsPath, 'utf8')).toContain('db_pass = "real-secret"');
  });

  it('warns when a different diagram plans into the same workspace', async () => {
    await runPlan({ 'main.tf': '# a' }, { project: { id: 'proj-a', name: 'demo' } });
    const { events } = await runPlan({ 'main.tf': '# b' }, { project: { id: 'proj-b', name: 'demo' } });

    const warning = events.find((e) => e.type === 'warning');
    expect(warning && 'message' in warning && warning.message).toContain('different diagram');
  });

  it('rejects malformed variable names', async () => {
    const { status } = await runPlan(
      { 'main.tf': '# x' },
      { requiredVariables: ['ok_name', 'bad name\ninjection = "x"'] },
    );
    expect(status).toBe(400);
  });

  it('rejects a second plan while one is running', async () => {
    await fs.mkdir(path.join(tmpDir, '.terraform'));
    await fs.writeFile(path.join(tmpDir, 'plan-sleep'), '1');

    const first = runPlan({ 'main.tf': '# slow' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await runPlan({ 'main.tf': '# rejected' });
    expect(second.status).toBe(409);

    const { status } = await first;
    expect(status).toBe(200);
  });
});
