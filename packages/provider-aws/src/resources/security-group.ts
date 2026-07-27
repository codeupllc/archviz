import { defineResource, prop, ref } from '@archviz/schema';

export const securityGroup = defineResource({
  id: 'aws/security-group',
  provider: 'aws',
  display: {
    label: 'Security Group',
    icon: 'sg',
    category: 'security',
    kind: 'node',
    description: 'Virtual firewall for instances',
  },
  capabilities: ['security-boundary'],
  nesting: {
    allowedParents: [{ type: 'aws/vpc', required: true }],
  },
  connections: [],
  properties: [
    {
      name: 'description',
      type: 'string',
      required: true,
      label: 'Description',
      default: 'Managed by Archviz',
    },
  ],
  terraform: {
    resourceType: 'aws_security_group',
    attributes: {
      description: prop('description'),
      vpc_id: ref.parent('aws/vpc', 'id'),
    },
  },
});
