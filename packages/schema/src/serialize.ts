import type { ResourceDefinition, ResourceDefinitionJSON } from './types.js';

/** Serialize resource definitions to a JSON-friendly array. */
export function serializeDefinitions(
  definitions: readonly ResourceDefinition[],
): ResourceDefinitionJSON[] {
  return JSON.parse(JSON.stringify(definitions)) as ResourceDefinitionJSON[];
}

/** Deserialize JSON definitions (same shape — AttrExpr objects preserved). */
export function deserializeDefinitions(
  json: ResourceDefinitionJSON[],
): ResourceDefinition[] {
  return json;
}

/** Pretty-print definitions as JSON string. */
export function definitionsToJsonString(
  definitions: readonly ResourceDefinition[],
  space = 2,
): string {
  return JSON.stringify(serializeDefinitions(definitions), null, space);
}

/** Parse a JSON string of definitions. */
export function definitionsFromJsonString(json: string): ResourceDefinition[] {
  const parsed = JSON.parse(json) as ResourceDefinitionJSON[];
  return deserializeDefinitions(parsed);
}
