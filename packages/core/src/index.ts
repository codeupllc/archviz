export type {
  ResourceLayout,
  ResourceInstance,
  RelationshipInstance,
  ArchvizDocument,
} from './document.js';

export {
  createEmptyDocument,
  touchDocument,
  findResource,
  findRelationship,
  childrenOf,
  relationshipsFrom,
  relationshipsTo,
} from './document.js';

export type {
  DiagnosticSeverity,
  DiagnosticTier,
  Diagnostic,
  ConstraintResult,
} from './diagnostics.js';

export {
  ok,
  fail,
  mergeResults,
  hasStructuralErrors,
  hasErrors,
} from './diagnostics.js';

export type { ConstraintEngine } from './constraints.js';
export { createConstraintEngine } from './constraints.js';

export type { ValidatedGraph } from './validate.js';
export { validate, toValidatedGraph } from './validate.js';

export { normalizeDocument } from './normalize.js';
