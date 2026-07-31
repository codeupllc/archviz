import { defineResource, ref } from '@archviz/schema';

export const internetGateway = defineResource({
  id: 'aws/internet-gateway',
  provider: 'aws',
  display: {
    label: 'Internet Gateway',
    icon: 'igw',
    category: 'networking',
    kind: 'node',
    description: 'VPC internet egress / ingress gateway',
  },
  capabilities: [],
  nesting: {
    allowedParents: [{ type: 'aws/vpc', required: true }],
  },
  connections: [],
  properties: [],
  terraform: {
    resourceType: 'aws_internet_gateway',
    attributes: {
      vpc_id: ref.parent('aws/vpc', 'id'),
    },
  },
});
