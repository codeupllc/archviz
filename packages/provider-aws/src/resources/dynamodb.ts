import { defineResource, prop } from '@archviz/schema';

export const dynamodbTable = defineResource({
  id: 'aws/dynamodb-table',
  provider: 'aws',
  display: {
    label: 'DynamoDB Table',
    icon: 'dynamodb',
    category: 'database',
    kind: 'node',
    description: 'NoSQL key-value table',
  },
  capabilities: ['database', 'storage'],
  nesting: { allowedParents: [] },
  connections: [],
  properties: [
    {
      name: 'hash_key',
      type: 'string',
      required: true,
      default: 'id',
      label: 'Partition Key',
    },
    {
      name: 'range_key',
      type: 'string',
      required: false,
      label: 'Sort Key',
    },
    {
      name: 'billing_mode',
      type: 'enum',
      required: true,
      enumValues: ['PAY_PER_REQUEST', 'PROVISIONED'],
      default: 'PAY_PER_REQUEST',
      label: 'Billing Mode',
    },
  ],
  terraform: {
    resourceType: 'aws_dynamodb_table',
    attributes: {
      hash_key: prop('hash_key'),
      range_key: prop('range_key'),
      billing_mode: prop('billing_mode'),
    },
  },
});
