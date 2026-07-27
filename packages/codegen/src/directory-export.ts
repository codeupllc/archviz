import type { ArchvizDocument } from '@archviz/core';
import { validate, hasErrors } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import type { Diagnostic } from '@archviz/core';
import type { HclBlock, HclValue } from './ast.js';
import { traversal, boolValue } from './ast.js';
import { allocateNames } from './names.js';
import { buildResourceBlock, applyMaterializers, type CategorizedBlock } from './materialize.js';
import { applyEmitters } from './emit.js';
import { registerAwsMaterializers } from './aws-materializers.js';
import { registerAwsEmitters } from './aws-emitters.js';
import { buildPromotedVariableBlocks } from './variables.js';
import { buildDefaultOutputs } from './outputs.js';
import { printHcl } from './printer.js';
import { topoSort, categoryFile } from './generate.js';

export interface DirectoryExportOptions {
  region?: string;
  emitDespiteErrors?: boolean;
}

export interface DirectoryExportResult {
  files: Record<string, string>;
  diagnostics: Diagnostic[];
  blocked: boolean;
}

const SHARED_GROUP = 'shared';

function groupNameOf(document: ArchvizDocument, resourceId: string): string {
  const r = document.resources.find((x) => x.id === resourceId);
  const g = r?.serviceGroup?.trim();
  return g ? sanitizeGroupName(g) : SHARED_GROUP;
}

function sanitizeGroupName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || SHARED_GROUP;
}

function sanitizeOutputName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_');
}

function isSensitiveTraversal(path: string[]): boolean {
  return (
    path[0] === 'random_password' ||
    path[0] === 'aws_secretsmanager_secret_version' ||
    path[0] === 'aws_ssm_parameter'
  );
}

interface CrossRefState {
  /** targetGroup -> outputName -> { value, sensitive } to declare in that group's outputs.tf */
  neededOutputs: Map<string, Map<string, { value: HclValue; sensitive: boolean }>>;
  /** consumingGroup -> set of groups it needs a terraform_remote_state data source for */
  neededRemoteStates: Map<string, Set<string>>;
}

/**
 * Recursively rewrites traversals inside a block (and its nested blocks) so
 * that any reference crossing a service-group boundary becomes a
 * `data.terraform_remote_state.<group>.outputs.<name>` lookup instead of a
 * same-state resource traversal, and records the output/data source that
 * needs to be materialized on each side.
 */
function rewriteCrossGroupRefs(
  block: HclBlock,
  ownerGroup: string,
  nameOwnerGroup: Map<string, string>,
  state: CrossRefState,
): void {
  const rewrite = (value: HclValue): HclValue => {
    if (value.kind === 'traversal') {
      const name = value.path[1];
      const targetGroup = name ? nameOwnerGroup.get(name) : undefined;
      if (targetGroup && targetGroup !== ownerGroup) {
        const outputName = sanitizeOutputName(value.path.slice(1).join('_'));
        let perGroup = state.neededOutputs.get(targetGroup);
        if (!perGroup) {
          perGroup = new Map();
          state.neededOutputs.set(targetGroup, perGroup);
        }
        if (!perGroup.has(outputName)) {
          perGroup.set(outputName, { value, sensitive: isSensitiveTraversal(value.path) });
        }
        let needed = state.neededRemoteStates.get(ownerGroup);
        if (!needed) {
          needed = new Set();
          state.neededRemoteStates.set(ownerGroup, needed);
        }
        needed.add(targetGroup);
        return traversal('data', 'terraform_remote_state', targetGroup, 'outputs', outputName);
      }
      return value;
    }
    if (value.kind === 'list') {
      return { kind: 'list', values: value.values.map(rewrite) };
    }
    return value;
  };

  block.attributes = block.attributes.map((a) => ({ ...a, value: rewrite(a.value) }));
  for (const child of block.blocks) {
    rewriteCrossGroupRefs(child, ownerGroup, nameOwnerGroup, state);
  }
}

function collectVarNames(block: HclBlock, into: Set<string>): void {
  for (const attr of block.attributes) {
    if (attr.value.kind === 'traversal' && attr.value.path[0] === 'var' && attr.value.path[1]) {
      into.add(attr.value.path[1]);
    }
    if (attr.value.kind === 'list') {
      for (const v of attr.value.values) {
        if (v.kind === 'traversal' && v.path[0] === 'var' && v.path[1]) into.add(v.path[1]);
      }
    }
  }
  for (const child of block.blocks) collectVarNames(child, into);
}

/**
 * Partitions the document by `serviceGroup` and generates one independent
 * Terraform root module (its own versions/providers/variables/category
 * files + outputs) per group, following the same by-category layout as
 * `generate()`. Cross-group references become `terraform_remote_state`
 * lookups with a `# TODO: configure backend` stub — the most novel part of
 * this feature and the one most likely to need follow-up iteration once
 * exercised against a real multi-service diagram.
 */
export function buildDirectoryExport(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  options: DirectoryExportOptions = {},
): DirectoryExportResult {
  registerAwsMaterializers();
  registerAwsEmitters();
  const validation = validate(document, registry);
  const blocked = hasErrors(validation.diagnostics);
  const region = options.region ?? 'us-east-1';

  if (blocked && !options.emitDespiteErrors) {
    const lines = [
      '# ERROR: document has validation errors — directory export blocked',
      ...validation.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `# ERROR: ${d.message}`),
      '',
    ];
    return {
      files: { 'README.md': lines.join('\n') },
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

  const extra = applyMaterializers(document, registry, names, blocksByResourceId);
  const emitterExtra = applyEmitters(document, registry, names, region, blocksByResourceId);
  const allExtras: CategorizedBlock[] = [...extra, ...emitterExtra];

  // Map every allocated name (real resources AND codegen-synthesized
  // companions like random_password/log groups) to the service group of
  // whoever owns it, so cross-group traversals can be detected generically.
  const nameOwnerGroup = new Map<string, string>();
  for (const id of order) {
    const name = names.get(id);
    if (name) nameOwnerGroup.set(name, groupNameOf(document, id));
  }
  for (const { block, ownerResourceId } of allExtras) {
    const label = block.labels[1];
    if (label) nameOwnerGroup.set(label, groupNameOf(document, ownerResourceId));
  }

  const state: CrossRefState = { neededOutputs: new Map(), neededRemoteStates: new Map() };
  for (const id of order) {
    const block = blocksByResourceId.get(id);
    if (block) rewriteCrossGroupRefs(block, groupNameOf(document, id), nameOwnerGroup, state);
  }
  for (const { block, ownerResourceId } of allExtras) {
    rewriteCrossGroupRefs(block, groupNameOf(document, ownerResourceId), nameOwnerGroup, state);
  }

  const groups = new Map<string, string[]>();
  for (const id of order) {
    const g = groupNameOf(document, id);
    const list = groups.get(g) ?? [];
    list.push(id);
    groups.set(g, list);
  }
  // Make sure every referenced group (producer-only, e.g. all its resources
  // could theoretically be filtered out) still gets a directory.
  for (const g of [...state.neededOutputs.keys(), ...state.neededRemoteStates.keys()]) {
    if (!groups.has(g)) groups.set(g, []);
  }

  const extrasByOwnerGroup = new Map<string, CategorizedBlock[]>();
  for (const eb of allExtras) {
    const g = groupNameOf(document, eb.ownerResourceId);
    const list = extrasByOwnerGroup.get(g) ?? [];
    list.push(eb);
    extrasByOwnerGroup.set(g, list);
  }

  const promotedVariables = buildPromotedVariableBlocks(document);
  const files: Record<string, string> = {};
  const groupNames = Array.from(groups.keys()).sort();

  for (const group of groupNames) {
    const resourceIds = new Set(groups.get(group) ?? []);
    const groupResources = document.resources.filter((r) => resourceIds.has(r.id));
    const ownExtras = extrasByOwnerGroup.get(group) ?? [];

    const needsRandomProvider = ownExtras.some(
      ({ block }) => block.blockType === 'resource' && block.labels[0] === 'random_password',
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

    const groupBlocks: HclBlock[] = [
      {
        blockType: 'terraform',
        labels: [],
        attributes: [],
        blocks: [
          { blockType: 'required_providers', labels: [], attributes: requiredProviderAttrs, blocks: [] },
        ],
      },
    ];
    files[`${group}/versions.tf`] = printHcl(groupBlocks);

    files[`${group}/providers.tf`] = printHcl([
      {
        blockType: 'provider',
        labels: ['aws'],
        attributes: [{ name: 'region', value: { kind: 'string', value: region } }],
        blocks: [],
      },
    ]);

    // Category buckets for this group's own resources + extras
    const buckets = new Map<string, HclBlock[]>();
    const pushTo = (file: string, block: HclBlock) => {
      const list = buckets.get(file) ?? [];
      list.push(block);
      buckets.set(file, list);
    };
    for (const id of order) {
      if (!resourceIds.has(id)) continue;
      const resource = document.resources.find((r) => r.id === id);
      const block = blocksByResourceId.get(id);
      if (!resource || !block) continue;
      const category = registry.get(resource.type)?.display.category ?? 'compute';
      pushTo(categoryFile(category), block);
    }
    for (const { block, category } of ownExtras) {
      pushTo(block.blockType === 'variable' ? 'variables.tf' : categoryFile(category), block);
    }

    for (const path of ['network.tf', 'compute.tf', 'database.tf', 'storage.tf', 'security.tf', 'integration.tf']) {
      const blocks = buckets.get(path);
      if (blocks && blocks.length > 0) files[`${group}/${path}`] = printHcl(blocks);
    }

    // variables.tf: promoted-property variables actually referenced within
    // this group, plus any secret-companion `variable` blocks this group owns.
    const referencedVars = new Set<string>();
    for (const id of order) {
      if (!resourceIds.has(id)) continue;
      const block = blocksByResourceId.get(id);
      if (block) collectVarNames(block, referencedVars);
    }
    const ownVariableBlocks = buckets.get('variables.tf') ?? [];
    const relevantPromoted = promotedVariables.filter((v) => referencedVars.has(v.labels[0] ?? ''));
    const variableBlocks = [...relevantPromoted, ...ownVariableBlocks];
    if (variableBlocks.length > 0) {
      files[`${group}/variables.tf`] = printHcl(variableBlocks);
    }

    // outputs.tf: this group's own high-value defaults + anything other
    // groups need exposed via terraform_remote_state.
    const ownOutputs = buildDefaultOutputs({ ...document, resources: groupResources }, registry, names);
    const crossGroupOutputs: HclBlock[] = [];
    const needed = state.neededOutputs.get(group);
    if (needed) {
      for (const [outputName, { value, sensitive }] of needed) {
        crossGroupOutputs.push({
          blockType: 'output',
          labels: [outputName],
          attributes: [
            { name: 'value', value },
            ...(sensitive ? [{ name: 'sensitive', value: boolValue(true) }] : []),
          ],
          blocks: [],
          comment: 'Exposed for cross-service reference via terraform_remote_state',
        });
      }
    }
    const outputBlocks = [...ownOutputs, ...crossGroupOutputs];
    if (outputBlocks.length > 0) {
      files[`${group}/outputs.tf`] = printHcl(outputBlocks);
    }

    // remote_state.tf: stubs for every other group's state this group reads from.
    const remoteStateTargets = state.neededRemoteStates.get(group);
    if (remoteStateTargets && remoteStateTargets.size > 0) {
      const dataBlocks: HclBlock[] = Array.from(remoteStateTargets)
        .sort()
        .map((targetGroup) => ({
          blockType: 'data',
          labels: ['terraform_remote_state', targetGroup],
          attributes: [
            { name: 'backend', value: { kind: 'string', value: 'local' } },
            {
              name: 'config',
              value: {
                kind: 'raw',
                code: `{\n    # TODO: point this at wherever the "${targetGroup}" service's real state lives\n    path = "../${targetGroup}/terraform.tfstate"\n  }`,
              },
            },
          ],
          blocks: [],
          comment: `TODO: replace with your actual backend (s3, remote, etc.) for the "${targetGroup}" service`,
        }));
      files[`${group}/remote_state.tf`] = printHcl(dataBlocks);
    }
  }

  files['README.md'] = buildReadme(groupNames, state);

  return { files, diagnostics: validation.diagnostics, blocked: false };
}

function buildReadme(groupNames: string[], state: CrossRefState): string {
  const lines: string[] = [
    '# Terraform export (multi-service directories)',
    '',
    'Generated by Archviz. Each directory below is an independent Terraform root module with its own state — run `terraform init/plan/apply` separately inside each one.',
    '',
    '## Services',
    ...groupNames.map((g) => `- \`${g}/\``),
    '',
    '## Naming convention',
    'Directory names are kebab-case and come from each resource\u2019s "Service / Directory" field in the properties panel (defaults to `shared` when left blank). Rename a group there to move resources between directories on the next export.',
  ];

  if (state.neededRemoteStates.size > 0) {
    lines.push(
      '',
      '## Cross-service references',
      'Some resources reference resources that live in a different service\u2019s state. These are wired via `data "terraform_remote_state"` blocks in the consuming service\u2019s `remote_state.tf`, reading `output`s declared in the producing service\u2019s `outputs.tf`.',
      '',
      '**Before running `terraform apply`,** replace the `# TODO` backend config in every `remote_state.tf` with wherever that service\u2019s state actually lives (S3 + DynamoDB lock table, Terraform Cloud, etc.) — the generated stub uses a `local` backend pointing at a relative path purely as a placeholder.',
    );
  }

  lines.push('');
  return lines.join('\n');
}
