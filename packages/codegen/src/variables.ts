import type { ArchvizDocument } from '@archviz/core';
import type { FilePlan, HclBlock } from './ast.js';
import { rawValue } from './ast.js';
import { toHclValue } from './materialize.js';

/**
 * Input variables the user must supply at plan/apply time: every `variable`
 * block in the generated plan that has no `default` (e.g. sensitive secret
 * values). The studio sends these to archviz-runner so it can seed
 * terraform.tfvars placeholders instead of letting plan fail.
 */
export function collectRequiredVariables(plan: FilePlan): string[] {
  const names: string[] = [];
  for (const file of plan.files) {
    for (const block of file.blocks) {
      if (block.blockType !== 'variable') continue;
      const name = block.labels[0];
      if (!name) continue;
      if (!block.attributes.some((a) => a.name === 'default')) names.push(name);
    }
  }
  return names;
}

function hclTypeKeyword(value: unknown): string {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'bool';
  return 'string';
}

/**
 * Emits a `variable` block for every property a user has "promoted to
 * variable" via the properties panel (`resource.variableBindings`). The
 * property's current value becomes the variable's default so existing
 * diagrams keep working out of the box, while still letting CI/tfvars
 * override it per environment.
 */
export function buildPromotedVariableBlocks(document: ArchvizDocument): HclBlock[] {
  const blocks: HclBlock[] = [];
  const seen = new Set<string>();

  for (const resource of document.resources) {
    const bindings = resource.variableBindings;
    if (!bindings) continue;
    for (const [propName, varName] of Object.entries(bindings)) {
      if (!varName || seen.has(varName)) continue;
      seen.add(varName);

      const value = resource.properties[propName];
      const defaultValue = toHclValue(value);

      blocks.push({
        blockType: 'variable',
        labels: [varName],
        attributes: [
          { name: 'type', value: rawValue(hclTypeKeyword(value)) },
          ...(defaultValue ? [{ name: 'default', value: defaultValue }] : []),
        ],
        blocks: [],
        comment: `Promoted from ${resource.name}.${propName} — override via terraform.tfvars or TF_VAR_${varName}`,
      });
    }
  }

  return blocks;
}
