import { defineResource, prop } from '@archviz/schema';

export const vpc = defineResource({
  id: 'aws/vpc',
  provider: 'aws',
  display: {
    label: 'VPC',
    icon: 'vpc',
    category: 'networking',
    kind: 'container',
    description: 'Virtual Private Cloud network boundary',
  },
  capabilities: ['network-boundary'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'cidr_block',
      type: 'cidr',
      required: true,
      label: 'CIDR Block',
      default: '10.0.0.0/16',
    },
    {
      name: 'enable_dns_hostnames',
      type: 'boolean',
      required: false,
      label: 'Enable DNS Hostnames',
      default: true,
    },
    {
      name: 'enable_dns_support',
      type: 'boolean',
      required: false,
      label: 'Enable DNS Support',
      default: true,
    },
  ],
  terraform: {
    resourceType: 'aws_vpc',
    attributes: {
      cidr_block: prop('cidr_block'),
      enable_dns_hostnames: prop('enable_dns_hostnames'),
      enable_dns_support: prop('enable_dns_support'),
    },
  },
});
