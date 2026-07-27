import type { ResourceDefinition } from './types.js';

/**
 * Identity helper that provides full TypeScript checking for resource
 * definitions authored in provider packages.
 */
export function defineResource<T extends ResourceDefinition>(definition: T): T {
  validateDefinition(definition);
  return definition;
}

function validateDefinition(def: ResourceDefinition): void {
  if (!def.id || !def.id.includes('/')) {
    throw new Error(`Resource id must be provider/name (got "${def.id}")`);
  }
  if (!def.provider) {
    throw new Error(`Resource ${def.id}: provider is required`);
  }
  if (!def.display?.label || !def.display?.icon || !def.display?.category || !def.display?.kind) {
    throw new Error(`Resource ${def.id}: display.label, icon, category, and kind are required`);
  }
  if (!def.terraform?.resourceType) {
    throw new Error(`Resource ${def.id}: terraform.resourceType is required`);
  }
  if (!Array.isArray(def.properties)) {
    throw new Error(`Resource ${def.id}: properties must be an array`);
  }
  if (!Array.isArray(def.connections)) {
    throw new Error(`Resource ${def.id}: connections must be an array`);
  }
  if (!def.nesting || !Array.isArray(def.nesting.allowedParents)) {
    throw new Error(`Resource ${def.id}: nesting.allowedParents must be an array`);
  }

  const propNames = new Set<string>();
  for (const p of def.properties) {
    if (propNames.has(p.name)) {
      throw new Error(`Resource ${def.id}: duplicate property "${p.name}"`);
    }
    propNames.add(p.name);
    if (p.type === 'enum' && (!p.enumValues || p.enumValues.length === 0)) {
      throw new Error(`Resource ${def.id}: enum property "${p.name}" requires enumValues`);
    }
  }

  const relNames = new Set<string>();
  for (const c of def.connections) {
    if (relNames.has(c.relationship)) {
      throw new Error(`Resource ${def.id}: duplicate relationship "${c.relationship}"`);
    }
    relNames.add(c.relationship);
    if (!c.targets || c.targets.length === 0) {
      throw new Error(`Resource ${def.id}: connection "${c.relationship}" needs targets`);
    }
    if (!c.materialize?.strategy) {
      throw new Error(`Resource ${def.id}: connection "${c.relationship}" needs materialize.strategy`);
    }
  }
}
