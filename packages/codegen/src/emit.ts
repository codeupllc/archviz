import type { ArchvizDocument, ResourceInstance } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import type { HclAttribute, HclBlock } from './ast.js';

/**
 * Resource emitters produce extra Terraform derived purely from a resource's
 * own properties/relationships (no generic ConnectionRule needed) — e.g. an
 * ECS Task Definition's synthesized `container_definitions` JSON plus a
 * companion CloudWatch Log Group. This keeps `ResourceDefinition` itself
 * JSON-serializable; provider-specific logic lives in this side-table,
 * mirroring the `materialize.ts` materializer registry.
 */
export interface EmitterContext {
  document: ArchvizDocument;
  registry: ResourceRegistry;
  names: Map<string, string>;
  region: string;
}

export interface EmitterResult {
  /** Attributes to merge/overwrite onto this resource's own primary block. */
  attributes?: HclAttribute[];
  /** Nested blocks to append inside this resource's own primary block (e.g. vpc_config). */
  blocks?: HclBlock[];
  /** Extra standalone sibling blocks (companion resources, variables, etc). */
  extraBlocks?: HclBlock[];
  /** Comment prepended to this resource's own primary block (e.g. warnings). */
  comment?: string;
}

export type ResourceEmitter = (
  resource: ResourceInstance,
  ctx: EmitterContext,
) => EmitterResult;

const emitters = new Map<string, ResourceEmitter>();

export function registerResourceEmitter(typeId: string, fn: ResourceEmitter): void {
  emitters.set(typeId, fn);
}

export function getResourceEmitter(typeId: string): ResourceEmitter | undefined {
  return emitters.get(typeId);
}

/**
 * Runs the registered emitter (if any) for a resource, patching its primary
 * block's attributes in place and returning any extra sibling blocks.
 */
export interface CategorizedBlock {
  block: HclBlock;
  category: string;
  ownerResourceId: string;
}

export function applyEmitters(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  names: Map<string, string>,
  region: string,
  blocksByResourceId: Map<string, HclBlock>,
): CategorizedBlock[] {
  const extra: CategorizedBlock[] = [];
  for (const resource of document.resources) {
    const emitter = getResourceEmitter(resource.type);
    if (!emitter) continue;
    const result = emitter(resource, { document, registry, names, region });
    const category = registry.get(resource.type)?.display.category ?? 'compute';

    if (result.attributes) {
      const block = blocksByResourceId.get(resource.id);
      if (block) {
        for (const attr of result.attributes) {
          const idx = block.attributes.findIndex((a) => a.name === attr.name);
          if (idx >= 0) block.attributes[idx] = attr;
          else block.attributes.push(attr);
        }
      }
    }

    if (result.blocks) {
      const block = blocksByResourceId.get(resource.id);
      if (block) block.blocks.push(...result.blocks);
    }

    if (result.comment) {
      const block = blocksByResourceId.get(resource.id);
      if (block) {
        block.comment = block.comment ? `${block.comment}\n${result.comment}` : result.comment;
      }
    }

    if (result.extraBlocks) {
      for (const block of result.extraBlocks) {
        extra.push({ block, category, ownerResourceId: resource.id });
      }
    }
  }
  return extra;
}
