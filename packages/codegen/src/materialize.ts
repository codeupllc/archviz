import type {
  ArchvizDocument,
  ResourceInstance,
  RelationshipInstance,
} from '@archviz/core';
import type {
  AttrExpr,
  ResourceDefinition,
  ResourceRegistry,
  ConnectionRule,
  MaterializeStrategy,
} from '@archviz/schema';
import type { HclAttribute, HclBlock, HclValue } from './ast.js';
import {
  stringValue,
  numberValue,
  boolValue,
  traversal,
  listValue,
} from './ast.js';
import { allocateNames } from './names.js';

export type Materializer = (ctx: MaterializerContext) => MaterializerResult;

export interface MaterializerContext {
  relationship: RelationshipInstance;
  rule: ConnectionRule;
  source: ResourceInstance;
  target: ResourceInstance;
  sourceDef: ResourceDefinition;
  targetDef: ResourceDefinition;
  names: Map<string, string>;
  document: ArchvizDocument;
  registry: ResourceRegistry;
}

export interface MaterializerResult {
  /** Attributes to merge into the source resource block (keyed by attribute name). */
  sourceAttributes?: HclAttribute[];
  /** Attributes to merge into the target resource block. */
  targetAttributes?: HclAttribute[];
  /** Extra blocks to emit (e.g. attachments, SG rules). */
  extraBlocks?: HclBlock[];
  comment?: string;
}

const materializers = new Map<string, Materializer>();

export function registerMaterializer(strategy: string, fn: Materializer): void {
  materializers.set(strategy, fn);
}

export function getMaterializer(strategy: string): Materializer | undefined {
  return materializers.get(strategy);
}

function toHclValue(value: unknown): HclValue | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return stringValue(value);
  if (typeof value === 'number') return numberValue(value);
  if (typeof value === 'boolean') return boolValue(value);
  if (Array.isArray(value)) {
    const items = value.map(toHclValue).filter((v): v is HclValue => v !== null);
    return listValue(items);
  }
  return stringValue(String(value));
}

function resolveExpr(
  expr: AttrExpr,
  resource: ResourceInstance,
  document: ArchvizDocument,
  names: Map<string, string>,
  registry: ResourceRegistry,
): HclValue | null {
  switch (expr.kind) {
    case 'prop': {
      const varName = resource.variableBindings?.[expr.name];
      if (varName) return traversal('var', varName);
      return toHclValue(resource.properties[expr.name]);
    }
    case 'literal':
      return toHclValue(expr.value);
    case 'parent': {
      if (!resource.parentId) return null;
      let current: ResourceInstance | undefined = resource;
      // Walk up until matching type
      while (current?.parentId) {
        const parent = document.resources.find((r) => r.id === current!.parentId);
        if (!parent) return null;
        if (parent.type === expr.type) {
          const parentName = names.get(parent.id);
          const parentDef = registry.require(parent.type);
          if (!parentName) return null;
          return traversal(parentDef.terraform.resourceType, parentName, expr.attr);
        }
        current = parent;
      }
      return null;
    }
    case 'rel': {
      const rels = document.relationships.filter(
        (r) => r.sourceId === resource.id && r.relationship === expr.relationship,
      );
      if (rels.length === 0) return null;
      const values: HclValue[] = [];
      for (const rel of rels) {
        const target = document.resources.find((r) => r.id === rel.targetId);
        if (!target) continue;
        const targetName = names.get(target.id);
        const targetDef = registry.get(target.type);
        if (!targetName || !targetDef) continue;
        values.push(
          traversal(targetDef.terraform.resourceType, targetName, expr.attr),
        );
      }
      if (values.length === 0) return null;
      if (expr.many) return listValue(values);
      return values[0] ?? null;
    }
    case 'self': {
      const name = names.get(resource.id);
      const def = registry.get(resource.type);
      if (!name || !def) return null;
      return traversal(def.terraform.resourceType, name, expr.attr);
    }
  }
}

function strategyName(m: MaterializeStrategy): string {
  return m.strategy;
}

/** Built-in materializers registered by default. */
export function registerBuiltinMaterializers(): void {
  registerMaterializer('attribute', (ctx) => {
    const strategy = ctx.rule.materialize as { strategy: 'attribute'; attribute: string };
    const targetName = ctx.names.get(ctx.target.id);
    if (!targetName) return {};
    const attrName = strategy.attribute;
    const value = traversal(ctx.targetDef.terraform.resourceType, targetName, 'id');

    // If the attribute is already a list-style (ends with _ids), collect all
    const existingRels = ctx.document.relationships.filter(
      (r) =>
        r.sourceId === ctx.source.id &&
        r.relationship === ctx.relationship.relationship,
    );
    if (attrName.endsWith('_ids') || existingRels.length > 1) {
      const values: HclValue[] = [];
      for (const rel of existingRels) {
        const t = ctx.document.resources.find((r) => r.id === rel.targetId);
        if (!t) continue;
        const n = ctx.names.get(t.id);
        const d = ctx.registry.get(t.type);
        if (!n || !d) continue;
        values.push(traversal(d.terraform.resourceType, n, 'id'));
      }
      return {
        sourceAttributes: [{ name: attrName, value: listValue(values) }],
      };
    }

    return {
      sourceAttributes: [{ name: attrName, value }],
    };
  });

  registerMaterializer('resource', (ctx) => {
    const strategy = ctx.rule.materialize as { strategy: 'resource'; via: string };
    const sourceName = ctx.names.get(ctx.source.id);
    const targetName = ctx.names.get(ctx.target.id);
    if (!sourceName || !targetName) return {};

    const via = strategy.via;
    const attachmentName = `${sourceName}_to_${targetName}`;

    // Generic attachment block — provider-specific shapes handled by custom materializers
    if (via === 'aws_lb_listener_rule' || via === 'aws_lb_target_group_attachment') {
      return {
        extraBlocks: [
          {
            blockType: 'resource',
            labels: ['aws_lb_target_group_attachment', attachmentName],
            attributes: [
              {
                name: 'target_group_arn',
                value: traversal(
                  ctx.targetDef.terraform.resourceType === 'aws_lb_target_group'
                    ? 'aws_lb_target_group'
                    : ctx.targetDef.terraform.resourceType,
                  // For routes-to, target is TG; for attachment from TG to instance, adjust
                  ctx.targetDef.terraform.resourceType === 'aws_lb_target_group'
                    ? targetName
                    : targetName,
                  'arn',
                ),
              },
              {
                name: 'target_id',
                value:
                  ctx.sourceDef.terraform.resourceType === 'aws_lb'
                    ? traversal(ctx.targetDef.terraform.resourceType, targetName, 'id')
                    : traversal(ctx.targetDef.terraform.resourceType, targetName, 'id'),
              },
            ],
            blocks: [],
            comment: `${ctx.relationship.relationship}: ${ctx.source.name} → ${ctx.target.name}`,
          },
        ],
      };
    }

    return {
      extraBlocks: [
        {
          blockType: 'resource',
          labels: [via, attachmentName],
          attributes: [
            {
              name: 'source_id',
              value: traversal(ctx.sourceDef.terraform.resourceType, sourceName, 'id'),
            },
            {
              name: 'target_id',
              value: traversal(ctx.targetDef.terraform.resourceType, targetName, 'id'),
            },
          ],
          blocks: [],
          comment: `${ctx.relationship.relationship}: ${ctx.source.name} → ${ctx.target.name}`,
        },
      ],
    };
  });

  registerMaterializer('annotation', (ctx) => ({
    comment: `annotation: ${ctx.source.name} ${ctx.relationship.relationship} ${ctx.target.name} (no HCL emitted)`,
  }));

  // Placeholder — provider-aws registers the real sg-rule-pair
  registerMaterializer('sg-rule-pair', (ctx) => {
    const custom = materializers.get('sg-rule-pair:aws');
    if (custom) return custom(ctx);
    return {
      comment: `sg-rule-pair: ${ctx.source.name} → ${ctx.target.name} (requires SGs on both ends)`,
    };
  });
}

registerBuiltinMaterializers();

export interface EmitContext {
  document: ArchvizDocument;
  registry: ResourceRegistry;
  names: Map<string, string>;
}

export function buildResourceBlock(
  resource: ResourceInstance,
  ctx: EmitContext,
): HclBlock | null {
  const def = ctx.registry.get(resource.type);
  if (!def) return null;
  const name = ctx.names.get(resource.id);
  if (!name) return null;

  const attributes: HclAttribute[] = [];
  for (const [attrName, expr] of Object.entries(def.terraform.attributes)) {
    const value = resolveExpr(expr, resource, ctx.document, ctx.names, ctx.registry);
    if (value === null || value.kind === 'null') continue;
    attributes.push({ name: attrName, value });
  }

  // tags with Name
  attributes.push({
    name: 'tags',
    value: {
      kind: 'raw',
      code: `{\n    Name = "${resource.name.replace(/"/g, '\\"')}"\n  }`,
    },
  });

  const blocks: HclBlock[] = [];
  for (const nested of def.terraform.blocks ?? []) {
    const nestedAttributes: HclAttribute[] = [];
    let resolvedAny = false;
    for (const [attrName, expr] of Object.entries(nested.attributes)) {
      const value = resolveExpr(expr, resource, ctx.document, ctx.names, ctx.registry);
      if (value === null || value.kind === 'null') continue;
      if (expr.kind === 'rel' || expr.kind === 'parent') resolvedAny = true;
      nestedAttributes.push({ name: attrName, value });
    }
    // A block whose connection-sourced attributes all resolved to nothing is
    // an incomplete block (e.g. network_configuration with no subnets), which
    // Terraform rejects — skip it rather than emitting something invalid.
    const hasRelSources = Object.values(nested.attributes).some(
      (expr) => expr.kind === 'rel' || expr.kind === 'parent',
    );
    if (nestedAttributes.length === 0 || (hasRelSources && !resolvedAny)) continue;
    blocks.push({
      blockType: nested.blockType,
      labels: [],
      attributes: nestedAttributes,
      blocks: [],
    });
  }

  return {
    blockType: 'resource',
    labels: [def.terraform.resourceType, name],
    attributes,
    blocks,
  };
}

export interface CategorizedBlock {
  block: HclBlock;
  /** The category of the resource that "owns" this extra block, used to
   * bucket it into the same file as its owner during multi-file layout. */
  category: string;
  /** The resource id this block was generated on behalf of (the relationship's source). */
  ownerResourceId: string;
}

export function applyMaterializers(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  names: Map<string, string>,
  blocksByResourceId: Map<string, HclBlock>,
): CategorizedBlock[] {
  const extra: CategorizedBlock[] = [];
  const processedAttributeKeys = new Set<string>();

  for (const rel of document.relationships) {
    const source = document.resources.find((r) => r.id === rel.sourceId);
    const target = document.resources.find((r) => r.id === rel.targetId);
    if (!source || !target) continue;
    const sourceDef = registry.get(source.type);
    const targetDef = registry.get(target.type);
    if (!sourceDef || !targetDef) continue;

    const rule = registry.findConnectionRule(source.type, rel.relationship, target.type);
    if (!rule) continue;

    const mat = getMaterializer(strategyName(rule.materialize));
    if (!mat) continue;

    const result = mat({
      relationship: rel,
      rule,
      source,
      target,
      sourceDef,
      targetDef,
      names,
      document,
      registry,
    });

    if (result.sourceAttributes) {
      const block = blocksByResourceId.get(source.id);
      if (block) {
        for (const attr of result.sourceAttributes) {
          const key = `${source.id}:${attr.name}`;
          if (processedAttributeKeys.has(key)) {
            // Replace existing
            const idx = block.attributes.findIndex((a) => a.name === attr.name);
            if (idx >= 0) block.attributes[idx] = attr;
            else block.attributes.push(attr);
          } else {
            processedAttributeKeys.add(key);
            const idx = block.attributes.findIndex((a) => a.name === attr.name);
            if (idx >= 0) block.attributes[idx] = attr;
            else block.attributes.push(attr);
          }
        }
      }
    }

    if (result.targetAttributes) {
      const block = blocksByResourceId.get(target.id);
      if (block) {
        for (const attr of result.targetAttributes) {
          const idx = block.attributes.findIndex((a) => a.name === attr.name);
          if (idx >= 0) block.attributes[idx] = attr;
          else block.attributes.push(attr);
        }
      }
    }

    if (result.extraBlocks) {
      for (const block of result.extraBlocks) {
        extra.push({ block, category: sourceDef.display.category, ownerResourceId: source.id });
      }
    }

    // Surface WARNING comments on the source resource (annotation-only comments stay silent).
    if (result.comment?.startsWith('WARNING:')) {
      const block = blocksByResourceId.get(source.id);
      if (block) {
        block.comment = block.comment ? `${block.comment}\n${result.comment}` : result.comment;
      }
    }
  }

  return extra;
}

export { resolveExpr, toHclValue, allocateNames };
