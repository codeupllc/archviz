import { spawn } from 'node:child_process';

export interface EcsServiceUrlResult {
  ok: boolean;
  url: string | null;
  swaggerUrl: string | null;
  message: string;
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

function awsEnv(region: string, endpoint: string): NodeJS.ProcessEnv {
  return {
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_DEFAULT_REGION: region,
    AWS_ENDPOINT_URL: endpoint,
  };
}

async function awsJson<T>(
  args: string[],
  region: string,
  endpoint: string,
): Promise<T | null> {
  const { code, stdout } = await run('aws', [...args, '--output', 'json'], {
    env: awsEnv(region, endpoint),
  });
  if (code !== 0) return null;
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return null;
  }
}

/** Parse first aws_ecs_cluster.name and aws_ecs_service name from HCL. */
export function parseEcsClusterAndService(files: Record<string, string>): {
  clusterName: string | null;
  serviceName: string | null;
  containerPort: number;
} {
  let clusterName: string | null = null;
  let serviceName: string | null = null;
  let containerPort = 80;

  for (const content of Object.values(files)) {
    if (!clusterName) {
      const m = content.match(
        /resource\s+"aws_ecs_cluster"\s+"[^"]+"\s*\{[\s\S]*?\bname\s*=\s*"([^"]+)"/,
      );
      if (m?.[1]) clusterName = m[1];
    }
    if (!serviceName) {
      const m = content.match(
        /resource\s+"aws_ecs_service"\s+"[^"]+"\s*\{[\s\S]*?\bname\s*=\s*"([^"]+)"/,
      );
      if (m?.[1]) serviceName = m[1];
    }
    const portMatch = content.match(/containerPort\s*=\s*(\d+)/);
    if (portMatch?.[1]) containerPort = Number(portMatch[1]);
  }

  return { clusterName, serviceName, containerPort };
}

async function hostPortFromDescribeTasks(
  clusterName: string,
  region: string,
  endpoint: string,
): Promise<number | null> {
  const listed = await awsJson<{ taskArns?: string[] }>(
    ['ecs', 'list-tasks', '--cluster', clusterName, '--desired-status', 'RUNNING', '--region', region, '--endpoint-url', endpoint],
    region,
    endpoint,
  );
  const arns = listed?.taskArns ?? [];
  if (arns.length === 0) return null;

  const described = await awsJson<{
    tasks?: Array<{
      lastStatus?: string;
      containers?: Array<{
        networkBindings?: Array<{ hostPort?: number; containerPort?: number }>;
      }>;
    }>;
  }>(
    [
      'ecs',
      'describe-tasks',
      '--cluster',
      clusterName,
      '--tasks',
      ...arns,
      '--region',
      region,
      '--endpoint-url',
      endpoint,
    ],
    region,
    endpoint,
  );

  for (const task of described?.tasks ?? []) {
    if (task.lastStatus !== 'RUNNING') continue;
    for (const c of task.containers ?? []) {
      for (const b of c.networkBindings ?? []) {
        if (typeof b.hostPort === 'number' && b.hostPort > 0) return b.hostPort;
      }
    }
  }
  return null;
}

/** Fallback: LocalStack names sibling containers `ls-ecs-<cluster>-…`. */
async function hostPortFromDocker(clusterName: string, containerPort: number): Promise<number | null> {
  const filter = `name=ls-ecs-${clusterName}`;
  const { code, stdout } = await run('docker', [
    'ps',
    '--filter',
    filter,
    '--format',
    '{{.Ports}}',
  ]);
  if (code !== 0 || !stdout.trim()) {
    // Broader filter — any LocalStack ECS container
    const all = await run('docker', ['ps', '--filter', 'name=ls-ecs-', '--format', '{{.Ports}}']);
    if (all.code !== 0 || !all.stdout.trim()) return null;
    return parseDockerPorts(all.stdout, containerPort);
  }
  return parseDockerPorts(stdout, containerPort);
}

/** Parse `docker ps --format '{{.Ports}}'` output for a host port. */
export function parseDockerPorts(portsBlob: string, preferredContainerPort: number): number | null {
  // e.g. 0.0.0.0:45139->80/tcp, :::45139->80/tcp
  const lines = portsBlob.split('\n').map((l) => l.trim()).filter(Boolean);
  let fallback: number | null = null;
  for (const line of lines) {
    const re = /(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):(\d+)->(\d+)\/tcp/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const host = Number(m[1]);
      const container = Number(m[2]);
      if (container === preferredContainerPort) return host;
      if (fallback == null) fallback = host;
    }
  }
  return fallback;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function probeHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function forceNewDeployment(
  clusterName: string,
  serviceName: string,
  region: string,
  endpoint: string,
): Promise<void> {
  await run(
    'aws',
    [
      'ecs',
      'update-service',
      '--cluster',
      clusterName,
      '--service',
      serviceName,
      '--force-new-deployment',
      '--region',
      region,
      '--endpoint-url',
      endpoint,
    ],
    { env: awsEnv(region, endpoint) },
  );
}

/**
 * After LocalStack Apply + image tag, wait for an ECS task and resolve a host
 * URL for Studio Open Swagger.
 */
export async function discoverLocalstackEcsServiceUrl(opts: {
  terraformFiles: Record<string, string>;
  region: string;
  endpoint: string;
  /** Max wait for a RUNNING task (default ~45s). */
  timeoutMs?: number;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}): Promise<EcsServiceUrlResult> {
  const { clusterName, serviceName, containerPort } = parseEcsClusterAndService(
    opts.terraformFiles,
  );
  if (!clusterName) {
    return {
      ok: false,
      url: null,
      swaggerUrl: null,
      message: 'No aws_ecs_cluster found in Terraform — cannot discover a LocalStack API URL.',
    };
  }

  if (serviceName) {
    opts.onOutput?.(
      'stdout',
      `Forcing new deployment for ${serviceName} so tasks pull the freshly tagged image…\n`,
    );
    await forceNewDeployment(clusterName, serviceName, opts.region, opts.endpoint);
  }

  const timeoutMs = opts.timeoutMs ?? 45_000;
  const started = Date.now();
  opts.onOutput?.(
    'stdout',
    `Waiting for ECS task on cluster "${clusterName}"${serviceName ? ` / service "${serviceName}"` : ''}…\n`,
  );

  let hostPort: number | null = null;
  while (Date.now() - started < timeoutMs) {
    hostPort = await hostPortFromDescribeTasks(clusterName, opts.region, opts.endpoint);
    if (hostPort == null) {
      hostPort = await hostPortFromDocker(clusterName, containerPort);
    }
    if (hostPort != null) break;
    await sleep(2000);
  }

  if (hostPort == null) {
    return {
      ok: false,
      url: null,
      swaggerUrl: null,
      message: [
        `No RUNNING ECS task with a published port for cluster "${clusterName}" after ${Math.round(timeoutMs / 1000)}s.`,
        'Check LocalStack logs / image build, and that the task can reach RDS (DATABASE_URL).',
      ].join(' '),
    };
  }

  const url = `http://127.0.0.1:${hostPort}`;
  const swaggerUrl = `${url}/swagger/`;
  const healthy = await probeHealth(url);
  if (!healthy) {
    return {
      ok: true,
      url,
      swaggerUrl,
      message: `LocalStack ECS listening on ${url} ( /health not ready yet — retry Open Swagger shortly).`,
    };
  }

  return {
    ok: true,
    url,
    swaggerUrl,
    message: `LocalStack API ready at ${swaggerUrl}`,
  };
}
