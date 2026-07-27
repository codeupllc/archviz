import type { ResourceRegistry, ConnectionRule, PropertyDefinition } from '@archviz/schema';
import type { ArchvizDocument, ResourceInstance } from './document.js';
import {
  childrenOf,
  findResource,
  relationshipsFrom,
  relationshipsTo,
} from './document.js';
import type { ConstraintResult, Diagnostic } from './diagnostics.js';
import { fail, ok, mergeResults } from './diagnostics.js';

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

export interface ConstraintEngine {
  canNest(
    childType: string,
    parentType: string | null,
    parentId: string | null,
    doc: ArchvizDocument,
  ): ConstraintResult;
  canConnect(
    sourceId: string,
    targetId: string,
    relationship: string,
    doc: ArchvizDocument,
  ): ConstraintResult;
  validTargetsFor(
    sourceId: string,
    relationship: string | undefined,
    doc: ArchvizDocument,
  ): { resourceId: string; relationships: string[] }[];
  validate(doc: ArchvizDocument): ConstraintResult;
  validateProperties(resource: ResourceInstance): Diagnostic[];
}

export function createConstraintEngine(registry: ResourceRegistry): ConstraintEngine {
  return {
    canNest(childType, parentType, parentId, doc) {
      const def = registry.get(childType);
      if (!def) {
        return fail({
          code: 'unknown-type',
          message: `Unknown resource type: ${childType}`,
          severity: 'error',
          tier: 'structural',
        });
      }

      const requiredParent = def.nesting.allowedParents.find((p) => p.required);
      if (!parentType) {
        if (requiredParent) {
          const parentLabel =
            registry.get(requiredParent.type)?.display.label ?? requiredParent.type;
          return fail({
            code: 'parent-required',
            message: `${def.display.label} must be placed inside ${article(parentLabel)} ${parentLabel}`,
            severity: 'error',
            tier: 'structural',
          });
        }
        if (def.nesting.allowedParents.length > 0) {
          // Optional parent allowed — nesting at root is ok when no parent required
          const allOptional = def.nesting.allowedParents.every((p) => !p.required);
          if (!allOptional) {
            return fail({
              code: 'parent-required',
              message: `${def.display.label} requires a parent container`,
              severity: 'error',
              tier: 'structural',
            });
          }
        }
        return ok();
      }

      const rule = registry.nestingRule(childType, parentType);
      if (!rule) {
        const parentLabel = registry.get(parentType)?.display.label ?? parentType;
        return fail({
          code: 'invalid-parent',
          message: `${def.display.label} cannot be nested inside ${parentLabel}`,
          severity: 'error',
          tier: 'structural',
        });
      }

      if (parentId && rule.maxPerParent != null) {
        const siblings = childrenOf(doc, parentId).filter((c) => c.type === childType);
        if (siblings.length >= rule.maxPerParent) {
          return fail({
            code: 'nesting-cardinality',
            message: `At most ${rule.maxPerParent} ${def.display.label}(s) allowed under this parent`,
            severity: 'error',
            tier: 'structural',
          });
        }
      }

      return ok();
    },

    canConnect(sourceId, targetId, relationship, doc) {
      if (sourceId === targetId) {
        return fail({
          code: 'self-connection',
          message: 'A resource cannot connect to itself',
          severity: 'error',
          tier: 'structural',
          resourceId: sourceId,
        });
      }

      const source = findResource(doc, sourceId);
      const target = findResource(doc, targetId);
      if (!source || !target) {
        return fail({
          code: 'missing-endpoint',
          message: 'Connection source or target does not exist',
          severity: 'error',
          tier: 'structural',
        });
      }

      const rule = registry.findConnectionRule(source.type, relationship, target.type);
      if (!rule) {
        const sourceLabel = registry.get(source.type)?.display.label ?? source.type;
        const targetLabel = registry.get(target.type)?.display.label ?? target.type;
        return fail({
          code: 'invalid-connection',
          message: `${sourceLabel} cannot "${relationship}" to ${targetLabel}`,
          severity: 'error',
          tier: 'structural',
          resourceId: sourceId,
        });
      }

      const card = checkCardinality(rule, sourceId, targetId, relationship, doc);
      if (!card.ok) return card;

      const duplicate = doc.relationships.some(
        (r) =>
          r.sourceId === sourceId &&
          r.targetId === targetId &&
          r.relationship === relationship,
      );
      if (duplicate) {
        return fail({
          code: 'duplicate-connection',
          message: 'This connection already exists',
          severity: 'error',
          tier: 'structural',
          resourceId: sourceId,
        });
      }

      return ok();
    },

    validTargetsFor(sourceId, relationship, doc) {
      const source = findResource(doc, sourceId);
      if (!source) return [];
      const sourceDef = registry.get(source.type);
      if (!sourceDef) return [];

      const results: { resourceId: string; relationships: string[] }[] = [];

      for (const candidate of doc.resources) {
        if (candidate.id === sourceId) continue;

        // Relationships are directional in the schema (e.g. only the ECS
        // Service resource declares "connects-to" toward a database, not the
        // other way around). Users starting a drag from either node should
        // see valid targets highlighted, so check both orderings — the
        // actual connection is created in whichever direction is valid.
        const forwardRels =
          relationship !== undefined
            ? registry.possibleRelationships(source.type, candidate.type).filter(
                (r) => r === relationship,
              )
            : registry.possibleRelationships(source.type, candidate.type);
        const backwardRels =
          relationship !== undefined
            ? registry.possibleRelationships(candidate.type, source.type).filter(
                (r) => r === relationship,
              )
            : registry.possibleRelationships(candidate.type, source.type);

        const validForward = forwardRels.filter(
          (rel) => this.canConnect(sourceId, candidate.id, rel, doc).ok,
        );
        const validBackward = backwardRels.filter(
          (rel) => this.canConnect(candidate.id, sourceId, rel, doc).ok,
        );
        const valid = [...new Set([...validForward, ...validBackward])];

        if (valid.length > 0) {
          results.push({ resourceId: candidate.id, relationships: valid });
        }
      }

      return results;
    },

    validate(doc) {
      const diagnostics: Diagnostic[] = [];

      for (const resource of doc.resources) {
        const def = registry.get(resource.type);
        if (!def) {
          diagnostics.push({
            code: 'unknown-type',
            message: `Unknown resource type: ${resource.type}`,
            severity: 'error',
            tier: 'structural',
            resourceId: resource.id,
          });
          continue;
        }

        // Nesting
        if (resource.parentId) {
          const parent = findResource(doc, resource.parentId);
          if (!parent) {
            diagnostics.push({
              code: 'missing-parent',
              message: `Parent ${resource.parentId} not found`,
              severity: 'error',
              tier: 'structural',
              resourceId: resource.id,
            });
          } else {
            const nest = this.canNest(
              resource.type,
              parent.type,
              parent.id,
              // Exclude self when checking cardinality
              {
                ...doc,
                resources: doc.resources.filter((r) => r.id !== resource.id),
              },
            );
            diagnostics.push(...nest.diagnostics.map((d) => ({ ...d, resourceId: resource.id })));
          }
        } else {
          const nest = this.canNest(resource.type, null, null, doc);
          diagnostics.push(...nest.diagnostics.map((d) => ({ ...d, resourceId: resource.id })));
        }

        // Required outgoing connections (Terraform arguments that can only
        // come from a connection — without them the generated HCL is invalid).
        for (const rule of def.connections) {
          const min = rule.cardinality?.minOutgoing;
          if (min == null) continue;
          const outgoing = relationshipsFrom(doc, resource.id, rule.relationship);
          if (outgoing.length < min) {
            diagnostics.push({
              code: 'missing-required-connection',
              message: `${def.display.label} needs ${min === 1 ? 'a' : min} "${rule.label ?? rule.relationship}" connection`,
              severity: 'error',
              tier: 'structural',
              resourceId: resource.id,
            });
          }
        }

        // Properties (semantic)
        diagnostics.push(...validateProperties(resource, def.properties));
      }

      // Cardinality of nesting per parent (re-check globally)
      const parentChildCounts = new Map<string, Map<string, number>>();
      for (const r of doc.resources) {
        if (!r.parentId) continue;
        let byType = parentChildCounts.get(r.parentId);
        if (!byType) {
          byType = new Map();
          parentChildCounts.set(r.parentId, byType);
        }
        byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
      }
      for (const [parentId, byType] of parentChildCounts) {
        const parent = findResource(doc, parentId);
        if (!parent) continue;
        for (const [childType, count] of byType) {
          const rule = registry.nestingRule(childType, parent.type);
          if (rule?.maxPerParent != null && count > rule.maxPerParent) {
            const childLabel = registry.get(childType)?.display.label ?? childType;
            diagnostics.push({
              code: 'nesting-cardinality',
              message: `Parent has ${count} ${childLabel}(s); max is ${rule.maxPerParent}`,
              severity: 'error',
              tier: 'structural',
              resourceId: parentId,
            });
          }
        }
      }

      for (const rel of doc.relationships) {
        const result = this.canConnect(rel.sourceId, rel.targetId, rel.relationship, {
          ...doc,
          // Exclude this relationship when checking duplicates/cardinality
          relationships: doc.relationships.filter((r) => r.id !== rel.id),
        });
        diagnostics.push(
          ...result.diagnostics.map((d) => ({
            ...d,
            relationshipId: rel.id,
          })),
        );
      }

      // API-access edges (e.g. SQS reads-from / writes-to) need a resolvable
      // workload IAM role — same class of diagram error as Lambda missing
      // Execution Role, so Export/Plan block instead of only a .tf WARNING.
      diagnostics.push(...validateWorkloadRoleAccess(doc, registry));

      return {
        ok: diagnostics.every((d) => d.severity !== 'error'),
        diagnostics,
      };
    },

    validateProperties(resource) {
      const def = registry.get(resource.type);
      if (!def) return [];
      return validateProperties(resource, def.properties);
    },
  };
}

function checkCardinality(
  rule: ConnectionRule,
  sourceId: string,
  targetId: string,
  relationship: string,
  doc: ArchvizDocument,
): ConstraintResult {
  const card = rule.cardinality;
  if (!card) return ok();

  if (card.maxOutgoing != null) {
    const outgoing = relationshipsFrom(doc, sourceId, relationship);
    if (outgoing.length >= card.maxOutgoing) {
      return fail({
        code: 'outgoing-cardinality',
        message: `At most ${card.maxOutgoing} "${relationship}" connection(s) allowed from this resource`,
        severity: 'error',
        tier: 'structural',
        resourceId: sourceId,
      });
    }
  }

  if (card.maxIncoming != null) {
    const incoming = relationshipsTo(doc, targetId, relationship);
    if (incoming.length >= card.maxIncoming) {
      return fail({
        code: 'incoming-cardinality',
        message: `At most ${card.maxIncoming} "${relationship}" connection(s) allowed to this resource`,
        severity: 'error',
        tier: 'structural',
        resourceId: targetId,
      });
    }
  }

  return ok();
}

function validateProperties(
  resource: ResourceInstance,
  props: PropertyDefinition[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const prop of props) {
    const value = resource.properties[prop.name];
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    // A property promoted to a Terraform variable materializes as `var.<name>`,
    // so the stored literal is never emitted: an empty one is not a missing
    // value, and format checks can't run against a reference. Warn instead when
    // there is no literal to become the variable's default, because then the
    // value has to arrive at plan time via tfvars.
    const boundVariable = resource.variableBindings?.[prop.name];
    if (boundVariable) {
      if (empty) {
        diagnostics.push({
          code: 'variable-needs-value',
          message: `Property "${prop.label ?? prop.name}" comes from var.${boundVariable}, which has no default — set it in terraform.tfvars (archviz-runner seeds a "CHANGEME" placeholder)`,
          severity: 'warning',
          tier: 'semantic',
          resourceId: resource.id,
          property: prop.name,
        });
      }
      continue;
    }

    if (prop.required && empty) {
      diagnostics.push({
        code: 'required-property',
        message: `Property "${prop.label ?? prop.name}" is required`,
        severity: 'error',
        tier: 'semantic',
        resourceId: resource.id,
        property: prop.name,
      });
      continue;
    }

    if (empty) continue;

    if (prop.type === 'enum' && prop.enumValues && !prop.enumValues.includes(String(value))) {
      diagnostics.push({
        code: 'invalid-enum',
        message: `Property "${prop.name}" must be one of: ${prop.enumValues.join(', ')}`,
        severity: 'error',
        tier: 'semantic',
        resourceId: resource.id,
        property: prop.name,
      });
    }

    if (prop.type === 'cidr' && typeof value === 'string') {
      if (!isValidCidr(value)) {
        diagnostics.push({
          code: 'invalid-cidr',
          message: `Property "${prop.name}" must be a valid CIDR (e.g. 10.0.0.0/16)`,
          severity: 'error',
          tier: 'semantic',
          resourceId: resource.id,
          property: prop.name,
        });
      }
    }

    if (prop.validate?.pattern && typeof value === 'string') {
      const re = new RegExp(prop.validate.pattern);
      if (!re.test(value)) {
        diagnostics.push({
          code: 'pattern-mismatch',
          message: `Property "${prop.name}" does not match pattern ${prop.validate.pattern}`,
          severity: 'error',
          tier: 'semantic',
          resourceId: resource.id,
          property: prop.name,
        });
      }
    }

    if (prop.type === 'number' && typeof value === 'number') {
      if (prop.validate?.min != null && value < prop.validate.min) {
        diagnostics.push({
          code: 'min-value',
          message: `Property "${prop.name}" must be >= ${prop.validate.min}`,
          severity: 'error',
          tier: 'semantic',
          resourceId: resource.id,
          property: prop.name,
        });
      }
      if (prop.validate?.max != null && value > prop.validate.max) {
        diagnostics.push({
          code: 'max-value',
          message: `Property "${prop.name}" must be <= ${prop.validate.max}`,
          severity: 'error',
          tier: 'semantic',
          resourceId: resource.id,
          property: prop.name,
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Edges that grant AWS API access via IAM on an assumed role (SQS / S3 /
 * DynamoDB). Detected by materialize strategy or known API target types.
 */
function edgeNeedsWorkloadRole(
  rule: ConnectionRule,
  targetType: string,
): boolean {
  const strategy = rule.materialize?.strategy;
  if (strategy === 'sqs-iam' || strategy === 'api-iam') return true;
  if (strategy === 'reads-from') {
    return (
      targetType === 'aws/sqs-queue' ||
      targetType === 'aws/s3-bucket' ||
      targetType === 'aws/dynamodb-table'
    );
  }
  return false;
}

function resolveWorkloadRoleId(
  source: ResourceInstance,
  doc: ArchvizDocument,
): string | null {
  const assumes = doc.relationships.find(
    (r) => r.sourceId === source.id && r.relationship === 'assumes',
  );
  if (assumes) return assumes.targetId;

  if (source.type === 'aws/ecs-task-definition') {
    const taskRole = doc.relationships.find(
      (r) => r.sourceId === source.id && r.relationship === 'task-role',
    );
    return taskRole?.targetId ?? null;
  }

  if (source.type === 'aws/ecs-service') {
    const runsTask = doc.relationships.find(
      (r) => r.sourceId === source.id && r.relationship === 'runs-task',
    );
    if (!runsTask) return null;
    const taskRole = doc.relationships.find(
      (r) => r.sourceId === runsTask.targetId && r.relationship === 'task-role',
    );
    return taskRole?.targetId ?? null;
  }

  return null;
}

function workloadRoleHint(sourceType: string): string {
  if (sourceType === 'aws/ecs-service' || sourceType === 'aws/ecs-task-definition') {
    return 'connect an IAM Role to the Task Definition via "Task Role"';
  }
  if (sourceType === 'aws/lambda-function') {
    return 'connect an IAM Role via "Execution Role"';
  }
  if (sourceType === 'aws/ec2-instance') {
    return 'connect an IAM Role via "IAM Role"';
  }
  return 'connect an IAM Role the workload can assume';
}

/**
 * When a service reads/writes SQS (or similar API resources) without a
 * resolvable workload role, surface a canvas error like Lambda's missing
 * Execution Role — not only a codegen WARNING comment.
 */
function validateWorkloadRoleAccess(
  doc: ArchvizDocument,
  registry: ResourceRegistry,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const rel of doc.relationships) {
    const source = findResource(doc, rel.sourceId);
    const target = findResource(doc, rel.targetId);
    if (!source || !target) continue;

    const rule = registry.findConnectionRule(source.type, rel.relationship, target.type);
    if (!rule) continue;

    const targetDef = registry.get(target.type);
    if (!edgeNeedsWorkloadRole(rule, target.type)) continue;

    if (resolveWorkloadRoleId(source, doc)) continue;

    const sourceLabel = registry.get(source.type)?.display.label ?? source.type;
    const targetLabel = targetDef?.display.label ?? target.type;
    const edgeLabel = rule.label ?? rel.relationship.replace(/-/g, ' ');

    diagnostics.push({
      code: 'missing-workload-role',
      message: `${sourceLabel} "${source.name}" ${edgeLabel.toLowerCase()} ${targetLabel} but has no assumed role — ${workloadRoleHint(source.type)} to grant access`,
      severity: 'error',
      tier: 'structural',
      resourceId: source.id,
      relationshipId: rel.id,
    });
  }

  return diagnostics;
}

function isValidCidr(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (!match) return false;
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  const prefix = Number(match[5]);
  if (octets.some((o) => o > 255)) return false;
  if (prefix > 32) return false;
  return true;
}

export { mergeResults };
