import type { Materializer } from './materialize.js';
import { registerMaterializer } from './materialize.js';
import { numberValue, rawValue, stringValue, traversal } from './ast.js';
import { secretValueRef } from './aws-emitters.js';
import type { ArchvizDocument } from '@archviz/core';

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
      // Described by security group, not by the connected resources: several
      // resources can share the same SG pair, and the resulting rule is
      // identical — generate.ts dedupes them by name.
      const description = `${srcSg.name} → ${tgtSg.name}`;

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
            value: { kind: 'string' as const, value: description },
          },
        ],
        blocks: [],
        comment: `connects-to: ${description}`,
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
            value: { kind: 'string' as const, value: description },
          },
        ],
        blocks: [],
      });
    }
  }

  return { extraBlocks: blocks };
};

/**
 * ALB —routes-to→ Target Group becomes a real `aws_lb_listener` with a
 * forward default_action. The listener's port/protocol follow the target
 * group's, which is the common single-service case.
 */
export const lbListenerMaterializer: Materializer = (ctx) => {
  const albName = ctx.names.get(ctx.source.id);
  const tgName = ctx.names.get(ctx.target.id);
  if (!albName || !tgName) return {};

  const protocol = String(ctx.target.properties.protocol ?? 'HTTP');
  const port = Number(ctx.target.properties.port ?? 80);

  return {
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_lb_listener', `${albName}_to_${tgName}`],
        attributes: [
          { name: 'load_balancer_arn', value: traversal('aws_lb', albName, 'arn') },
          { name: 'port', value: numberValue(port) },
          { name: 'protocol', value: stringValue(protocol) },
        ],
        blocks: [
          {
            blockType: 'default_action',
            labels: [],
            attributes: [
              { name: 'type', value: stringValue('forward') },
              {
                name: 'target_group_arn',
                value: traversal('aws_lb_target_group', tgName, 'arn'),
              },
            ],
            blocks: [],
          },
        ],
        comment: `routes-to: ${ctx.source.name} → ${ctx.target.name}`,
      },
    ],
  };
};

/**
 * Target Group —forwards-to→ EC2 becomes an attachment. The target group arn
 * comes from the *source* (the group), the target id from the instance.
 */
export const lbTargetAttachmentMaterializer: Materializer = (ctx) => {
  const tgName = ctx.names.get(ctx.source.id);
  const targetName = ctx.names.get(ctx.target.id);
  if (!tgName || !targetName) return {};

  const attributes = [
    { name: 'target_group_arn', value: traversal('aws_lb_target_group', tgName, 'arn') },
    {
      name: 'target_id',
      value: traversal(ctx.targetDef.terraform.resourceType, targetName, 'id'),
    },
  ];

  const port = ctx.source.properties.port;
  if (typeof port === 'number') {
    attributes.push({ name: 'port', value: numberValue(port) });
  }

  return {
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_lb_target_group_attachment', `${tgName}_to_${targetName}`],
        attributes,
        blocks: [],
        comment: `forwards-to: ${ctx.source.name} → ${ctx.target.name}`,
      },
    ],
  };
};

/**
 * EC2 —assumes→ IAM Role: `iam_instance_profile` needs an instance *profile*,
 * not the role itself, so emit the profile wrapper and point the instance at it.
 */
export const instanceProfileMaterializer: Materializer = (ctx) => {
  const instanceName = ctx.names.get(ctx.source.id);
  const roleName = ctx.names.get(ctx.target.id);
  if (!instanceName || !roleName) return {};

  const profileName = `${instanceName}_profile`;

  return {
    sourceAttributes: [
      {
        name: 'iam_instance_profile',
        value: traversal('aws_iam_instance_profile', profileName, 'name'),
      },
    ],
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_iam_instance_profile', profileName],
        attributes: [
          { name: 'name', value: rawValue(`"${instanceName}-profile"`) },
          { name: 'role', value: traversal('aws_iam_role', roleName, 'name') },
        ],
        blocks: [],
        comment: `assumes: ${ctx.source.name} → ${ctx.target.name} (EC2 needs an instance profile, not the role directly)`,
      },
    ],
  };
};

const SQS_CONSUME_ACTIONS = [
  'sqs:ReceiveMessage',
  'sqs:DeleteMessage',
  'sqs:GetQueueAttributes',
  'sqs:ChangeMessageVisibility',
];

const SQS_PRODUCE_ACTIONS = ['sqs:SendMessage', 'sqs:GetQueueAttributes', 'sqs:GetQueueUrl'];

const S3_CONSUME_OBJECT_ACTIONS = ['s3:GetObject'];
const S3_CONSUME_BUCKET_ACTIONS = ['s3:ListBucket', 's3:GetBucketLocation'];
const S3_PRODUCE_OBJECT_ACTIONS = ['s3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'];
const S3_PRODUCE_BUCKET_ACTIONS = ['s3:ListBucket'];

const DDB_CONSUME_ACTIONS = [
  'dynamodb:GetItem',
  'dynamodb:BatchGetItem',
  'dynamodb:Query',
  'dynamodb:Scan',
  'dynamodb:DescribeTable',
  'dynamodb:ConditionCheckItem',
];

const DDB_PRODUCE_ACTIONS = [
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:BatchWriteItem',
  'dynamodb:DescribeTable',
];

type ApiAccess = 'consume' | 'produce';

/**
 * Resolves the IAM role the source compute workload assumes:
 * - Lambda / EC2: direct `assumes` connection
 * - ECS Service: `runs-task` → Task Definition → `task-role` (app permissions, not execution role)
 * - ECS Task Definition: direct `task-role`
 */
function resolveWorkloadRoleName(
  source: { id: string; type: string; name: string },
  document: ArchvizDocument,
  names: Map<string, string>,
): string | null {
  const assumes = document.relationships.find(
    (r) => r.sourceId === source.id && r.relationship === 'assumes',
  );
  if (assumes) return names.get(assumes.targetId) ?? null;

  if (source.type === 'aws/ecs-task-definition') {
    const taskRole = document.relationships.find(
      (r) => r.sourceId === source.id && r.relationship === 'task-role',
    );
    return taskRole ? (names.get(taskRole.targetId) ?? null) : null;
  }

  if (source.type === 'aws/ecs-service') {
    const runsTask = document.relationships.find(
      (r) => r.sourceId === source.id && r.relationship === 'runs-task',
    );
    if (!runsTask) return null;
    const taskRole = document.relationships.find(
      (r) => r.sourceId === runsTask.targetId && r.relationship === 'task-role',
    );
    return taskRole ? (names.get(taskRole.targetId) ?? null) : null;
  }

  return null;
}

function formatActionList(actions: string[]): string {
  return actions.map((a) => `"${a}"`).join(', ');
}

function iamStatementsForTarget(
  targetType: string,
  tfName: string,
  access: ApiAccess,
): { kind: string; statements: string[] } | null {
  if (targetType === 'aws/sqs-queue') {
    const actions = access === 'produce' ? SQS_PRODUCE_ACTIONS : SQS_CONSUME_ACTIONS;
    return {
      kind: 'sqs',
      statements: [
        [
          '      {',
          '        Effect   = "Allow"',
          `        Action   = [${formatActionList(actions)}]`,
          `        Resource = [aws_sqs_queue.${tfName}.arn]`,
          '      }',
        ].join('\n'),
      ],
    };
  }

  if (targetType === 'aws/sns-topic') {
    // SNS is publish-oriented from compute; consume is via subscription endpoints.
    if (access !== 'produce') return null;
    return {
      kind: 'sns',
      statements: [
        [
          '      {',
          '        Effect   = "Allow"',
          `        Action   = ["sns:Publish"]`,
          `        Resource = [aws_sns_topic.${tfName}.arn]`,
          '      }',
        ].join('\n'),
      ],
    };
  }

  if (targetType === 'aws/s3-bucket') {
    const bucketActions =
      access === 'produce' ? S3_PRODUCE_BUCKET_ACTIONS : S3_CONSUME_BUCKET_ACTIONS;
    const objectActions =
      access === 'produce' ? S3_PRODUCE_OBJECT_ACTIONS : S3_CONSUME_OBJECT_ACTIONS;
    return {
      kind: 's3',
      statements: [
        [
          '      {',
          '        Effect   = "Allow"',
          `        Action   = [${formatActionList(bucketActions)}]`,
          `        Resource = [aws_s3_bucket.${tfName}.arn]`,
          '      }',
        ].join('\n'),
        [
          '      {',
          '        Effect   = "Allow"',
          `        Action   = [${formatActionList(objectActions)}]`,
          `        Resource = ["\${aws_s3_bucket.${tfName}.arn}/*"]`,
          '      }',
        ].join('\n'),
      ],
    };
  }

  if (targetType === 'aws/dynamodb-table') {
    const actions = access === 'produce' ? DDB_PRODUCE_ACTIONS : DDB_CONSUME_ACTIONS;
    return {
      kind: 'dynamodb',
      statements: [
        [
          '      {',
          '        Effect = "Allow"',
          `        Action = [${formatActionList(actions)}]`,
          `        Resource = [`,
          `          aws_dynamodb_table.${tfName}.arn,`,
          `          "\${aws_dynamodb_table.${tfName}.arn}/index/*",`,
          '        ]',
          '      }',
        ].join('\n'),
      ],
    };
  }

  return null;
}

/**
 * Lambda/EC2/ECS —reads-from|writes-to→ SQS / S3 / DynamoDB: grant the assumed
 * workload role resource-scoped IAM (consume vs produce). Without a role,
 * emits a WARNING comment instead of a policy.
 */
export const apiIamMaterializer: Materializer = (ctx) => {
  const access: ApiAccess =
    (ctx.rule.materialize as { strategy: string; access?: ApiAccess }).access ??
    (ctx.relationship.relationship === 'writes-to' ? 'produce' : 'consume');

  const sourceName = ctx.names.get(ctx.source.id);
  const targetName = ctx.names.get(ctx.target.id);
  if (!sourceName || !targetName) return {};

  const spec = iamStatementsForTarget(ctx.target.type, targetName, access);
  if (!spec) {
    return {
      comment: `annotation: ${ctx.source.name} ${ctx.relationship.relationship} ${ctx.target.name} (no IAM mapping)`,
    };
  }

  const roleName = resolveWorkloadRoleName(ctx.source, ctx.document, ctx.names);
  if (!roleName) {
    const roleHint =
      ctx.source.type === 'aws/ecs-service' || ctx.source.type === 'aws/ecs-task-definition'
        ? 'Task Role on the Task Definition'
        : 'assumes → IAM Role';
    return {
      comment: `WARNING: ${ctx.source.name} ${ctx.relationship.relationship} ${ctx.target.name} but no ${roleHint} is connected — no ${spec.kind.toUpperCase()} IAM policy emitted`,
    };
  }

  const policyName = `${sourceName}_${spec.kind}_${access}_${targetName}`;
  const policyJson = [
    '{',
    '    Version = "2012-10-17"',
    '    Statement = [',
    spec.statements.join(',\n'),
    '    ]',
    '  }',
  ].join('\n');

  return {
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_iam_role_policy', policyName],
        attributes: [
          {
            name: 'name',
            value: stringValue(`${ctx.source.name}-${spec.kind}-${access}-${ctx.target.name}`),
          },
          { name: 'role', value: traversal('aws_iam_role', roleName, 'id') },
          { name: 'policy', value: rawValue(`jsonencode(${policyJson})`) },
        ],
        blocks: [],
        comment: `${ctx.relationship.relationship}: ${ctx.source.name} → ${ctx.target.name} (${access} on assumed role)`,
      },
    ],
  };
};

/** @deprecated Prefer apiIamMaterializer — kept as an alias for SQS-era call sites. */
export const sqsIamMaterializer = apiIamMaterializer;

/**
 * Shared `reads-from` edge: SQS / S3 / DynamoDB get consume IAM on the assumed role.
 */
export const readsFromMaterializer: Materializer = (ctx) => {
  if (
    ctx.target.type === 'aws/sqs-queue' ||
    ctx.target.type === 'aws/s3-bucket' ||
    ctx.target.type === 'aws/dynamodb-table'
  ) {
    return apiIamMaterializer(ctx);
  }
  return {
    comment: `annotation: ${ctx.source.name} ${ctx.relationship.relationship} ${ctx.target.name} (no HCL emitted)`,
  };
};

/**
 * SNS Topic —delivers-to→ SQS Queue: subscription + queue policy allowing SNS to SendMessage.
 */
export const snsSqsSubscriptionMaterializer: Materializer = (ctx) => {
  const topicName = ctx.names.get(ctx.source.id);
  const queueName = ctx.names.get(ctx.target.id);
  if (!topicName || !queueName) return {};

  const subName = `${topicName}_to_${queueName}`;
  const policyName = `${queueName}_from_${topicName}`;
  const queuePolicyJson = [
    '{',
    '    Version = "2012-10-17"',
    '    Statement = [',
    '      {',
    '        Effect    = "Allow"',
    '        Principal = { Service = "sns.amazonaws.com" }',
    '        Action    = "sqs:SendMessage"',
    `        Resource  = aws_sqs_queue.${queueName}.arn`,
    '        Condition = {',
    '          ArnEquals = {',
    `            "aws:SourceArn" = aws_sns_topic.${topicName}.arn`,
    '          }',
    '        }',
    '      }',
    '    ]',
    '  }',
  ].join('\n');

  return {
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_sns_topic_subscription', subName],
        attributes: [
          { name: 'topic_arn', value: traversal('aws_sns_topic', topicName, 'arn') },
          { name: 'protocol', value: stringValue('sqs') },
          { name: 'endpoint', value: traversal('aws_sqs_queue', queueName, 'arn') },
        ],
        blocks: [],
        comment: `delivers-to: ${ctx.source.name} → ${ctx.target.name}`,
      },
      {
        blockType: 'resource',
        labels: ['aws_sqs_queue_policy', policyName],
        attributes: [
          { name: 'queue_url', value: traversal('aws_sqs_queue', queueName, 'id') },
          { name: 'policy', value: rawValue(`jsonencode(${queuePolicyJson})`) },
        ],
        blocks: [],
        comment: `Allows SNS topic "${ctx.source.name}" to deliver to queue "${ctx.target.name}"`,
      },
    ],
  };
};

/**
 * API Gateway HTTP API —routes-to→ Lambda becomes an integration, route, and
 * auto-deploy stage. This creates the minimal HTTP API to Lambda proxy setup.
 */
export const apigwHttpRouteMaterializer: Materializer = (ctx) => {
  const apiName = ctx.names.get(ctx.source.id);
  const lambdaName = ctx.names.get(ctx.target.id);
  if (!apiName || !lambdaName) return {};

  const integrationName = `${apiName}_to_${lambdaName}_integration`;
  const routeName = `${apiName}_to_${lambdaName}_route`;
  const stageName = `${apiName}_stage`;

  return {
    extraBlocks: [
      {
        blockType: 'resource',
        labels: ['aws_apigatewayv2_integration', integrationName],
        attributes: [
          { name: 'api_id', value: traversal('aws_apigatewayv2_api', apiName, 'id') },
          { name: 'integration_type', value: stringValue('AWS_PROXY') },
          { name: 'integration_method', value: stringValue('POST') },
          {
            name: 'integration_uri',
            value: traversal('aws_lambda_function', lambdaName, 'invoke_arn'),
          },
          { name: 'payload_format_version', value: stringValue('2.0') },
        ],
        blocks: [],
        comment: `routes-to: ${ctx.source.name} → ${ctx.target.name} (integration)`,
      },
      {
        blockType: 'resource',
        labels: ['aws_apigatewayv2_route', routeName],
        attributes: [
          { name: 'api_id', value: traversal('aws_apigatewayv2_api', apiName, 'id') },
          { name: 'route_key', value: stringValue('ANY /{proxy+}') },
          {
            name: 'target',
            value: rawValue(
              `"integrations/\${aws_apigatewayv2_integration.${integrationName}.id}"`,
            ),
          },
        ],
        blocks: [],
        comment: `routes-to: ${ctx.source.name} → ${ctx.target.name} (route)`,
      },
      {
        blockType: 'resource',
        labels: ['aws_apigatewayv2_stage', stageName],
        attributes: [
          { name: 'api_id', value: traversal('aws_apigatewayv2_api', apiName, 'id') },
          { name: 'name', value: stringValue('$default') },
          { name: 'auto_deploy', value: { kind: 'boolean' as const, value: true } },
        ],
        blocks: [],
        comment: `Auto-deploy stage for ${ctx.source.name}`,
      },
      {
        blockType: 'resource',
        labels: ['aws_lambda_permission', `${apiName}_invoke_${lambdaName}`],
        attributes: [
          { name: 'statement_id', value: stringValue(`Allow${apiName}Invoke`) },
          { name: 'action', value: stringValue('lambda:InvokeFunction') },
          {
            name: 'function_name',
            value: traversal('aws_lambda_function', lambdaName, 'function_name'),
          },
          { name: 'principal', value: stringValue('apigateway.amazonaws.com') },
          {
            name: 'source_arn',
            value: rawValue(
              `"\${aws_apigatewayv2_api.${apiName}.execution_arn}/*/*"`,
            ),
          },
        ],
        blocks: [],
        comment: `routes-to: allow ${ctx.source.name} to invoke ${ctx.target.name}`,
      },
    ],
  };
};

let awsRegistered = false;

export function registerAwsMaterializers(): void {
  if (awsRegistered) return;
  registerMaterializer('sg-rule-pair', sgRulePairMaterializer);
  registerMaterializer('sg-rule-pair:aws', sgRulePairMaterializer);
  registerMaterializer('secret-value-ref', secretValueRefMaterializer);
  registerMaterializer('lb-listener', lbListenerMaterializer);
  registerMaterializer('lb-target-attachment', lbTargetAttachmentMaterializer);
  registerMaterializer('instance-profile', instanceProfileMaterializer);
  registerMaterializer('api-iam', apiIamMaterializer);
  registerMaterializer('sqs-iam', apiIamMaterializer);
  registerMaterializer('reads-from', readsFromMaterializer);
  registerMaterializer('sns-sqs-subscription', snsSqsSubscriptionMaterializer);
  registerMaterializer('apigw-http-route', apigwHttpRouteMaterializer);
  awsRegistered = true;
}
