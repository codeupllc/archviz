import { defineResource, prop, ref } from '@archviz/schema';

export const subnet = defineResource({
  id: 'aws/subnet',
  provider: 'aws',
  display: {
    label: 'Subnet',
    icon: 'subnet',
    category: 'networking',
    kind: 'container',
    description: 'Subnet within a VPC',
  },
  capabilities: ['network-boundary'],
  nesting: {
    allowedParents: [{ type: 'aws/vpc', required: true }],
  },
  connections: [],
  properties: [
    {
      name: 'cidr_block',
      type: 'cidr',
      required: true,
      label: 'CIDR Block',
      default: '10.0.1.0/24',
    },
    {
      name: 'availability_zone',
      type: 'string',
      required: false,
      label: 'Availability Zone',
    },
    {
      name: 'map_public_ip_on_launch',
      type: 'boolean',
      required: false,
      label: 'Map Public IP on Launch',
      default: false,
    },
  ],
  terraform: {
    resourceType: 'aws_subnet',
    attributes: {
      vpc_id: ref.parent('aws/vpc', 'id'),
      cidr_block: prop('cidr_block'),
      availability_zone: prop('availability_zone'),
      map_public_ip_on_launch: prop('map_public_ip_on_launch'),
    },
  },
});
