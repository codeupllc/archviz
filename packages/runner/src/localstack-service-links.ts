import { promises as fs } from 'node:fs';
import path from 'node:path';
import { discoverLocalstackEcsServiceUrl } from './ecs-service-url.js';
import { projectSlug } from './workspace.js';

export interface ServiceLinks {
  url: string;
  swaggerUrl: string;
  webUrl: string;
  projectSlug: string;
  updatedAt: string;
}

const LINKS_FILE = '.archviz-service.json';

function workspaceLocalstackDir(cwd: string, projectName: string | null | undefined): string {
  if (!projectName?.trim()) return path.join(cwd, 'localstack');
  return path.join(cwd, projectSlug(projectName), 'localstack');
}

export async function writeServiceLinks(
  workspaceDir: string,
  links: { url: string; swaggerUrl: string; webUrl: string; projectSlug: string },
): Promise<void> {
  const payload: ServiceLinks = {
    ...links,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(workspaceDir, LINKS_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function clearServiceLinks(workspaceDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(workspaceDir, LINKS_FILE));
  } catch {
    // ignore missing
  }
}

export async function readServiceLinks(workspaceDir: string): Promise<ServiceLinks | null> {
  try {
    const raw = await fs.readFile(path.join(workspaceDir, LINKS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ServiceLinks>;
    if (
      typeof parsed.url === 'string' &&
      typeof parsed.swaggerUrl === 'string' &&
      typeof parsed.webUrl === 'string'
    ) {
      return {
        url: parsed.url,
        swaggerUrl: parsed.swaggerUrl,
        webUrl: parsed.webUrl,
        projectSlug: typeof parsed.projectSlug === 'string' ? parsed.projectSlug : '',
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Newest persisted links under terraform-out (survives runner restart). */
export async function findLatestServiceLinks(cwd: string): Promise<ServiceLinks | null> {
  let best: ServiceLinks | null = null;
  const candidates = [path.join(cwd, 'localstack')];
  try {
    const entries = await fs.readdir(cwd, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        candidates.push(path.join(cwd, ent.name, 'localstack'));
      }
    }
  } catch {
    // ignore
  }
  for (const dir of candidates) {
    const links = await readServiceLinks(dir);
    if (!links) continue;
    if (!best || (links.updatedAt && links.updatedAt > (best.updatedAt || ''))) {
      best = links;
    }
  }
  return best;
}

async function readTfFiles(workspaceDir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = await fs.readdir(workspaceDir);
  } catch {
    return files;
  }
  for (const name of names) {
    if (!name.endsWith('.tf')) continue;
    try {
      files[name] = await fs.readFile(path.join(workspaceDir, name), 'utf8');
    } catch {
      // skip
    }
  }
  return files;
}

/**
 * Restore LocalStack ECS URLs after runner restart / Studio refresh.
 * Prefers persisted Apply result, then live rediscovery from terraform on disk.
 */
export async function resolveLocalstackServiceLinks(opts: {
  cwd: string;
  projectName?: string | null;
  region: string;
  endpoint: string;
  /** When true, skip cache and ask ECS/docker again. */
  rediscover?: boolean;
}): Promise<{ ok: boolean; links: ServiceLinks | null; message: string; source: string }> {
  const workspaceDir = workspaceLocalstackDir(opts.cwd, opts.projectName);
  const slug = opts.projectName ? projectSlug(opts.projectName) : '';

  if (!opts.rediscover) {
    // Never cross-contaminate projects: only fall back to "latest" when no
    // project was specified (legacy single-workspace callers).
    const cached =
      (await readServiceLinks(workspaceDir)) ??
      (opts.projectName?.trim() ? null : await findLatestServiceLinks(opts.cwd));
    if (cached) {
      return {
        ok: true,
        links: cached,
        message: `Restored LocalStack URLs from last Apply (${cached.url})`,
        source: 'cache',
      };
    }
  }

  const tfFiles = await readTfFiles(workspaceDir);
  if (Object.keys(tfFiles).length === 0) {
    if (!opts.projectName?.trim()) {
      const latest = await findLatestServiceLinks(opts.cwd);
      if (latest) {
        return {
          ok: true,
          links: latest,
          message: `Restored LocalStack URLs from last Apply (${latest.url})`,
          source: 'cache',
        };
      }
    }
    return {
      ok: false,
      links: null,
      message: opts.projectName?.trim()
        ? `No LocalStack Apply found for "${opts.projectName.trim()}" — run LocalStack Apply for this diagram.`
        : 'No LocalStack workspace terraform found — run LocalStack Apply once.',
      source: 'none',
    };
  }

  const discovered = await discoverLocalstackEcsServiceUrl({
    terraformFiles: tfFiles,
    region: opts.region,
    endpoint: opts.endpoint,
    timeoutMs: 12_000,
    skipForceRedeploy: true,
  });
  if (discovered.ok && discovered.url && discovered.swaggerUrl && discovered.webUrl) {
    const links: ServiceLinks = {
      url: discovered.url,
      swaggerUrl: discovered.swaggerUrl,
      webUrl: discovered.webUrl,
      projectSlug: slug,
      updatedAt: new Date().toISOString(),
    };
    await writeServiceLinks(workspaceDir, links);
    return {
      ok: true,
      links,
      message: discovered.message,
      source: 'rediscover',
    };
  }

  const fallback = await readServiceLinks(workspaceDir);
  if (fallback) {
    return {
      ok: true,
      links: fallback,
      message: `ECS rediscovery failed (${discovered.message}); using last Apply URLs`,
      source: 'cache',
    };
  }

  return {
    ok: false,
    links: null,
    message: discovered.message || 'No LocalStack ECS URL available — Apply first.',
    source: 'none',
  };
}

export { workspaceLocalstackDir };
