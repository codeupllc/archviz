import { spawn } from 'node:child_process';

export interface EcsServiceUrlResult {
  ok: boolean;
  url: string | null;
  swaggerUrl: string | null;
  /** Generated admin UI on the same task (…/web/). */
  webUrl: string | null;
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

function isWebEcsName(name: string): boolean {
  return /(^|[\s_-])web([\s_-]|$)|-web$/i.test(name);
}

/**
 * Parse aws_ecs_cluster + preferred API aws_ecs_service from HCL.
 * Prefers a non-web service (the one with DATABASE_URL / RDS) so Open UI
 * does not land on a canvas "web" tier that shares the cluster but has no DB.
 */
export function parseEcsClusterAndService(files: Record<string, string>): {
  clusterName: string | null;
  serviceName: string | null;
  containerPort: number;
} {
  let clusterName: string | null = null;
  const serviceNames: string[] = [];
  let containerPort = 80;
  let apiContainerPort: number | null = null;

  for (const content of Object.values(files)) {
    if (!clusterName) {
      const m = content.match(
        /resource\s+"aws_ecs_cluster"\s+"[^"]+"\s*\{[\s\S]*?\bname\s*=\s*"([^"]+)"/,
      );
      if (m?.[1]) clusterName = m[1];
    }

    const svcRe = /resource\s+"aws_ecs_service"\s+"([^"]+)"\s*\{/g;
    let svcMatch: RegExpExecArray | null;
    while ((svcMatch = svcRe.exec(content)) !== null) {
      let depth = 0;
      let j = svcMatch.index + svcMatch[0].length - 1;
      for (; j < content.length; j += 1) {
        if (content[j] === '{') depth += 1;
        else if (content[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      const block = content.slice(svcMatch.index, j);
      const nameMatch = block.match(/\bname\s*=\s*"([^"]+)"/);
      if (nameMatch?.[1]) serviceNames.push(nameMatch[1]);
    }

    // Prefer containerPort from a task definition that injects DATABASE_URL.
    const tdRe = /resource\s+"aws_ecs_task_definition"\s+"[^"]+"\s*\{/g;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(content)) !== null) {
      let depth = 0;
      let j = tdMatch.index + tdMatch[0].length - 1;
      for (; j < content.length; j += 1) {
        if (content[j] === '{') depth += 1;
        else if (content[j] === '}') {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
      const block = content.slice(tdMatch.index, j);
      const portMatch = block.match(/containerPort\s*=\s*(\d+)/);
      if (!portMatch?.[1]) continue;
      const port = Number(portMatch[1]);
      if (block.includes('DATABASE_URL')) {
        apiContainerPort = port;
      } else if (containerPort === 80) {
        containerPort = port;
      }
    }

    const portMatch = content.match(/containerPort\s*=\s*(\d+)/);
    if (portMatch?.[1] && containerPort === 80) containerPort = Number(portMatch[1]);
  }

  const apiService =
    serviceNames.find((n) => !isWebEcsName(n)) ?? serviceNames[0] ?? null;

  return {
    clusterName,
    serviceName: apiService,
    containerPort: apiContainerPort ?? containerPort,
  };
}

async function hostPortFromDescribeTasks(
  clusterName: string,
  region: string,
  endpoint: string,
  serviceName?: string | null,
): Promise<number | null> {
  const listArgs = [
    'ecs',
    'list-tasks',
    '--cluster',
    clusterName,
    '--desired-status',
    'RUNNING',
    '--region',
    region,
    '--endpoint-url',
    endpoint,
  ];
  if (serviceName) {
    listArgs.splice(4, 0, '--service-name', serviceName);
  }
  const listed = await awsJson<{ taskArns?: string[] }>(listArgs, region, endpoint);
  const arns = listed?.taskArns ?? [];
  if (arns.length === 0) return null;

  const described = await awsJson<{
    tasks?: Array<{
      lastStatus?: string;
      group?: string;
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
    if (serviceName && task.group && !task.group.includes(serviceName)) continue;
    for (const c of task.containers ?? []) {
      for (const b of c.networkBindings ?? []) {
        if (typeof b.hostPort === 'number' && b.hostPort > 0) return b.hostPort;
      }
    }
  }
  return null;
}

/**
 * Fallback: LocalStack names sibling containers `ls-ecs-<cluster>-…`.
 * Prefer a container that has DATABASE_URL (API), not the canvas web tier.
 */
async function hostPortFromDocker(clusterName: string, containerPort: number): Promise<number | null> {
  const filter = `name=ls-ecs-${clusterName}`;
  const listed = await run('docker', [
    'ps',
    '--filter',
    filter,
    '--format',
    '{{.ID}}\t{{.Ports}}',
  ]);
  const blob =
    listed.code === 0 && listed.stdout.trim()
      ? listed.stdout
      : (
          await run('docker', [
            'ps',
            '--filter',
            'name=ls-ecs-',
            '--format',
            '{{.ID}}\t{{.Ports}}',
          ])
        ).stdout;
  if (!blob.trim()) return null;

  const lines = blob
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let fallback: number | null = null;
  for (const line of lines) {
    const [id, ports = ''] = line.split('\t');
    const host = parseDockerPorts(ports, containerPort);
    if (host == null || !id) continue;
    const env = await run('docker', ['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', id]);
    if (env.code === 0 && /DATABASE_URL=/.test(env.stdout)) return host;
    if (fallback == null) fallback = host;
  }
  return fallback;
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
  /** Skip force-new-deployment (for reopen/hydrate when tasks are already running). */
  skipForceRedeploy?: boolean;
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
      webUrl: null,
      message: 'No aws_ecs_cluster found in Terraform — cannot discover a LocalStack API URL.',
    };
  }

  if (serviceName && !opts.skipForceRedeploy) {
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
    hostPort = await hostPortFromDescribeTasks(
      clusterName,
      opts.region,
      opts.endpoint,
      serviceName,
    );
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
      webUrl: null,
      message: [
        `No RUNNING ECS task with a published port for cluster "${clusterName}" after ${Math.round(timeoutMs / 1000)}s.`,
        'Check LocalStack logs / image build, and that the task can reach RDS (DATABASE_URL).',
      ].join(' '),
    };
  }

  const url = `http://127.0.0.1:${hostPort}`;
  const swaggerUrl = `${url}/swagger/`;
  const webUrl = `${url}/web/`;
  const healthy = await probeHealth(url);
  if (!healthy) {
    return {
      ok: true,
      url,
      swaggerUrl,
      webUrl,
      message: `LocalStack ECS listening on ${url} ( /health not ready yet — retry Open Swagger / Open UI shortly).`,
    };
  }

  return {
    ok: true,
    url,
    swaggerUrl,
    webUrl,
    message: `LocalStack API ready at ${swaggerUrl} — UI at ${webUrl}`,
  };
}
