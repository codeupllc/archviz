import { defineResource, prop } from '@archviz/schema';

const DEFAULT_EC2_TRUST = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { Service: 'ec2.amazonaws.com' },
      },
    ],
  },
  null,
  2,
);

export const iamRole = defineResource({
  id: 'aws/iam-role',
  provider: 'aws',
  display: {
    label: 'IAM Role',
    icon: 'iam-role',
    category: 'security',
    kind: 'node',
    description: 'Identity and access role',
  },
  capabilities: ['identity'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'trust_principal',
      type: 'enum',
      required: false,
      enumValues: ['ec2', 'lambda', 'ecs-tasks', 'custom'],
      default: 'ec2',
      label: 'Trusted Service',
      description:
        'Who may assume this role. Pick Custom to paste a full assume-role policy JSON.',
    },
    {
      name: 'assume_role_policy',
      type: 'string',
      required: false,
      label: 'Assume Role Policy (JSON)',
      description: 'Used when Trusted Service is Custom (or as a starting template).',
      default: DEFAULT_EC2_TRUST,
    },
  ],
  terraform: {
    resourceType: 'aws_iam_role',
    attributes: {
      // Presets overwrite this via the iam-role emitter; custom keeps the prop.
      assume_role_policy: prop('assume_role_policy'),
    },
  },
});
