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
const VARIABLE_DECLARATION = /^\s*variable\s+"([^"]+)"/gm;

/** Comment stamped on placeholder lines so the runner can recognise its own later. */
const PLACEHOLDER_MARKER = 'placeholder created by archviz-runner';

export function isValidVariableName(name: string): boolean {
  return VALID_VARIABLE_NAME.test(name);
}

/** Input variables the generated config declares, used to spot tfvars entries that no longer correspond to anything. */
export function collectDeclaredVariables(files: Record<string, string>): Set<string> {
  const declared = new Set<string>();
  for (const [name, content] of Object.entries(files)) {
    if (!name.endsWith('.tf')) continue;
    for (const match of content.matchAll(VARIABLE_DECLARATION)) {
      if (match[1]) declared.add(match[1]);
    }
  }
  return declared;
}

export interface TfvarsSync {
  created: string[];
  removed: string[];
}

/**
 * Reconciles the workspace's terraform.tfvars with the config's input
 * variables: appends a placeholder for every required variable that has no
 * assignment yet, and drops placeholder lines the runner itself created for
 * variables the config no longer declares. Without the second half, renaming a
 * promoted property leaves the old line behind and every later plan reports
 * "Value for undeclared variable".
 *
 * Lines the runner didn't stamp are never removed, so a value the user filled
 * in survives even once its variable is gone — losing a real secret to make a
 * warning go away is the worse trade.
 */
export async function syncPlaceholderVariables(
  dir: string,
  requiredVariables: string[],
  declaredVariables: Set<string> | null = null,
): Promise<TfvarsSync> {
  const tfvarsPath = path.join(dir, TFVARS_FILE);
  let existing = '';
  try {
    existing = await fs.readFile(tfvarsPath, 'utf8');
  } catch {
    // no tfvars yet — written below only if something needs seeding
  }

  const lines = existing === '' ? [] : existing.replace(/\n$/, '').split('\n');

  // Anything still required counts as live even if it is missing from the
  // declared set, so the two inputs disagreeing can never make a placeholder
  // get pruned and immediately re-seeded.
  const required = new Set(requiredVariables);
  const removed: string[] = [];
  const kept = lines.filter((line) => {
    const name = TFVARS_ASSIGNMENT.exec(line)?.[1];
    if (!name || !declaredVariables) return true;
    if (declaredVariables.has(name) || required.has(name)) return true;
    if (!line.includes(PLACEHOLDER_MARKER)) return true;
    removed.push(name);
    return false;
  });

  const assigned = new Set<string>();
  for (const line of kept) {
    const name = TFVARS_ASSIGNMENT.exec(line)?.[1];
    if (name) assigned.add(name);
  }

  const created = requiredVariables.filter((name) => !assigned.has(name));
  if (created.length === 0 && removed.length === 0) return { created, removed };

  const next = [
    ...kept,
    ...created.map(
      (name) => `${name} = "${PLACEHOLDER_VALUE}" # ${PLACEHOLDER_MARKER} — replace before apply`,
    ),
  ];
  await fs.writeFile(tfvarsPath, next.length === 0 ? '' : `${next.join('\n')}\n`, 'utf8');
  return { created, removed };
}
