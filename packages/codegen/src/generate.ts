import type { ArchvizDocument, ResourceInstance } from '@archviz/core';
import { validate, hasErrors } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import type { FilePlan, HclBlock } from './ast.js';
import { allocateNames } from './names.js';
import { buildResourceBlock, applyMaterializers, type CategorizedBlock } from './materialize.js';
import { printFilePlan, printHcl } from './printer.js';
import { registerAwsMaterializers } from './aws-materializers.js';
import { applyEmitters } from './emit.js';
import { registerAwsEmitters } from './aws-emitters.js';
import { buildPromotedVariableBlocks } from './variables.js';
import { buildDefaultOutputs } from './outputs.js';

export type GenerateLayout = 'single-file' | 'by-category';

export interface GenerateOptions {
  /** AWS region for the provider block. */
  region?: string;
  /** When true, still emit HCL even if diagnostics have errors (with # ERROR comments). */
  emitDespiteErrors?: boolean;
  /**
   * 'single-file' dumps everything into main.tf. 'by-category' (default)
   * splits into versions/providers/variables/network/compute/database/
   * storage/security/outputs.tf, matching common Terraform module
   * conventions.
   */
  layout?: GenerateLayout;
}

export interface GenerateResult {
  files: Record<string, string>;
  plan: FilePlan;
  diagnostics: ReturnType<typeof validate>['diagnostics'];
  blocked: boolean;
}

export function topoSort(document: ArchvizDocument, registry: ResourceRegistry): string[] {
  const ids = document.resources.map((r) => r.id);
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges = new Map<string, string[]>();

  const addEdge = (from: string, to: string) => {
    // from must come before to
    const list = edges.get(from) ?? [];
    list.push(to);
    edges.set(from, list);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  };

  for (const r of document.resources) {
    if (r.parentId && indegree.has(r.parentId) && indegree.has(r.id)) {
      addEdge(r.parentId, r.id);
    }
  }

  for (const rel of document.relationships) {
    // Prefer emitting target of attribute refs after source? Usually source refs target,
    // so target should come first for readability when source references target.
    const source = document.resources.find((r) => r.id === rel.sourceId);
    const target = document.resources.find((r) => r.id === rel.targetId);
    if (!source || !target) continue;
    const rule = registry.findConnectionRule(source.type, rel.relationship, target.type);
    if (rule?.materialize.strategy === 'attribute') {
      addEdge(rel.targetId, rel.sourceId);
    }
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const next of edges.get(id) ?? []) {
      const d = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  // Append any leftover (cycles)
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

/**
 * Terraform requires resource names to be unique per type per module, but the
 * same companion block can legitimately be derived more than once — e.g. two
 * resources in the same security group connecting to the same target group
 * produce the identical SG rule pair. Keep the first of each.
 */
function dedupeBlocks(blocks: CategorizedBlock[]): CategorizedBlock[] {
  const seen = new Set<string>();
  const result: CategorizedBlock[] = [];
  for (const entry of blocks) {
    const key = `${entry.block.blockType}:${entry.block.labels.join('.')}`;
    if (entry.block.labels.length > 0 && seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/** Best-practice per-category file layout. Anything uncategorized falls into compute.tf. */
const CATEGORY_FILE: Record<string, string> = {
  networking: 'network.tf',
  compute: 'compute.tf',
  database: 'database.tf',
  storage: 'storage.tf',
  security: 'security.tf',
  integration: 'integration.tf',
  management: 'integration.tf',
};

export function categoryFile(category: string): string {
  return CATEGORY_FILE[category] ?? 'compute.tf';
}

export function generate(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  options: GenerateOptions = {},
): GenerateResult {
  registerAwsMaterializers();
  registerAwsEmitters();
  const validation = validate(document, registry);
  const blocked = hasErrors(validation.diagnostics);
  const region = options.region ?? 'us-east-1';
  const layout = options.layout ?? 'by-category';

  if (blocked && !options.emitDespiteErrors) {
    const errorComments: HclBlock[] = [
      {
        blockType: 'terraform',
        labels: [],
        attributes: [],
        blocks: [
          {
            blockType: 'required_providers',
            labels: [],
            attributes: [
              {
                name: 'aws',
                value: {
                  kind: 'raw',
                  code: `{\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }`,
                },
              },
            ],
            blocks: [],
          },
        ],
        comment: 'ERROR: document has validation errors — export blocked',
      },
    ];
    for (const d of validation.diagnostics.filter((x) => x.severity === 'error')) {
      errorComments.push({
        blockType: '#',
        labels: [],
        attributes: [],
        blocks: [],
        comment: `ERROR: ${d.message}`,
      });
    }
    // Use a simpler comment-only output
    const lines = [
      '# ERROR: document has validation errors — export blocked',
      ...validation.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `# ERROR: ${d.message}`),
      '',
    ];
    return {
      files: { 'main.tf': lines.join('\n') },
      plan: { files: [{ path: 'main.tf', blocks: errorComments }] },
      diagnostics: validation.diagnostics,
      blocked: true,
    };
  }

  const names = allocateNames(document.resources);
  const order = topoSort(document, registry);
  const blocksByResourceId = new Map<string, HclBlock>();

  for (const id of order) {
    const resource = document.resources.find((r) => r.id === id);
    if (!resource) continue;
    const block = buildResourceBlock(resource, { document, registry, names });
    if (block) blocksByResourceId.set(id, block);
  }

  const extra = dedupeBlocks(applyMaterializers(document, registry, names, blocksByResourceId));
  const emitterExtra = dedupeBlocks(
    applyEmitters(document, registry, names, region, blocksByResourceId),
  );

  const needsRandomProvider = document.resources.some(
    (r) => r.type === 'aws/secrets-manager-secret' && r.properties.source !== 'variable',
  );

  const requiredProviderAttrs: HclBlock['attributes'] = [
    {
      name: 'aws',
      value: {
        kind: 'raw',
        code: `{\n      source  = "hashicorp/aws"\n      version = "~> 5.0"\n    }`,
      },
    },
  ];
  if (needsRandomProvider) {
    requiredProviderAttrs.push({
      name: 'random',
      value: {
        kind: 'raw',
        code: `{\n      source  = "hashicorp/random"\n      version = "~> 3.6"\n    }`,
      },
    });
  }

  const versionsBlock: HclBlock = {
    blockType: 'terraform',
    labels: [],
    attributes: [],
    blocks: [
      {
        blockType: 'required_providers',
        labels: [],
        attributes: requiredProviderAttrs,
        blocks: [],
      },
    ],
  };

  const awsProvider: HclBlock = {
    blockType: 'provider',
    labels: ['aws'],
    attributes: [{ name: 'region', value: { kind: 'string', value: region } }],
    blocks: [],
  };

  const resourceBlocks = order
    .map((id) => blocksByResourceId.get(id))
    .filter((b): b is HclBlock => !!b);

  const resourceCategoryOf = (resource: ResourceInstance): string =>
    registry.get(resource.type)?.display.category ?? 'compute';

  const promotedVariables = buildPromotedVariableBlocks(document);
  const outputBlocks = buildDefaultOutputs(document, registry, names);

  // Prepend error comments (only relevant when emitDespiteErrors is used to preview a blocked doc)
  if (blocked && versionsBlock) {
    const msgs = validation.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => `ERROR: ${d.message}`)
      .join('\n');
    (versionsBlock as HclBlock).comment = msgs;
  }

  let plan: FilePlan;

  if (layout === 'single-file') {
    const blocks: HclBlock[] = [
      versionsBlock,
      awsProvider,
      ...promotedVariables,
      ...resourceBlocks,
      ...extra.map((e) => e.block),
      ...emitterExtra.map((e) => e.block),
      ...outputBlocks,
    ];
    plan = { files: [{ path: 'main.tf', blocks }] };
  } else {
    plan = buildByCategoryPlan({
      document,
      order,
      blocksByResourceId,
      resourceCategoryOf,
      versionsBlock,
      awsProvider,
      promotedVariables,
      extra,
      emitterExtra,
      outputBlocks,
    });
  }

  const files = printFilePlan(plan);

  void printHcl;

  return {
    files,
    plan,
    diagnostics: validation.diagnostics,
    blocked,
  };
}

/** Buckets all generated blocks into a best-practice multi-file layout. */
function buildByCategoryPlan(args: {
  document: ArchvizDocument;
  order: string[];
  blocksByResourceId: Map<string, HclBlock>;
  resourceCategoryOf: (resource: ResourceInstance) => string;
  versionsBlock: HclBlock;
  awsProvider: HclBlock;
  promotedVariables: HclBlock[];
  extra: CategorizedBlock[];
  emitterExtra: CategorizedBlock[];
  outputBlocks: HclBlock[];
}): FilePlan {
  const {
    document,
    order,
    blocksByResourceId,
    resourceCategoryOf,
    versionsBlock,
    awsProvider,
    promotedVariables,
    extra,
    emitterExtra,
    outputBlocks,
  } = args;

  const buckets = new Map<string, HclBlock[]>();
  const pushTo = (file: string, block: HclBlock) => {
    const list = buckets.get(file) ?? [];
    list.push(block);
    buckets.set(file, list);
  };

  for (const id of order) {
    const resource = document.resources.find((r) => r.id === id);
    const block = blocksByResourceId.get(id);
    if (!resource || !block) continue;
    pushTo(categoryFile(resourceCategoryOf(resource)), block);
  }

  // `variable` blocks always land in variables.tf regardless of the owning
  // resource's category (secrets' generated-password/variable companions,
  // and any property promoted via the properties panel).
  for (const { block, category } of [...extra, ...emitterExtra]) {
    pushTo(block.blockType === 'variable' ? 'variables.tf' : categoryFile(category), block);
  }

  const files: FilePlan['files'] = [
    { path: 'versions.tf', blocks: [versionsBlock] },
    { path: 'providers.tf', blocks: [awsProvider] },
  ];

  const variablesBucket = [...promotedVariables, ...(buckets.get('variables.tf') ?? [])];
  if (variablesBucket.length > 0) {
    files.push({ path: 'variables.tf', blocks: variablesBucket });
  }

  for (const path of ['network.tf', 'compute.tf', 'database.tf', 'storage.tf', 'security.tf', 'integration.tf']) {
    const blocks = buckets.get(path);
    if (blocks && blocks.length > 0) {
      files.push({ path, blocks });
    }
  }

  if (outputBlocks.length > 0) {
    files.push({ path: 'outputs.tf', blocks: outputBlocks });
  }

  return { files };
}

/** Convenience: return main.tf contents only. */
export function generateMainTf(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  options?: GenerateOptions,
): string {
  return generate(document, registry, {
    emitDespiteErrors: true,
    layout: 'single-file',
    ...options,
  }).files['main.tf']!;
}
