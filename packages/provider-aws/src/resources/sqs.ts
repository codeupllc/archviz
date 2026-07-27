import { defineResource, prop } from '@archviz/schema';

export const sqsQueue = defineResource({
  id: 'aws/sqs-queue',
  provider: 'aws',
  display: {
    label: 'SQS Queue',
    icon: 'sqs',
    category: 'integration',
    kind: 'node',
    description: 'Managed message queue',
  },
  capabilities: ['messaging', 'queue'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'queue_name',
      type: 'string',
      required: false,
      default: 'app-queue',
      label: 'Queue Name',
      description:
        'Leave empty to let Terraform assign a name. FIFO queues must end with .fifo',
    },
    {
      name: 'fifo_queue',
      type: 'boolean',
      required: false,
      default: false,
      label: 'FIFO Queue',
      description: 'When enabled, the queue name must end with .fifo',
    },
    {
      name: 'delay_seconds',
      type: 'number',
      required: false,
      default: 0,
      label: 'Delivery Delay (seconds)',
      validate: { min: 0, max: 900 },
    },
    {
      name: 'visibility_timeout_seconds',
      type: 'number',
      required: false,
      default: 30,
      label: 'Visibility Timeout (seconds)',
      validate: { min: 0, max: 43200 },
    },
    {
      name: 'message_retention_seconds',
      type: 'number',
      required: false,
      default: 345600,
      label: 'Message Retention (seconds)',
      description: 'Default 4 days (345600). Range 60–1209600 (14 days).',
      validate: { min: 60, max: 1209600 },
    },
  ],
  terraform: {
    resourceType: 'aws_sqs_queue',
    attributes: {
      name: prop('queue_name'),
      fifo_queue: prop('fifo_queue'),
      delay_seconds: prop('delay_seconds'),
      visibility_timeout_seconds: prop('visibility_timeout_seconds'),
      message_retention_seconds: prop('message_retention_seconds'),
    },
  },
});
