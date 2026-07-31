import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal .env loader (no dependency). Does not override variables already
 * set in the process environment.
 */
export function loadEnvFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

/** Load `.env` from cwd, Archviz root, and sibling archviz-enterprise (if present). */
export function loadRunnerEnv(): string[] {
  const loaded: string[] = [];
  const here = path.dirname(fileURLToPath(import.meta.url));
  const archvizRoot = path.resolve(here, '../../..'); // packages/runner/dist → repo root
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(archvizRoot, '.env'),
    path.join(archvizRoot, '../archviz-enterprise/.env'),
  ];
  const seen = new Set<string>();
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (loadEnvFile(resolved)) loaded.push(resolved);
  }
  return loaded;
}
