export type {
  HclValue,
  HclAttribute,
  HclBlock,
  FilePlan,
} from './ast.js';

export {
  stringValue,
  numberValue,
  boolValue,
  traversal,
  listValue,
  nullValue,
  rawValue,
} from './ast.js';

export { sanitizeIdentifier, allocateNames } from './names.js';
export { printHcl, printFilePlan } from './printer.js';

export type {
  Materializer,
  MaterializerContext,
  MaterializerResult,
  CategorizedBlock,
} from './materialize.js';

export {
  registerMaterializer,
  getMaterializer,
  registerBuiltinMaterializers,
  buildResourceBlock,
  applyMaterializers,
} from './materialize.js';

export type { EmitterContext, EmitterResult, ResourceEmitter } from './emit.js';
export { registerResourceEmitter, getResourceEmitter, applyEmitters } from './emit.js';

export type { GenerateOptions, GenerateResult, GenerateLayout } from './generate.js';
export { generate, generateMainTf, topoSort, categoryFile } from './generate.js';

export type { DirectoryExportOptions, DirectoryExportResult } from './directory-export.js';
export { buildDirectoryExport } from './directory-export.js';

export {
  registerAwsMaterializers,
  sgRulePairMaterializer,
  secretValueRefMaterializer,
  sqsIamMaterializer,
  apiIamMaterializer,
  snsSqsSubscriptionMaterializer,
} from './aws-materializers.js';

export { registerAwsEmitters, secretValueRef } from './aws-emitters.js';
export { buildPromotedVariableBlocks, collectRequiredVariables } from './variables.js';
export { buildAllResourcesDocument } from './demo-fixture.js';
export { buildDefaultOutputs } from './outputs.js';
