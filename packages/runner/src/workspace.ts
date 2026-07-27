import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectRef {
  id?: string;
  name: string;
}

/** Manifest the runner keeps in each workspace so it can tell its own generated files apart from the user's (state, tfvars, backend config). */
export interface WorkspaceManifest {
  project: { id: string | null; name: string };
  files: string[];
}

const MANIFEST_FILE = '.archviz-manifest.json';
const TFVARS_FILE = 'terraform.tfvars';
export const PLACEHOLDER_VALUE = 'CHANGEME';

/** "My App / Staging" -> "my-app-staging" — a filesystem-safe workspace folder name. */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'diagram';
}

export async function readManifest(dir: string): Promise<WorkspaceManifest | null> {
  try {
    const raw = await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8');
    const parsed = JSON.parse(raw) as WorkspaceManifest;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeManifest(dir: string, manifest: WorkspaceManifest): Promise<void> {
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Deletes files the runner itself wrote on a previous plan that are no longer
 * part of the new file map (e.g. database.tf after the last database node was
 * removed, or main.tf after switching to the by-category layout). Files the
 * runner didn't write are never touched. Returns the deleted paths.
 */
export async function removeStaleGeneratedFiles(
  dir: string,
  previous: WorkspaceManifest | null,
  newFiles: Record<string, string>,
): Promise<string[]> {
  if (!previous) return [];
  const removed: string[] = [];
  for (const stale of previous.files) {
    if (stale in newFiles) continue;
    try {
      await fs.unlink(path.join(dir, stale));
      removed.push(stale);
    } catch {
      // already gone — nothing to clean
    }
  }
  return removed;
}

const TFVARS_ASSIGNMENT = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=/;
const VALID_VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isValidVariableName(name: string): boolean {
  return VALID_VARIABLE_NAME.test(name);
}

/**
 * Ensures every required input variable has an entry in the workspace's
 * terraform.tfvars, appending placeholders for missing ones so plan can run.
 * Existing assignments are never modified. Returns the names created.
 */
export async function ensurePlaceholderVariables(
  dir: string,
  requiredVariables: string[],
): Promise<string[]> {
  if (requiredVariables.length === 0) return [];

  const tfvarsPath = path.join(dir, TFVARS_FILE);
  let existing = '';
  try {
    existing = await fs.readFile(tfvarsPath, 'utf8');
  } catch {
    // no tfvars yet — will be created
  }

  const assigned = new Set<string>();
  for (const line of existing.split('\n')) {
    const match = TFVARS_ASSIGNMENT.exec(line);
    if (match?.[1]) assigned.add(match[1]);
  }

  const missing = requiredVariables.filter((name) => !assigned.has(name));
  if (missing.length === 0) return [];

  const lines = missing.map(
    (name) => `${name} = "${PLACEHOLDER_VALUE}" # placeholder created by archviz-runner — replace before apply`,
  );
  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  await fs.writeFile(tfvarsPath, `${prefix}${lines.join('\n')}\n`, 'utf8');
  return missing;
}
