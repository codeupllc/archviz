/** Sanitize a user label into a valid HCL identifier. */
export function sanitizeIdentifier(name: string): string {
  let s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'resource';
  if (/^[0-9]/.test(s)) s = `r_${s}`;
  return s;
}

/**
 * Allocate unique HCL local names, stable across regenerations via resource UUID.
 * Returns map of resourceId -> hclName.
 */
export function allocateNames(
  resources: { id: string; name: string }[],
): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();

  // Sort by id for stability
  const sorted = [...resources].sort((a, b) => a.id.localeCompare(b.id));

  for (const r of sorted) {
    let base = sanitizeIdentifier(r.name);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${n}`;
      n += 1;
    }
    used.add(candidate);
    result.set(r.id, candidate);
  }

  return result;
}
