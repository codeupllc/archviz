import { defineResource, prop, ref } from '@archviz/schema';

export const ecsService = defineResource({
  id: 'aws/ecs-service',
  provider: 'aws',
  display: {
    label: 'ECS Service',
    icon: 'ecs',
    category: 'compute',
    kind: 'node',
    description: 'Keeps N copies of a Task Definition running on a Cluster',
  },
  capabilities: ['compute', 'network-client'],
  nesting: {
    allowedParents: [{ type: 'aws/ecs-cluster', required: true }],
  },
  connections: [
    {
      relationship: 'runs-task',
      targets: [{ type: 'aws/ecs-task-definition' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'attribute', attribute: 'task_definition' },
      label: 'Task Definition',
    },
    {
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'annotation' },
      label: 'Security Group',
    },
    {
      relationship: 'runs-in',
      targets: [{ type: 'aws/subnet' }],
      materialize: { strategy: 'annotation' },
      label: 'Subnet',
    },
    {
      relationship: 'connects-to',
      targets: [{ capability: 'network-service' }],
      materialize: { strategy: 'sg-rule-pair' },
      label: 'Connects to',
    },
    {
      relationship: 'reads-from',
      targets: [{ type: 'aws/s3-bucket' }, { type: 'aws/dynamodb-table' }],
      materialize: { strategy: 'annotation' },
      label: 'Reads from',
    },
  ],
  properties: [
    {
      name: 'service_name',
      type: 'string',
      required: true,
      label: 'Service Name',
      default: 'app-service',
    },
    {
      name: 'desired_count',
      type: 'number',
      required: false,
      label: 'Desired Count',
      default: 1,
      validate: { min: 0, max: 500 },
    },
    {
      name: 'launch_type',
      type: 'enum',
      required: true,
      label: 'Launch Type',
      enumValues: ['FARGATE', 'EC2'],
      default: 'FARGATE',
    },
    {
      name: 'assign_public_ip',
      type: 'boolean',
      required: false,
      label: 'Assign Public IP',
      default: false,
    },
  ],
  terraform: {
    resourceType: 'aws_ecs_service',
    attributes: {
      name: prop('service_name'),
      cluster: ref.parent('aws/ecs-cluster', 'id'),
      desired_count: prop('desired_count'),
      launch_type: prop('launch_type'),
    },
    blocks: [
      {
        blockType: 'network_configuration',
        attributes: {
          subnets: ref.rel('runs-in', 'id', true),
          security_groups: ref.rel('attached-to', 'id', true),
          assign_public_ip: prop('assign_public_ip'),
        },
      },
    ],
  },
});
