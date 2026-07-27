import { defineResource, prop, ref } from '@archviz/schema';

export const alb = defineResource({
  id: 'aws/alb',
  provider: 'aws',
  display: {
    label: 'Application Load Balancer',
    icon: 'alb',
    category: 'networking',
    kind: 'node',
    description: 'Layer-7 load balancer',
  },
  capabilities: ['network-service', 'load-balancer'],
  nesting: {
    allowedParents: [{ type: 'aws/subnet', required: true }],
  },
  connections: [
    {
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'attribute', attribute: 'security_groups' },
      label: 'Security Group',
    },
    {
      relationship: 'routes-to',
      targets: [{ type: 'aws/target-group' }],
      cardinality: { maxOutgoing: null },
      materialize: { strategy: 'resource', via: 'aws_lb_listener' },
      label: 'Routes to',
    },
  ],
  properties: [
    {
      name: 'internal',
      type: 'boolean',
      required: false,
      default: false,
      label: 'Internal',
    },
    {
      name: 'load_balancer_type',
      type: 'enum',
      required: true,
      enumValues: ['application'],
      default: 'application',
      label: 'Type',
    },
  ],
  terraform: {
    resourceType: 'aws_lb',
    attributes: {
      internal: prop('internal'),
      load_balancer_type: prop('load_balancer_type'),
      security_groups: ref.rel('attached-to', 'id', true),
      subnets: ref.parent('aws/subnet', 'id'),
    },
  },
});
