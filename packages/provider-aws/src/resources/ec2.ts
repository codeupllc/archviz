import { defineResource, prop, ref } from '@archviz/schema';

export const ec2Instance = defineResource({
  id: 'aws/ec2-instance',
  provider: 'aws',
  display: {
    label: 'EC2 Instance',
    icon: 'ec2',
    category: 'compute',
    kind: 'node',
    description: 'Virtual machine instance',
  },
  capabilities: ['network-client', 'compute'],
  nesting: {
    allowedParents: [{ type: 'aws/subnet', required: true }],
  },
  connections: [
    {
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'attribute', attribute: 'vpc_security_group_ids' },
      label: 'Security Group',
    },
    {
      relationship: 'connects-to',
      targets: [{ capability: 'network-service' }],
      materialize: { strategy: 'sg-rule-pair' },
      label: 'Connects to',
    },
    {
      relationship: 'reads-from',
      targets: [
        { type: 'aws/s3-bucket' },
        { type: 'aws/dynamodb-table' },
        { type: 'aws/sqs-queue' },
      ],
      materialize: { strategy: 'annotation' },
      label: 'Reads from',
    },
    {
      relationship: 'assumes',
      targets: [{ type: 'aws/iam-role' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'instance-profile' },
      label: 'IAM Role',
    },
  ],
  properties: [
    {
      name: 'instance_type',
      type: 'enum',
      required: true,
      label: 'Instance Type',
      enumValues: [
        't3.micro',
        't3.small',
        't3.medium',
        't3.large',
        'm5.large',
        'm5.xlarge',
        'c5.large',
      ],
      default: 't3.micro',
    },
    {
      name: 'ami',
      type: 'string',
      required: true,
      label: 'AMI ID',
      validate: { pattern: '^ami-' },
      default: 'ami-0c55b159cbfafe1f0',
    },
  ],
  terraform: {
    resourceType: 'aws_instance',
    attributes: {
      ami: prop('ami'),
      instance_type: prop('instance_type'),
      subnet_id: ref.parent('aws/subnet', 'id'),
      vpc_security_group_ids: ref.rel('attached-to', 'id', true),
    },
  },
});
