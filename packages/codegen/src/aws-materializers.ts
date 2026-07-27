import type { Materializer } from './materialize.js';
import { registerMaterializer } from './materialize.js';
import { traversal } from './ast.js';
import { secretValueRef } from './aws-emitters.js';

/**
 * Points a consuming resource's property (e.g. RDS `password`) at whatever
 * companion value the Secrets Manager/SSM Parameter emitter actually
 * created (random_password.<x>.result, var.<x>_value, or
 * aws_ssm_parameter.<x>.value) — see `secretValueRef` in aws-emitters.ts.
 */
export const secretValueRefMaterializer: Materializer = (ctx) => {
  const strategy = ctx.rule.materialize as { strategy: 'secret-value-ref'; attribute: string };
  const targetName = ctx.names.get(ctx.target.id);
  if (!targetName) return {};

  const value = secretValueRef(ctx.target, targetName);
  if (!value) {
    return {
      comment: `secret-value-ref skipped: ${ctx.target.name} has no resolvable secret value`,
    };
  }

  return { sourceAttributes: [{ name: strategy.attribute, value }] };
};

/**
 * Explicit-SG materializer: connects-to edges emit ingress/egress rules on
 * Security Groups already attached to both endpoints (no hidden resources).
 */
export const sgRulePairMaterializer: Materializer = (ctx) => {
  const sourceSgs = ctx.document.relationships.filter(
    (r) => r.sourceId === ctx.source.id && r.relationship === 'attached-to',
  );
  const targetSgs = ctx.document.relationships.filter(
    (r) => r.sourceId === ctx.target.id && r.relationship === 'attached-to',
  );

  if (sourceSgs.length === 0 || targetSgs.length === 0) {
    return {
      comment: `sg-rule-pair skipped: both ${ctx.source.name} and ${ctx.target.name} need attached Security Groups`,
    };
  }

  const blocks = [];
  for (const srcRel of sourceSgs) {
    const srcSg = ctx.document.resources.find((r) => r.id === srcRel.targetId);
    if (!srcSg) continue;
    const srcSgName = ctx.names.get(srcSg.id);
    if (!srcSgName) continue;

    for (const tgtRel of targetSgs) {
      const tgtSg = ctx.document.resources.find((r) => r.id === tgtRel.targetId);
      if (!tgtSg) continue;
      const tgtSgName = ctx.names.get(tgtSg.id);
      if (!tgtSgName) continue;

      const ruleName = `${srcSgName}_to_${tgtSgName}`;

      blocks.push({
        blockType: 'resource',
        labels: ['aws_vpc_security_group_egress_rule', `${ruleName}_egress`],
        attributes: [
          {
            name: 'security_group_id',
            value: traversal('aws_security_group', srcSgName, 'id'),
          },
          {
            name: 'referenced_security_group_id',
            value: traversal('aws_security_group', tgtSgName, 'id'),
          },
          { name: 'ip_protocol', value: { kind: 'string' as const, value: 'tcp' } },
          { name: 'from_port', value: { kind: 'number' as const, value: 0 } },
          { name: 'to_port', value: { kind: 'number' as const, value: 65535 } },
          {
            name: 'description',
            value: {
              kind: 'string' as const,
              value: `${ctx.source.name} → ${ctx.target.name}`,
            },
          },
        ],
        blocks: [],
        comment: `connects-to: ${ctx.source.name} → ${ctx.target.name}`,
      });

      blocks.push({
        blockType: 'resource',
        labels: ['aws_vpc_security_group_ingress_rule', `${ruleName}_ingress`],
        attributes: [
          {
            name: 'security_group_id',
            value: traversal('aws_security_group', tgtSgName, 'id'),
          },
          {
            name: 'referenced_security_group_id',
            value: traversal('aws_security_group', srcSgName, 'id'),
          },
          { name: 'ip_protocol', value: { kind: 'string' as const, value: 'tcp' } },
          { name: 'from_port', value: { kind: 'number' as const, value: 0 } },
          { name: 'to_port', value: { kind: 'number' as const, value: 65535 } },
          {
            name: 'description',
            value: {
              kind: 'string' as const,
              value: `${ctx.source.name} → ${ctx.target.name}`,
            },
          },
        ],
        blocks: [],
      });
    }
  }

  return { extraBlocks: blocks };
};

let awsRegistered = false;

export function registerAwsMaterializers(): void {
  if (awsRegistered) return;
  registerMaterializer('sg-rule-pair', sgRulePairMaterializer);
  registerMaterializer('sg-rule-pair:aws', sgRulePairMaterializer);
  registerMaterializer('secret-value-ref', secretValueRefMaterializer);
  awsRegistered = true;
}
