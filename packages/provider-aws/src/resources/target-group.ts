import { defineResource, prop, ref } from '@archviz/schema';

export const targetGroup = defineResource({
  id: 'aws/target-group',
  provider: 'aws',
  display: {
    label: 'Target Group',
    icon: 'target-group',
    category: 'networking',
    kind: 'node',
    description: 'Load balancer target group',
  },
  capabilities: ['load-balancer-target'],
  nesting: {
    allowedParents: [{ type: 'aws/vpc', required: true }],
  },
  connections: [
    {
      relationship: 'forwards-to',
      targets: [{ type: 'aws/ec2-instance' }],
      cardinality: { maxOutgoing: null },
      materialize: { strategy: 'resource', via: 'aws_lb_target_group_attachment' },
      label: 'Forwards to',
    },
  ],
  properties: [
    {
      name: 'port',
      type: 'number',
      required: true,
      default: 80,
      label: 'Port',
      validate: { min: 1, max: 65535 },
    },
    {
      name: 'protocol',
      type: 'enum',
      required: true,
      enumValues: ['HTTP', 'HTTPS', 'TCP'],
      default: 'HTTP',
      label: 'Protocol',
    },
    {
      name: 'target_type',
      type: 'enum',
      required: true,
      enumValues: ['instance', 'ip', 'lambda'],
      default: 'instance',
      label: 'Target Type',
    },
  ],
  terraform: {
    resourceType: 'aws_lb_target_group',
    attributes: {
      port: prop('port'),
      protocol: prop('protocol'),
      target_type: prop('target_type'),
      vpc_id: ref.parent('aws/vpc', 'id'),
    },
  },
});
