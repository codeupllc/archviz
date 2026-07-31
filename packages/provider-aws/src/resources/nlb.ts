import { defineResource, prop, ref } from '@archviz/schema';

export const nlb = defineResource({
  id: 'aws/nlb',
  provider: 'aws',
  display: {
    label: 'Network Load Balancer',
    icon: 'nlb',
    category: 'networking',
    kind: 'node',
    description: 'Layer-4 (TCP/UDP) load balancer',
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
      materialize: { strategy: 'lb-listener' },
      label: 'Routes to',
    },
    {
      relationship: 'runs-in',
      targets: [{ type: 'aws/subnet' }],
      materialize: { strategy: 'annotation' },
      label: 'Also spans Subnet',
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
      enumValues: ['network'],
      default: 'network',
      label: 'Type',
    },
  ],
  terraform: {
    resourceType: 'aws_lb',
    attributes: {
      internal: prop('internal'),
      load_balancer_type: prop('load_balancer_type'),
      security_groups: ref.rel('attached-to', 'id', true),
      // `subnets` synthesized by the shared LB emitter (parent + runs-in).
    },
  },
});
