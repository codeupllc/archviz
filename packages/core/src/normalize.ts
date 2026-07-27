import type { ResourceRegistry } from '@archviz/schema';
import type { ArchvizDocument } from './document.js';

/**
 * Backfills properties that a resource definition gained after a diagram was
 * saved, using each property's schema default. Without this, adding a new
 * required property (e.g. a Lambda's `function_name`) would make every
 * previously saved diagram invalid until the user retyped it by hand.
 *
 * Only missing keys are filled — values the user actually set are preserved.
 * Returns the same document instance when nothing changed, so callers can use
 * it as a cheap no-op on load.
 */
export function normalizeDocument(
  document: ArchvizDocument,
  registry: ResourceRegistry,
): ArchvizDocument {
  let changed = false;

  const resources = document.resources.map((resource) => {
    const def = registry.get(resource.type);
    if (!def) return resource;

    const missing: Record<string, unknown> = {};
    for (const prop of def.properties) {
      if (prop.default === undefined) continue;
      const current = resource.properties[prop.name];
      if (current === undefined) missing[prop.name] = prop.default;
    }

    if (Object.keys(missing).length === 0) return resource;
    changed = true;
    return { ...resource, properties: { ...missing, ...resource.properties } };
  });

  return changed ? { ...document, resources } : document;
}
