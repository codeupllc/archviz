import { defineResource, prop, ref, literal } from '@archviz/schema';

export const ecsTaskDefinition = defineResource({
  id: 'aws/ecs-task-definition',
  provider: 'aws',
  display: {
    label: 'ECS Task Definition',
    icon: 'ecs',
    category: 'compute',
    kind: 'node',
    description:
      'Blueprint for a container: image, CPU/memory, port. Connect an ECR Repository to set the image — build/push happens in CI.',
  },
  capabilities: ['task-definition'],
  nesting: { allowedParents: [] },
  connections: [
    {
      relationship: 'pulls-image',
      targets: [{ type: 'aws/ecr-repository' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'annotation' },
      label: 'Pulls image from',
    },
    {
      // Not the built-in 'attribute' strategy: that always traverses `.id`,
      // but aws_iam_role's id is the role *name*, not its ARN. The correct
      // `ref.rel(..., 'arn')` mapping already lives in terraform.attributes
      // below, so this connection only needs to satisfy the constraint
      // engine — no separate HCL should be materialized for it.
      relationship: 'execution-role',
      targets: [{ type: 'aws/iam-role' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'annotation' },
      label: 'Execution Role',
    },
    {
      relationship: 'task-role',
      targets: [{ type: 'aws/iam-role' }],
      cardinality: { maxOutgoing: 1 },
      materialize: { strategy: 'annotation' },
      label: 'Task Role',
    },
    {
      // Unlike RDS's uses-secret (which wires the plaintext value into an
      // attribute), a task definition must never see the value: the ECS
      // emitter turns each connection into a `secrets` entry
      // (valueFrom = <ARN>) resolved by the ECS agent at task start, plus an
      // IAM policy on the execution role. No cardinality cap — containers
      // commonly need several secrets.
      relationship: 'uses-secret',
      targets: [{ capability: 'secret-value' }],
      materialize: { strategy: 'annotation' },
      label: 'Injects Secret (env var)',
    },
  ],
  properties: [
    {
      name: 'family',
      type: 'string',
      required: true,
      label: 'Family',
      default: 'app',
    },
    {
      name: 'cpu',
      type: 'enum',
      required: true,
      label: 'CPU (Fargate units)',
      enumValues: ['256', '512', '1024', '2048', '4096'],
      default: '256',
    },
    {
      name: 'memory',
      type: 'enum',
      required: true,
      label: 'Memory (MB)',
      enumValues: ['512', '1024', '2048', '3072', '4096', '8192'],
      default: '512',
    },
    {
      name: 'container_name',
      type: 'string',
      required: false,
      label: 'Container Name',
      description: 'Defaults to the family name if left blank.',
    },
    {
      name: 'container_port',
      type: 'number',
      required: false,
      label: 'Container Port',
      default: 80,
      validate: { min: 1, max: 65535 },
    },
    {
      name: 'image_tag',
      type: 'string',
      required: false,
      label: 'Image Tag',
      default: 'latest',
      description: 'Tag your CI pipeline pushes to the connected ECR Repository.',
    },
    {
      name: 'image',
      type: 'string',
      required: false,
      label: 'Image URI (override)',
      description:
        'Full image reference (e.g. nginx:latest). Overrides ECR when set — useful for LocalStack. Prefer connecting an ECR Repository for real AWS.',
    },
  ],
  terraform: {
    resourceType: 'aws_ecs_task_definition',
    attributes: {
      family: prop('family'),
      cpu: prop('cpu'),
      memory: prop('memory'),
      requires_compatibilities: literal(['FARGATE']),
      network_mode: literal('awsvpc'),
      execution_role_arn: ref.rel('execution-role', 'arn'),
      task_role_arn: ref.rel('task-role', 'arn'),
      // container_definitions is synthesized by the ECS emitter (codegen
      // package) — it needs to combine the ECR connection, port, and log
      // config into one JSON blob, which the flat attribute/ref system here
      // can't express.
    },
  },
});
