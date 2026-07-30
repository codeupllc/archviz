import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { ArchvizDocument } from '@archviz/core';
import { normalizeDocument } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { applyDiagramPatch, emptyNamed } from './document.js';
import type { DiagramRecord, DiagramStore, ProjectSummary } from './types.js';

const META = '.archviz-project.json';
const DIAGRAM = 'diagram.json';
const registry = createAwsRegistry();

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * File-backed store: `<root>/<projectId>/diagram.json` (+ optional meta).
 * `ARCHVIZ_PROJECTS_DIR` overrides the root (default: ./projects).
 */
export function createFilesystemDiagramStore(
  root = process.env.ARCHVIZ_PROJECTS_DIR ?? resolve(process.cwd(), 'projects'),
): DiagramStore {
  ensureDir(root);

  return {
    async list(): Promise<ProjectSummary[]> {
      if (!existsSync(root)) return [];
      const out: ProjectSummary[] = [];
      for (const entry of readdirSync(root)) {
        const dir = join(root, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const meta = readJson<{ id?: string; name?: string; diagramRevision?: number; slug?: string }>(
          join(dir, META),
        );
        const doc = readJson<ArchvizDocument>(join(dir, DIAGRAM));
        if (!doc && !meta) continue;
        out.push({
          projectId: meta?.id ?? entry,
          name: meta?.name ?? doc?.meta.name ?? entry,
          revision: meta?.diagramRevision ?? (doc ? 1 : 0),
          slug: meta?.slug ?? entry,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async get(projectId: string): Promise<DiagramRecord | null> {
      const dir = resolveProjectDir(root, projectId);
      if (!dir) return null;
      const meta = readJson<{ id?: string; name?: string; diagramRevision?: number; slug?: string }>(
        join(dir, META),
      );
      const raw = readJson<ArchvizDocument>(join(dir, DIAGRAM));
      if (!raw) {
        if (!meta) return null;
        const document = normalizeDocument(emptyNamed(meta.name ?? projectId), registry);
        return {
          projectId: meta.id ?? projectId,
          document,
          revision: meta.diagramRevision ?? 0,
          projectPath: dir,
        };
      }
      return {
        projectId: meta?.id ?? projectId,
        document: normalizeDocument(raw, registry),
        revision: meta?.diagramRevision ?? 1,
        projectPath: dir,
      };
    },

    async apply(opts): Promise<DiagramRecord> {
      const existing = await this.get(opts.projectId);
      let dir = existing?.projectPath ?? join(root, slugify(opts.projectId));
      // Prefer slug folder when meta already points elsewhere
      const byMeta = findDirByProjectId(root, opts.projectId);
      if (byMeta) dir = byMeta;
      ensureDir(dir);

      const base =
        existing?.document ??
        emptyNamed(opts.document?.meta.name ?? opts.patch?.meta?.name ?? opts.projectId);

      let document: ArchvizDocument;
      if (opts.document) {
        document = normalizeDocument(opts.document, registry);
      } else if (opts.patch) {
        document = applyDiagramPatch(base, opts.patch, registry);
      } else {
        throw new Error('apply requires document or patch');
      }

      const revision = (existing?.revision ?? 0) + 1;
      writeFileSync(join(dir, DIAGRAM), `${JSON.stringify(document, null, 2)}\n`, 'utf8');

      const prevMeta = readJson<Record<string, unknown>>(join(dir, META)) ?? {};
      const meta = {
        ...prevMeta,
        id: opts.projectId,
        name: document.meta.name,
        slug: (prevMeta.slug as string | undefined) ?? slugify(document.meta.name || opts.projectId),
        updatedAt: new Date().toISOString(),
        diagramRevision: revision,
        language: (prevMeta.language as string | undefined) ?? 'go',
        notes: (prevMeta.notes as string[] | undefined) ?? [],
      };
      writeFileSync(join(dir, META), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

      return {
        projectId: opts.projectId,
        document,
        revision,
        projectPath: dir,
      };
    },
  };
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function findDirByProjectId(root: string, projectId: string): string | null {
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const meta = readJson<{ id?: string }>(join(dir, META));
    if (meta?.id === projectId) return dir;
    if (entry === projectId) return dir;
  }
  return null;
}

function resolveProjectDir(root: string, projectId: string): string | null {
  return findDirByProjectId(root, projectId);
}
