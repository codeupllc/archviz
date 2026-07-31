import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { DEFAULT_LOCALSTACK_ENDPOINT } from './localstack-provider.js';

export const LOCALSTACK_CONTAINER_NAME = 'archviz-localstack';
/**
 * Last community image before LocalStack 2026.03 required an auth token.
 * Override with LOCALSTACK_IMAGE (e.g. localstack/localstack:latest + token).
 */
export const DEFAULT_LOCALSTACK_IMAGE = 'localstack/localstack:4.14.0';
export const LOCALSTACK_PORT = 4566;
/** LocalStack ECR / external service port range (required for `docker push` to ECR). */
export const LOCALSTACK_ECR_PORT_RANGE = '4510-4559';

/** Default Docker socket path for container mounts (Docker Desktop remaps this). */
export const DOCKER_SOCK_PATH = '/var/run/docker.sock';

/**
 * Host path for the Docker *CLI*. Do **not** use this as a `docker run -v`
 * source on Docker Desktop for Mac — mounting `~/.docker/run/docker.sock`
 * fails with "operation not supported". Container mounts must use
 * {@link DOCKER_SOCK_PATH} (`/var/run/docker.sock`).
 */
export function resolveDockerSockPath(): string {
  const fromEnv = process.env.DOCKER_SOCK?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    '/var/run/docker.sock',
    `${homedir()}/.docker/run/docker.sock`,
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return DOCKER_SOCK_PATH;
}

/**
 * Socket path to bind-mount into LocalStack. Prefer `/var/run/docker.sock`
 * (Docker Desktop / Linux). Override with DOCKER_SOCK only when you know the
 * mount source works (e.g. Colima/Linux custom paths).
 */
export function resolveDockerSockMountSource(): string {
  const fromEnv = process.env.DOCKER_SOCK?.trim();
  if (fromEnv) return fromEnv;
  // Always the canonical path for mounts — existsSync is unreliable on macOS
  // Desktop (CLI uses ~/.docker/run/docker.sock; mounts need /var/run/docker.sock).
  return DOCKER_SOCK_PATH;
}

/** @deprecated use resolveLocalstackImage() — kept for tests/exports */
export const LOCALSTACK_IMAGE = DEFAULT_LOCALSTACK_IMAGE;

export interface LocalstackStatus {
  running: boolean;
  endpoint: string;
  container: string;
  image: string;
  authTokenConfigured: boolean;
  dockerAvailable: boolean;
  /** True when the LocalStack container can reach the host Docker daemon (ECS/Lambda). */
  dockerSockMounted: boolean | null;
  /** True when host ports 4510–4559 are published (ECR docker push). */
  ecrPortsPublished: boolean | null;
  healthy: boolean | null;
  message?: string;
}

function localstackEndpoint(): string {
  return process.env.LOCALSTACK_ENDPOINT?.trim() || DEFAULT_LOCALSTACK_ENDPOINT;
}

function resolveLocalstackImage(): string {
  return process.env.LOCALSTACK_IMAGE?.trim() || DEFAULT_LOCALSTACK_IMAGE;
}

function authToken(): string | undefined {
  const t = process.env.LOCALSTACK_AUTH_TOKEN?.trim();
  return t || undefined;
}

function imageRequiresAuthToken(image: string): boolean {
  // Calendar versions 2026.03+ (and :latest / :stable) need a token.
  const tag = image.includes(':') ? image.slice(image.lastIndexOf(':') + 1) : 'latest';
  if (tag === 'latest' || tag === 'stable') return true;
  if (/^2026\.(0[3-9]|1[0-2])/.test(tag)) return true;
  if (/^202[7-9]\./.test(tag)) return true;
  return false;
}

function run(
  bin: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      env: { ...process.env, ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function dockerAvailable(): Promise<boolean> {
  try {
    const { code } = await run('docker', ['version', '--format', '{{.Server.Version}}']);
    return code === 0;
  } catch {
    return false;
  }
}

async function containerRunning(name: string): Promise<boolean> {
  try {
    const { code, stdout } = await run('docker', [
      'inspect',
      '-f',
      '{{.State.Running}}',
      name,
    ]);
    return code === 0 && stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function probeHealth(endpoint: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${endpoint}/_localstack/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function recentContainerLogs(name: string): Promise<string> {
  try {
    const { stdout, stderr } = await run('docker', ['logs', '--tail', '80', name]);
    return `${stdout}\n${stderr}`.trim();
  } catch {
    return '';
  }
}

function licenseFailureMessage(logs: string, hasToken: boolean, image: string): string | null {
  const lower = logs.toLowerCase();
  if (
    lower.includes('license activation failed') ||
    lower.includes('no credentials were found') ||
    lower.includes('exit code 55')
  ) {
    if (!hasToken) {
      return [
        `LocalStack image "${image}" requires LOCALSTACK_AUTH_TOKEN.`,
        'Either set a free Hobby token from https://app.localstack.cloud, or pin',
        `LOCALSTACK_IMAGE=${DEFAULT_LOCALSTACK_IMAGE} (Archviz default — no token).`,
        'See docs/localstack.md',
      ].join(' ');
    }
    return [
      'LocalStack license activation failed for the configured LOCALSTACK_AUTH_TOKEN.',
      'Check the token at https://app.localstack.cloud and restart the runner.',
    ].join(' ');
  }
  return null;
}

function baseStatus(
  partial: Omit<
    LocalstackStatus,
    | 'endpoint'
    | 'container'
    | 'image'
    | 'authTokenConfigured'
    | 'dockerSockMounted'
    | 'ecrPortsPublished'
  > &
    Partial<
      Pick<LocalstackStatus, 'authTokenConfigured' | 'dockerSockMounted' | 'ecrPortsPublished'>
    >,
): LocalstackStatus {
  return {
    endpoint: localstackEndpoint(),
    container: LOCALSTACK_CONTAINER_NAME,
    image: resolveLocalstackImage(),
    authTokenConfigured: Boolean(authToken()),
    dockerSockMounted: partial.dockerSockMounted ?? null,
    ecrPortsPublished: partial.ecrPortsPublished ?? null,
    ...partial,
  };
}

/**
 * `docker run` args for LocalStack. Mounts the Docker socket so ECS RunTask /
 * Lambda can create sibling containers (without it: "Docker not available").
 * Publishes 4510–4559 for ECR `docker push` from the host.
 */
export function buildLocalstackRunArgs(opts: {
  image: string;
  token?: string;
  containerName?: string;
  port?: number;
  /** Host path of the Docker socket (may differ from the in-container path). */
  dockerSockHostPath?: string;
  dockerSockContainerPath?: string;
}): string[] {
  const name = opts.containerName ?? LOCALSTACK_CONTAINER_NAME;
  const port = opts.port ?? LOCALSTACK_PORT;
  const hostSock = opts.dockerSockHostPath ?? resolveDockerSockMountSource();
  const containerSock = opts.dockerSockContainerPath ?? DOCKER_SOCK_PATH;
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `${port}:4566`,
    '-p',
    `${LOCALSTACK_ECR_PORT_RANGE}:${LOCALSTACK_ECR_PORT_RANGE}`,
    '-e',
    'DEBUG=0',
    '-e',
    `DOCKER_HOST=unix://${containerSock}`,
    '-v',
    `${hostSock}:${containerSock}`,
  ];
  if (opts.token) {
    args.push('-e', `LOCALSTACK_AUTH_TOKEN=${opts.token}`);
  }
  args.push(opts.image);
  return args;
}

async function containerHasDockerSockMount(name: string): Promise<boolean> {
  try {
    const { code, stdout } = await run('docker', [
      'inspect',
      '-f',
      '{{range .Mounts}}{{.Destination}}\n{{end}}',
      name,
    ]);
    if (code !== 0) return false;
    return stdout.split('\n').some((line) => line.trim() === DOCKER_SOCK_PATH);
  } catch {
    return false;
  }
}

/** True when ECR edge ports are published (needed for host `docker push`). */
async function containerHasEcrPorts(name: string): Promise<boolean> {
  try {
    const { code, stdout } = await run('docker', [
      'inspect',
      '-f',
      '{{json .HostConfig.PortBindings}}',
      name,
    ]);
    if (code !== 0) return false;
    return stdout.includes('4510');
  } catch {
    return false;
  }
}

async function containerNeedsRecreate(name: string): Promise<boolean> {
  const sock = await containerHasDockerSockMount(name);
  if (!sock) return true;
  const ecrPorts = await containerHasEcrPorts(name);
  return !ecrPorts;
}

export async function getLocalstackStatus(): Promise<LocalstackStatus> {
  const token = authToken();
  const image = resolveLocalstackImage();
  const docker = await dockerAvailable();
  if (!docker) {
    return baseStatus({
      running: false,
      dockerAvailable: false,
      dockerSockMounted: null,
      healthy: null,
      message: 'Docker is not available on PATH — install Docker to run LocalStack.',
    });
  }
  if (imageRequiresAuthToken(image) && !token) {
    return baseStatus({
      running: false,
      dockerAvailable: true,
      dockerSockMounted: null,
      healthy: false,
      message: [
        `Image "${image}" needs LOCALSTACK_AUTH_TOKEN.`,
        `Unset LOCALSTACK_IMAGE to use the default ${DEFAULT_LOCALSTACK_IMAGE} (no token),`,
        'or set a free Hobby token from https://app.localstack.cloud.',
      ].join(' '),
    });
  }
  const running = await containerRunning(LOCALSTACK_CONTAINER_NAME);
  const sockMounted = running ? await containerHasDockerSockMount(LOCALSTACK_CONTAINER_NAME) : null;
  const ecrPorts = running ? await containerHasEcrPorts(LOCALSTACK_CONTAINER_NAME) : null;
  const healthy = running ? await probeHealth(localstackEndpoint()) : false;
  let message: string | undefined;
  if (running && sockMounted === false) {
    message = `LocalStack is running without ${DOCKER_SOCK_PATH} mounted — ECS/Lambda RunTask will fail. Click Start (or Apply) to recreate with the Docker socket.`;
  } else if (running && ecrPorts === false) {
    message =
      'LocalStack is missing ECR ports 4510–4559 — docker push to LocalStack ECR will fail. Apply/Start will recreate the container.';
  }
  return baseStatus({
    running,
    dockerAvailable: true,
    dockerSockMounted: sockMounted,
    ecrPortsPublished: ecrPorts,
    healthy,
    message,
  });
}

export async function startLocalstack(
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<LocalstackStatus> {
  const token = authToken();
  const image = resolveLocalstackImage();
  const docker = await dockerAvailable();
  if (!docker) {
    return baseStatus({
      running: false,
      dockerAvailable: false,
      dockerSockMounted: null,
      healthy: null,
      message: 'Docker is not available on PATH.',
    });
  }

  if (imageRequiresAuthToken(image) && !token) {
    return baseStatus({
      running: false,
      dockerAvailable: true,
      dockerSockMounted: null,
      healthy: false,
      message: [
        `Image "${image}" needs LOCALSTACK_AUTH_TOKEN.`,
        `Use default ${DEFAULT_LOCALSTACK_IMAGE} (no token) or set a Hobby token — docs/localstack.md`,
      ].join(' '),
    });
  }

  if (await containerRunning(LOCALSTACK_CONTAINER_NAME)) {
    if (!(await containerNeedsRecreate(LOCALSTACK_CONTAINER_NAME))) {
      const healthy = await probeHealth(localstackEndpoint());
      return baseStatus({
        running: true,
        dockerAvailable: true,
        dockerSockMounted: true,
        healthy,
        message: healthy
          ? `LocalStack already running (${image}).`
          : 'Container up; waiting for health…',
      });
    }
    // Older Archviz runners started LocalStack without the Docker socket /
    // ECR ports — recreate so ECS/Lambda + docker push work.
    onOutput?.(
      'stderr',
      `Recreating ${LOCALSTACK_CONTAINER_NAME}: Docker socket and/or ECR ports 4510–4559 were missing.\n`,
    );
    await run('docker', ['rm', '-f', LOCALSTACK_CONTAINER_NAME]).catch(() => undefined);
  }

  // Remove a stopped container with the same name so `docker run` can reuse it.
  await run('docker', ['rm', '-f', LOCALSTACK_CONTAINER_NAME]).catch(() => undefined);

  const args = buildLocalstackRunArgs({ image, token });

  const { code, stdout, stderr } = await run('docker', args);
  onOutput?.('stdout', stdout);
  onOutput?.('stderr', stderr);
  if (code !== 0) {
    return baseStatus({
      running: false,
      dockerAvailable: true,
      dockerSockMounted: false,
      healthy: false,
      message: stderr.trim() || stdout.trim() || `docker run exited ${code}`,
    });
  }

  // Wait briefly for health (license failures exit the container quickly).
  let healthy = false;
  for (let i = 0; i < 40; i += 1) {
    if (!(await containerRunning(LOCALSTACK_CONTAINER_NAME))) {
      const logs = await recentContainerLogs(LOCALSTACK_CONTAINER_NAME);
      onOutput?.('stderr', logs ? `${logs}\n` : '');
      const licenseMsg = licenseFailureMessage(logs, Boolean(token), image);
      return baseStatus({
        running: false,
        dockerAvailable: true,
        dockerSockMounted: false,
        healthy: false,
        message:
          licenseMsg ??
          'LocalStack container exited before becoming healthy. Check Docker logs for archviz-localstack.',
      });
    }
    healthy = await probeHealth(localstackEndpoint());
    if (healthy) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!healthy) {
    const logs = await recentContainerLogs(LOCALSTACK_CONTAINER_NAME);
    onOutput?.('stderr', logs ? `${logs}\n` : '');
    const licenseMsg = licenseFailureMessage(logs, Boolean(token), image);
    return baseStatus({
      running: false,
      dockerAvailable: true,
      dockerSockMounted: false,
      healthy: false,
      message:
        licenseMsg ??
        'LocalStack started but health check did not pass — see Docker logs for archviz-localstack.',
    });
  }

  return baseStatus({
    running: true,
    dockerAvailable: true,
    dockerSockMounted: true,
    healthy: true,
    message: `LocalStack started (${image}${token ? ', auth token set' : ', no auth token'}).`,
  });
}

export async function stopLocalstack(
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<LocalstackStatus> {
  const { code, stdout, stderr } = await run('docker', [
    'rm',
    '-f',
    LOCALSTACK_CONTAINER_NAME,
  ]);
  onOutput?.('stdout', stdout);
  onOutput?.('stderr', stderr);
  return baseStatus({
    running: false,
    dockerAvailable: await dockerAvailable(),
    dockerSockMounted: null,
    healthy: false,
    message: code === 0 ? 'LocalStack stopped.' : stderr.trim() || `docker rm exited ${code}`,
  });
}

export { localstackEndpoint, resolveLocalstackImage };
