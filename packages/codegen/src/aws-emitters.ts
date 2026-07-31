import type { ResourceInstance } from '@archviz/core';
import { registerResourceEmitter, type EmitterContext } from './emit.js';
import type { HclValue } from './ast.js';
import { rawValue, stringValue, numberValue, boolValue, listValue, traversal } from './ast.js';

/**
 * Every subnet a resource lives in: its Subnet ancestor (containment) plus any
 * "runs-in" connections. ALBs and Fargate services span several subnets, which
 * containment alone can't express.
 */
function subnetRefs(resource: ResourceInstance, ctx: EmitterContext): HclValue[] {
  const names: string[] = [];

  let current: ResourceInstance | undefined = resource;
  while (current?.parentId) {
    const parent: ResourceInstance | undefined = ctx.document.resources.find(
      (r) => r.id === current!.parentId,
    );
    if (!parent) break;
    if (parent.type === 'aws/subnet') {
      const parentName = ctx.names.get(parent.id);
      if (parentName) names.push(parentName);
      break;
    }
    current = parent;
  }

  for (const rel of ctx.document.relationships) {
    if (rel.sourceId !== resource.id || rel.relationship !== 'runs-in') continue;
    const target = ctx.document.resources.find((r) => r.id === rel.targetId);
    if (!target || target.type !== 'aws/subnet') continue;
    const targetName = ctx.names.get(target.id);
    if (targetName && !names.includes(targetName)) names.push(targetName);
  }

  return names.map((name) => traversal('aws_subnet', name, 'id'));
}

function securityGroupRefs(resource: ResourceInstance, ctx: EmitterContext): HclValue[] {
  const refs: HclValue[] = [];
  for (const rel of ctx.document.relationships) {
    if (rel.sourceId !== resource.id || rel.relationship !== 'attached-to') continue;
    const target = ctx.document.resources.find((r) => r.id === rel.targetId);
    if (!target || target.type !== 'aws/security-group') continue;
    const targetName = ctx.names.get(target.id);
    if (targetName) refs.push(traversal('aws_security_group', targetName, 'id'));
  }
  return refs;
}

/**
 * Shared naming + value-resolution for anything that can act as a "secret
 * value" source (Secrets Manager Secret or SSM Parameter). Used by both the
 * Secrets Manager companion emitter (which creates the underlying
 * random_password/variable) and the `secret-value-ref` materializer (which
 * points a consuming resource's property at it), so the two never drift out
 * of sync on companion resource naming.
 */
export function secretValueRef(resource: ResourceInstance, name: string): HclValue | null {
  if (resource.type === 'aws/secrets-manager-secret') {
    const source = resource.properties.source === 'variable' ? 'variable' : 'generated-password';
    return source === 'variable'
      ? traversal('var', `${name}_value`)
      : traversal('random_password', `${name}_password`, 'result');
  }
  if (resource.type === 'aws/ssm-parameter') {
    return traversal('aws_ssm_parameter', name, 'value');
  }
  return null;
}

let awsEmittersRegistered = false;

export function registerAwsEmitters(): void {
  if (awsEmittersRegistered) return;
  awsEmittersRegistered = true;

  registerResourceEmitter('aws/ecs-task-definition', (resource, ctx) => {
    const name = ctx.names.get(resource.id);
    if (!name) return {};

    const family = String(resource.properties.family || name);
    const containerName = String(resource.properties.container_name || family);
    const containerPort = Number(resource.properties.container_port ?? 80);
    const imageTag = String(resource.properties.image_tag || 'latest');
    const imageOverride =
      typeof resource.properties.image === 'string' ? resource.properties.image.trim() : '';

    const pullRel = ctx.document.relationships.find(
      (r) => r.sourceId === resource.id && r.relationship === 'pulls-image',
    );
    const repo = pullRel
      ? ctx.document.resources.find((r) => r.id === pullRel.targetId)
      : undefined;
    const repoName = repo ? ctx.names.get(repo.id) : undefined;
    const repoDef = repo ? ctx.registry.get(repo.type) : undefined;

    // Priority: explicit image URI (LocalStack / digests) → ECR connection →
    // valid public fallback (never emit angle-brackets — ECS rejects them).
    let imageRef: string;
    let imageComment: string | undefined;
    if (imageOverride) {
      imageRef = JSON.stringify(imageOverride);
    } else if (repo && repoDef && repoName) {
      imageRef = `"\${${repoDef.terraform.resourceType}.${repoName}.repository_url}:${imageTag}"`;
    } else {
      imageRef = JSON.stringify(`public.ecr.aws/docker/library/nginx:${imageTag}`);
      imageComment =
        'WARNING: no ECR connection or image URI — using public nginx. Connect ECR (pulls-image) or set Image URI for real deploys / LocalStack apps.';
    }

    // uses-secret connections become `secrets` entries (valueFrom = <ARN>),
    // resolved by the ECS agent at task start — the value itself never
    // appears in the task definition, plan, or state.
    const secretEntries: { envName: string; arnRef: string; targetType: string }[] = [];
    for (const rel of ctx.document.relationships) {
      if (rel.sourceId !== resource.id || rel.relationship !== 'uses-secret') continue;
      const target = ctx.document.resources.find((r) => r.id === rel.targetId);
      if (!target) continue;
      const targetName = ctx.names.get(target.id);
      const targetDef = ctx.registry.get(target.type);
      if (!targetName || !targetDef) continue;
      secretEntries.push({
        // Terraform-safe names are already unique snake_case, so the derived
        // env var names can't collide.
        envName: targetName.toUpperCase(),
        arnRef: `${targetDef.terraform.resourceType}.${targetName}.arn`,
        targetType: target.type,
      });
    }

    const secretLines =
      secretEntries.length > 0
        ? [
            '      secrets = [',
            secretEntries
              .map((s) => `        { name = "${s.envName}", valueFrom = ${s.arnRef} }`)
              .join(',\n'),
            '      ]',
          ]
        : [];

    // ECS Service → connects-to → RDS: inject DATABASE_URL so LocalStack (and
    // real Fargate) tasks can reach the DB without a separate secrets edge.
    const envEntries: { name: string; valueExpr: string }[] = [];
    const servicesUsingTask = ctx.document.relationships
      .filter((r) => r.relationship === 'runs-task' && r.targetId === resource.id)
      .map((r) => ctx.document.resources.find((res) => res.id === r.sourceId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    for (const service of servicesUsingTask) {
      for (const rel of ctx.document.relationships) {
        if (rel.sourceId !== service.id || rel.relationship !== 'connects-to') continue;
        const target = ctx.document.resources.find((r) => r.id === rel.targetId);
        if (!target || target.type !== 'aws/rds-instance') continue;
        const rdsName = ctx.names.get(target.id);
        const rdsDef = ctx.registry.get(target.type);
        if (!rdsName || !rdsDef) continue;
        const tfType = rdsDef.terraform.resourceType;
        const dbName =
          typeof target.properties.db_name === 'string' && target.properties.db_name.trim()
            ? target.properties.db_name.trim()
            : 'app';
        // Terraform interpolations inside the jsonencode string — password may
        // itself be a ref (uses-secret) on the aws_db_instance resource.
        envEntries.push({
          name: 'DATABASE_URL',
          valueExpr: `"postgres://\${${tfType}.${rdsName}.username}:\${${tfType}.${rdsName}.password}@\${${tfType}.${rdsName}.address}:\${${tfType}.${rdsName}.port}/${dbName}?sslmode=disable"`,
        });
        break;
      }
      if (envEntries.length > 0) break;
    }

    const envLines =
      envEntries.length > 0
        ? [
            '      environment = [',
            envEntries
              .map((e) => `        { name = ${JSON.stringify(e.name)}, value = ${e.valueExpr} }`)
              .join(',\n'),
            '      ]',
          ]
        : [];

    const logGroupName = `/ecs/${family}`;
    const logGroupResourceName = `${name}_logs`;

    // Hand-formatted to match `terraform fmt`: `=` aligned across the run of
    // single-line keys, widest of which is portMappings.
    const containerDefJson = [
      '[',
      '    {',
      `      name         = "${containerName}"`,
      `      image        = ${imageRef}`,
      '      essential    = true',
      `      portMappings = [{ containerPort = ${containerPort}, protocol = "tcp" }]`,
      ...envLines,
      ...secretLines,
      '      logConfiguration = {',
      '        logDriver = "awslogs"',
      '        options = {',
      `          "awslogs-group"         = "${logGroupName}"`,
      `          "awslogs-region"        = "${ctx.region}"`,
      '          "awslogs-stream-prefix" = "ecs"',
      '        }',
      '      }',
      '    }',
      '  ]',
    ].join('\n');

    const extraBlocks = [
      {
        blockType: 'resource',
        labels: ['aws_cloudwatch_log_group', logGroupResourceName],
        attributes: [
          { name: 'name', value: stringValue(logGroupName) },
          { name: 'retention_in_days', value: numberValue(14) },
        ],
        blocks: [],
        comment: `Log group for the "${family}" task definition's container logs`,
      },
    ];

    // Injecting secrets requires the *execution* role (which pulls the image
    // and secrets) to be allowed to read them — grant it read access scoped
    // to exactly the connected ARNs.
    const execRel = ctx.document.relationships.find(
      (r) => r.sourceId === resource.id && r.relationship === 'execution-role',
    );
    const execRole = execRel
      ? ctx.document.resources.find((r) => r.id === execRel.targetId)
      : undefined;
    const execRoleName = execRole ? ctx.names.get(execRole.id) : undefined;

    if (secretEntries.length > 0 && execRoleName) {
      const statements: string[] = [];
      const byAction: [string, string[]][] = [
        [
          'secretsmanager:GetSecretValue',
          secretEntries
            .filter((s) => s.targetType === 'aws/secrets-manager-secret')
            .map((s) => s.arnRef),
        ],
        [
          'ssm:GetParameters',
          secretEntries.filter((s) => s.targetType === 'aws/ssm-parameter').map((s) => s.arnRef),
        ],
      ];
      for (const [action, arns] of byAction) {
        if (arns.length === 0) continue;
        statements.push(
          [
            '      {',
            '        Effect   = "Allow"',
            `        Action   = ["${action}"]`,
            `        Resource = [${arns.join(', ')}]`,
            '      }',
          ].join('\n'),
        );
      }

      const policyJson = [
        '{',
        '    Version = "2012-10-17"',
        '    Statement = [',
        statements.join(',\n'),
        '    ]',
        '  }',
      ].join('\n');

      extraBlocks.push({
        blockType: 'resource',
        labels: ['aws_iam_role_policy', `${name}_secrets_access`],
        attributes: [
          { name: 'name', value: stringValue(`${family}-secrets-access`) },
          { name: 'role', value: traversal('aws_iam_role', execRoleName, 'id') },
          { name: 'policy', value: rawValue(`jsonencode(${policyJson})`) },
        ],
        blocks: [],
        comment: `Lets the "${family}" execution role read the secrets injected into its containers`,
      });
    }

    const comments: string[] = [];
    if (imageComment) comments.push(imageComment);
    if (secretEntries.length > 0 && !execRoleName) {
      comments.push(
        'WARNING: secrets are injected below but no Execution Role is connected — ECS cannot pull them at task start. Connect an IAM Role via the "Execution Role" connection.',
      );
    }

    return {
      attributes: [
        { name: 'container_definitions', value: rawValue(`jsonencode(${containerDefJson})`) },
      ],
      extraBlocks,
      comment: comments.length > 0 ? comments.join(' ') : undefined,
    };
  });

  registerResourceEmitter('aws/alb', (resource, ctx) => {
    const subnets = subnetRefs(resource, ctx);
    if (subnets.length === 0) return {};
    return {
      attributes: [{ name: 'subnets', value: listValue(subnets) }],
      comment:
        subnets.length < 2
          ? 'WARNING: an Application Load Balancer needs subnets in at least two Availability Zones — add an "Also spans Subnet" connection to a second subnet.'
          : undefined,
    };
  });

  registerResourceEmitter('aws/lambda-function', (resource, ctx) => {
    // vpc_config is only valid when the function actually runs in a VPC, and
    // Terraform requires both subnet_ids and security_group_ids together.
    const subnets = subnetRefs(resource, ctx);
    const groups = securityGroupRefs(resource, ctx);
    if (subnets.length === 0 || groups.length === 0) return {};

    return {
      blocks: [
        {
          blockType: 'vpc_config',
          labels: [],
          attributes: [
            { name: 'subnet_ids', value: listValue(subnets) },
            { name: 'security_group_ids', value: listValue(groups) },
          ],
          blocks: [],
        },
      ],
    };
  });

  registerResourceEmitter('aws/dynamodb-table', (resource) => {
    // Terraform requires an `attribute` definition for every key attribute.
    const hashKey = String(resource.properties.hash_key || 'id');
    const hashType = String(resource.properties.hash_key_type || 'S');
    const rangeKey = resource.properties.range_key;
    const rangeType = String(resource.properties.range_key_type || 'S');

    const attributeBlock = (name: string, type: string) => ({
      blockType: 'attribute',
      labels: [] as string[],
      attributes: [
        { name: 'name', value: stringValue(name) },
        { name: 'type', value: stringValue(type) },
      ],
      blocks: [],
    });

    const blocks = [attributeBlock(hashKey, hashType)];
    if (typeof rangeKey === 'string' && rangeKey !== '') {
      blocks.push(attributeBlock(rangeKey, rangeType));
    }

    return { blocks };
  });

  registerResourceEmitter('aws/secrets-manager-secret', (resource, ctx) => {
    const name = ctx.names.get(resource.id);
    if (!name) return {};

    const source = resource.properties.source === 'variable' ? 'variable' : 'generated-password';
    const versionName = `${name}_version`;

    if (source === 'variable') {
      const varName = `${name}_value`;
      return {
        extraBlocks: [
          {
            blockType: 'variable',
            labels: [varName],
            attributes: [
              { name: 'type', value: rawValue('string') },
              { name: 'sensitive', value: boolValue(true) },
            ],
            blocks: [],
            comment: `Provide via terraform.tfvars or TF_VAR_${varName} — never commit the real value`,
          },
          {
            blockType: 'resource',
            labels: ['aws_secretsmanager_secret_version', versionName],
            attributes: [
              { name: 'secret_id', value: traversal('aws_secretsmanager_secret', name, 'id') },
              { name: 'secret_string', value: traversal('var', varName) },
            ],
            blocks: [],
          },
        ],
      };
    }

    const passwordName = `${name}_password`;
    return {
      extraBlocks: [
        {
          blockType: 'resource',
          labels: ['random_password', passwordName],
          attributes: [
            { name: 'length', value: numberValue(20) },
            { name: 'special', value: boolValue(true) },
          ],
          blocks: [],
          comment: 'Value only ever appears in Terraform state, never in source',
        },
        {
          blockType: 'resource',
          labels: ['aws_secretsmanager_secret_version', versionName],
          attributes: [
            { name: 'secret_id', value: traversal('aws_secretsmanager_secret', name, 'id') },
            { name: 'secret_string', value: traversal('random_password', passwordName, 'result') },
          ],
          blocks: [],
        },
      ],
    };
  });
}
