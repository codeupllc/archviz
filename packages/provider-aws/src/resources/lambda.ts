import { defineResource, prop, ref } from '@archviz/schema';

export const lambdaFunction = defineResource({
  id: 'aws/lambda-function',
  provider: 'aws',
  display: {
    label: 'Lambda Function',
    icon: 'lambda',
    category: 'compute',
    kind: 'node',
    description: 'Serverless function',
  },
  capabilities: ['compute', 'network-client'],
  nesting: {
    // Lambda may optionally sit in a subnet (VPC config); not required
    allowedParents: [{ type: 'aws/subnet', required: false }],
  },
  connections: [
    {
      // The vpc_config block (subnet_ids + security_group_ids) is synthesized
      // by the Lambda emitter, which needs both this connection and the
      // optional Subnet parent — a flat attribute can't express a nested block.
      relationship: 'attached-to',
      targets: [{ type: 'aws/security-group' }],
      cardinality: { maxOutgoing: 5 },
      materialize: { strategy: 'annotation' },
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
      // S3 / DynamoDB / SQS: consume IAM on the assumed workload role.
      materialize: { strategy: 'reads-from', access: 'consume' },
      label: 'Reads from',
    },
    {
      relationship: 'writes-to',
      targets: [
        { type: 'aws/sqs-queue' },
        { type: 'aws/s3-bucket' },
        { type: 'aws/dynamodb-table' },
      ],
      materialize: { strategy: 'api-iam', access: 'produce' },
      label: 'Writes to',
    },
    {
      // Terraform requires `role` on aws_lambda_function, and it can only come
      // from this connection — minOutgoing surfaces it as a diagram error
      // instead of generating HCL that fails at plan time.
      relationship: 'assumes',
      targets: [{ type: 'aws/iam-role' }],
      cardinality: { maxOutgoing: 1, minOutgoing: 1 },
      materialize: { strategy: 'annotation' },
      label: 'Execution Role',
    },
  ],
  properties: [
    {
      name: 'function_name',
      type: 'string',
      required: true,
      default: 'my-function',
      label: 'Function Name',
    },
    {
      name: 'runtime',
      type: 'enum',
      required: true,
      enumValues: [
        'nodejs20.x',
        'nodejs18.x',
        'python3.12',
        'python3.11',
        'java21',
        'provided.al2023',
      ],
      default: 'nodejs20.x',
      label: 'Runtime',
    },
    {
      name: 'handler',
      type: 'string',
      required: true,
      default: 'index.handler',
      label: 'Handler',
    },
    {
      name: 'filename',
      type: 'string',
      required: false,
      default: 'function.zip',
      label: 'Deployment Package',
    },
    {
      name: 'memory_size',
      type: 'number',
      required: false,
      default: 128,
      label: 'Memory (MB)',
      validate: { min: 128, max: 10240 },
    },
    {
      name: 'timeout',
      type: 'number',
      required: false,
      default: 3,
      label: 'Timeout (seconds)',
      validate: { min: 1, max: 900 },
    },
  ],
  terraform: {
    resourceType: 'aws_lambda_function',
    attributes: {
      function_name: prop('function_name'),
      runtime: prop('runtime'),
      handler: prop('handler'),
      filename: prop('filename'),
      memory_size: prop('memory_size'),
      timeout: prop('timeout'),
      role: ref.rel('assumes', 'arn', false),
    },
  },
});
