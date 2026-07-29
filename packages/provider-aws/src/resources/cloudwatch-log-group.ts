import { defineResource, prop } from '@archviz/schema';

export const cloudwatchLogGroup = defineResource({
  id: 'aws/cloudwatch-log-group',
  provider: 'aws',
  display: {
    label: 'CloudWatch Log Group',
    icon: 'cloudwatch',
    category: 'management',
    kind: 'node',
    description: 'Log storage for Lambda, ECS, and other AWS services',
  },
  capabilities: ['log-destination'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'name',
      type: 'string',
      required: true,
      label: 'Log Group Name',
      default: '/aws/lambda/my-function',
      description:
        'Name of the log group. Common patterns: /aws/lambda/<function-name> or /ecs/<service-name>',
    },
    {
      name: 'retention_in_days',
      type: 'number',
      required: false,
      label: 'Retention (days)',
      default: 7,
      description: 'Number of days to retain log events. 0 means never expire.',
    },
  ],
  terraform: {
    resourceType: 'aws_cloudwatch_log_group',
    attributes: {
      name: prop('name'),
      retention_in_days: prop('retention_in_days'),
    },
  },
});
