import type { ResourceInstance } from '@archviz/core';
import { registerResourceEmitter } from './emit.js';
import type { HclValue } from './ast.js';
import { rawValue, stringValue, numberValue, boolValue, traversal } from './ast.js';

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

    const pullRel = ctx.document.relationships.find(
      (r) => r.sourceId === resource.id && r.relationship === 'pulls-image',
    );
    const repo = pullRel
      ? ctx.document.resources.find((r) => r.id === pullRel.targetId)
      : undefined;
    const repoName = repo ? ctx.names.get(repo.id) : undefined;
    const repoDef = repo ? ctx.registry.get(repo.type) : undefined;

    const imageRef =
      repo && repoDef && repoName
        ? `"\${${repoDef.terraform.resourceType}.${repoName}.repository_url}:${imageTag}"`
        : `"<connect an ECR Repository to set the image>:${imageTag}"`;

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

    const logGroupName = `/ecs/${family}`;
    const logGroupResourceName = `${name}_logs`;

    const containerDefJson = [
      '[',
      '    {',
      `      name      = "${containerName}"`,
      `      image     = ${imageRef}`,
      '      essential = true',
      `      portMappings = [{ containerPort = ${containerPort}, protocol = "tcp" }]`,
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

    return {
      attributes: [
        { name: 'container_definitions', value: rawValue(`jsonencode(${containerDefJson})`) },
      ],
      extraBlocks,
      comment:
        secretEntries.length > 0 && !execRoleName
          ? 'WARNING: secrets are injected below but no Execution Role is connected — ECS cannot pull them at task start. Connect an IAM Role via the "Execution Role" connection.'
          : undefined,
    };
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
