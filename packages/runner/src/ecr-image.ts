import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ImageBuildRequest {
  /** Files for the Docker build context (Dockerfile at root or under dockerfilePath). */
  files: Record<string, string>;
  /** Path inside the context (default Dockerfile). */
  dockerfile?: string;
}

export interface BuiltImageTarget {
  repositoryName: string;
  tag: string;
  /** Full LocalStack ECR URI from DescribeRepositories (without tag). */
  repositoryUri: string;
}

function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
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

/** True when LocalStack Apply should build+tag images for ECS. */
export function shouldBuildEcsImages(resourceTypes: string[]): boolean {
  const set = new Set(resourceTypes);
  return set.has('aws/ecs-task-definition') || set.has('aws/ecs-service');
}

/**
 * Pull ECR repository `name = "..."` values from generated HCL.
 * Brace-balanced scan so nested blocks don't truncate the match.
 */
export function parseEcrRepositoryNames(files: Record<string, string>): string[] {
  const names = new Set<string>();
  for (const content of Object.values(files)) {
    const re = /resource\s+"aws_ecr_repository"\s+"[^"]+"\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      let depth = 0;
      let j = match.index + match[0].length - 1;
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
      const block = content.slice(match.index, j);
      const nameMatch = block.match(/\bname\s*=\s*"([^"]+)"/);
      if (nameMatch?.[1]) names.add(nameMatch[1]);
    }
  }
  return [...names];
}

/**
 * Normalize Studio/enterprise paths (`app/Dockerfile`) into a Docker build
 * context rooted at the Dockerfile directory.
 */
export function normalizeAppBuildContext(
  appFiles: Record<string, string>,
): { files: Record<string, string>; dockerfile: string } | null {
  const entries = Object.entries(appFiles);
  if (entries.length === 0) return null;

  const dockerfileEntry = entries.find(([p]) => /(^|\/)Dockerfile$/i.test(p));
  if (!dockerfileEntry) return null;

  const [dockerfilePath] = dockerfileEntry;
  const dir = dockerfilePath.includes('/')
    ? dockerfilePath.slice(0, dockerfilePath.lastIndexOf('/'))
    : '';
  const prefix = dir ? `${dir}/` : '';
  const files: Record<string, string> = {};
  for (const [p, content] of entries) {
    if (dir && !p.startsWith(prefix) && p !== dockerfilePath) continue;
    const rel = dir ? p.slice(prefix.length) : p;
    if (!rel || rel.includes('..')) continue;
    files[rel] = content;
  }
  if (!files.Dockerfile && !Object.keys(files).some((k) => /^Dockerfile$/i.test(k))) {
    return null;
  }
  return { files, dockerfile: 'Dockerfile' };
}

/** Force MUTABLE tags in LocalStack HCL so rebuild/push of :latest works. */
export function withMutableEcrTags(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [filePath, content] of Object.entries(files)) {
    out[filePath] = content.replace(
      /image_tag_mutability\s*=\s*"IMMUTABLE"/g,
      'image_tag_mutability = "MUTABLE"',
    );
  }
  return out;
}

async function writeContextDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviz-ecr-build-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

async function describeRepositoryUri(
  repositoryName: string,
  region: string,
  endpoint: string,
): Promise<string | null> {
  const { code, stdout } = await run(
    'aws',
    [
      'ecr',
      'describe-repositories',
      '--repository-names',
      repositoryName,
      '--region',
      region,
      '--endpoint-url',
      endpoint,
      '--output',
      'json',
    ],
    {
      env: {
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_DEFAULT_REGION: region,
      },
    },
  );
  if (code !== 0) return null;
  try {
    const parsed = JSON.parse(stdout) as {
      repositories?: Array<{ repositoryUri?: string }>;
    };
    return parsed.repositories?.[0]?.repositoryUri ?? null;
  } catch {
    return null;
  }
}

/**
 * Fallback URI when `aws` CLI is missing — matches LocalStack's common host form.
 */
export function fallbackLocalstackEcrUri(
  repositoryName: string,
  region = 'us-east-1',
): string {
  return `000000000000.dkr.ecr.${region}.localhost.localstack.cloud:4566/${repositoryName}`;
}

export interface BuildPushResult {
  ok: boolean;
  targets: BuiltImageTarget[];
  message: string;
}

/**
 * Build the app image once, tag (+ best-effort push) for each LocalStack ECR repo.
 * Tagging on the host is enough for LocalStack ECS sibling RunTask; push needs
 * ECR edge ports (4510–4559) published.
 */
export async function buildAndPublishLocalstackImages(opts: {
  appFiles: Record<string, string>;
  terraformFiles: Record<string, string>;
  region: string;
  endpoint: string;
  tag?: string;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}): Promise<BuildPushResult> {
  const tag = opts.tag ?? 'latest';
  const context = normalizeAppBuildContext(opts.appFiles);
  if (!context) {
    return {
      ok: false,
      targets: [],
      message:
        'ECS is on the diagram but no Dockerfile was sent with Apply. Generate the project (app/Dockerfile) first, then Apply again.',
    };
  }

  const repoNames = parseEcrRepositoryNames(opts.terraformFiles);
  if (repoNames.length === 0) {
    return {
      ok: false,
      targets: [],
      message:
        'ECS task definition present but no aws_ecr_repository in Terraform — connect Task Def → ECR (pulls-image), Generate, then Apply.',
    };
  }

  const contextDir = await writeContextDir(context.files);
  const localTag = `archviz-localstack-build:${tag}`;
  opts.onOutput?.('stdout', `Building image from Dockerfile → ${localTag}\n`);

  try {
    const build = await run(
      'docker',
      ['build', '-f', context.dockerfile, '-t', localTag, '.'],
      { cwd: contextDir },
    );
    opts.onOutput?.('stdout', build.stdout);
    opts.onOutput?.('stderr', build.stderr);
    if (build.code !== 0) {
      return {
        ok: false,
        targets: [],
        message: `docker build failed (exit ${build.code}). Fix the Dockerfile / app and Apply again.`,
      };
    }

    const targets: BuiltImageTarget[] = [];
    for (const repositoryName of repoNames) {
      const repositoryUri =
        (await describeRepositoryUri(repositoryName, opts.region, opts.endpoint)) ??
        fallbackLocalstackEcrUri(repositoryName, opts.region);
      const tagged = `${repositoryUri}:${tag}`;
      opts.onOutput?.('stdout', `Tagging ${tagged}\n`);
      const tagResult = await run('docker', ['tag', localTag, tagged]);
      opts.onOutput?.('stderr', tagResult.stderr);
      if (tagResult.code !== 0) {
        return {
          ok: false,
          targets,
          message: `docker tag failed for ${tagged}`,
        };
      }
      targets.push({ repositoryName, tag, repositoryUri });

      opts.onOutput?.('stdout', `Pushing ${tagged} (optional if host tag is enough for ECS)\n`);
      const push = await run('docker', ['push', tagged]);
      opts.onOutput?.('stdout', push.stdout);
      opts.onOutput?.('stderr', push.stderr);
      if (push.code !== 0) {
        opts.onOutput?.(
          'stderr',
          `Push failed — LocalStack ECS can still use the host-tagged image. Ensure ports 4510–4559 are published if you need a real ECR push.\n`,
        );
      }
    }

    return {
      ok: true,
      targets,
      message: `Built and tagged ${targets.map((t) => `${t.repositoryName}:${t.tag}`).join(', ')} for LocalStack ECS.`,
    };
  } finally {
    await fs.rm(contextDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
