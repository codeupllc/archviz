import { defineResource, prop } from '@archviz/schema';

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
      name: 'assume_role_policy',
      type: 'string',
      required: true,
      label: 'Assume Role Policy (JSON)',
      default: JSON.stringify(
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
      ),
    },
  ],
  terraform: {
    resourceType: 'aws_iam_role',
    attributes: {
      assume_role_policy: prop('assume_role_policy'),
    },
  },
});
