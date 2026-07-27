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
      name: 'table_name',
      type: 'string',
      required: true,
      default: 'app-table',
      label: 'Table Name',
    },
    {
      name: 'hash_key',
      type: 'string',
      required: true,
      default: 'id',
      label: 'Partition Key',
    },
    {
      name: 'hash_key_type',
      type: 'enum',
      required: true,
      enumValues: ['S', 'N', 'B'],
      default: 'S',
      label: 'Partition Key Type',
      description: 'String, Number, or Binary — emitted as the key\u2019s attribute definition.',
    },
    {
      name: 'range_key',
      type: 'string',
      required: false,
      label: 'Sort Key',
    },
    {
      name: 'range_key_type',
      type: 'enum',
      required: false,
      enumValues: ['S', 'N', 'B'],
      default: 'S',
      label: 'Sort Key Type',
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
      name: prop('table_name'),
      hash_key: prop('hash_key'),
      range_key: prop('range_key'),
      billing_mode: prop('billing_mode'),
      // `attribute` blocks (one per key) are synthesized by the DynamoDB
      // emitter — Terraform requires a definition for every key attribute,
      // and the count depends on whether a sort key is set.
    },
  },
});
