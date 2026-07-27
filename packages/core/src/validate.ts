import type { ResourceRegistry } from '@archviz/schema';
import type { ArchvizDocument } from './document.js';
import type { ConstraintResult } from './diagnostics.js';
import { createConstraintEngine } from './constraints.js';

/**
 * Validate a document against the registry.
 * Same engine the UI uses — one implementation, two callers.
 */
export function validate(
  document: ArchvizDocument,
  registry: ResourceRegistry,
): ConstraintResult {
  return createConstraintEngine(registry).validate(document);
}

export interface ValidatedGraph {
  document: ArchvizDocument;
  result: ConstraintResult;
}

export function toValidatedGraph(
  document: ArchvizDocument,
  registry: ResourceRegistry,
): ValidatedGraph {
  return {
    document,
    result: validate(document, registry),
  };
}
