import {
  createConstraintEngine,
  type ArchvizDocument,
  type RelationshipInstance,
} from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';

export interface RelationshipOption {
  relationship: string;
  /** Schema connection label when present (e.g. "Writes to"). */
  label: string;
}

/**
 * Relationship kinds the source may use toward the target, validated as if
 * this edge were being created fresh (current edge excluded from duplicates).
 */
export function relationshipOptionsFor(
  registry: ResourceRegistry,
  document: ArchvizDocument,
  rel: RelationshipInstance,
): RelationshipOption[] {
  const source = document.resources.find((r) => r.id === rel.sourceId);
  const target = document.resources.find((r) => r.id === rel.targetId);
  if (!source || !target) return [];

  const engine = createConstraintEngine(registry);
  const withoutCurrent: ArchvizDocument = {
    ...document,
    relationships: document.relationships.filter((r) => r.id !== rel.id),
  };

  const names = registry.possibleRelationships(source.type, target.type);
  const sourceDef = registry.get(source.type);
  const options: RelationshipOption[] = [];

  for (const name of names) {
    if (!engine.canConnect(rel.sourceId, rel.targetId, name, withoutCurrent).ok) continue;
    const rule = sourceDef?.connections.find((c) => c.relationship === name);
    options.push({
      relationship: name,
      label: rule?.label ?? name.replace(/-/g, ' '),
    });
  }

  return options;
}

export function displayLabelForRelationship(
  registry: ResourceRegistry,
  document: ArchvizDocument,
  rel: RelationshipInstance,
): string {
  const source = document.resources.find((r) => r.id === rel.sourceId);
  if (!source) return rel.relationship.replace(/-/g, ' ');
  const rule = registry.get(source.type)?.connections.find((c) => c.relationship === rel.relationship);
  return rule?.label ?? rel.relationship.replace(/-/g, ' ');
}
