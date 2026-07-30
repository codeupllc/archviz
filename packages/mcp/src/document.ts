import type { ArchvizDocument } from '@archviz/core';
import { createEmptyDocument, normalizeDocument } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import type { DiagramPatch } from './types.js';

export function applyDiagramPatch(
  doc: ArchvizDocument,
  patch: DiagramPatch,
  registry: ResourceRegistry,
): ArchvizDocument {
  const resources = new Map(doc.resources.map((r) => [r.id, r]));
  for (const id of patch.removeResourceIds ?? []) resources.delete(id);
  for (const r of patch.upsertResources ?? []) resources.set(r.id, r);

  const relationships = new Map(doc.relationships.map((r) => [r.id, r]));
  for (const id of patch.removeRelationshipIds ?? []) relationships.delete(id);
  for (const r of patch.upsertRelationships ?? []) relationships.set(r.id, r);

  const next: ArchvizDocument = {
    ...doc,
    meta: {
      ...doc.meta,
      ...patch.meta,
      updatedAt: new Date().toISOString(),
    },
    resources: [...resources.values()],
    relationships: [...relationships.values()],
  };
  return normalizeDocument(next, registry);
}

export function emptyNamed(name: string): ArchvizDocument {
  return createEmptyDocument(name);
}
