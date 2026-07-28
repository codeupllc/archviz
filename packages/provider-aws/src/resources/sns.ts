import { defineResource, prop } from '@archviz/schema';

export const snsTopic = defineResource({
  id: 'aws/sns-topic',
  provider: 'aws',
  display: {
    label: 'SNS Topic',
    icon: 'sns',
    category: 'integration',
    kind: 'node',
    description: 'Pub/sub topic for fan-out messaging',
  },
  capabilities: ['messaging', 'topic'],
  nesting: { allowedParents: [] },
  connections: [
    {
      // Fan-out: emit aws_sns_topic_subscription + SQS queue policy so SNS can SendMessage.
      relationship: 'delivers-to',
      targets: [{ type: 'aws/sqs-queue' }],
      materialize: { strategy: 'sns-sqs-subscription' },
      label: 'Delivers to',
    },
  ],
  properties: [
    {
      name: 'topic_name',
      type: 'string',
      required: false,
      default: 'app-events',
      label: 'Topic Name',
      description: 'Leave empty to let Terraform assign a name. FIFO topics must end with .fifo',
    },
    {
      name: 'fifo_topic',
      type: 'boolean',
      required: false,
      default: false,
      label: 'FIFO Topic',
      description: 'When enabled, the topic name must end with .fifo',
    },
  ],
  terraform: {
    resourceType: 'aws_sns_topic',
    attributes: {
      name: prop('topic_name'),
      fifo_topic: prop('fifo_topic'),
    },
  },
});
