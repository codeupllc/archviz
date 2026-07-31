import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';

function resource(
  partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>,
): ResourceInstance {
  return { properties: {}, parentId: null, layout: { x: 0, y: 0 }, ...partial };
}

/**
 * Minimal Lambda + DynamoDB + IAM diagram for LocalStack Hobby apply demos.
 * ECS/RDS are intentionally omitted — those need Ultimate (see docs/localstack.md).
 */
export function buildLocalstackHobbyDocument(): ArchvizDocument {
  return {
    ...createEmptyDocument('LocalStack Hobby'),
    resources: [
      resource({
        id: 'role-lambda',
        type: 'aws/iam-role',
        name: 'lambda-role',
        layout: { x: 80, y: 120 },
        properties: {
          trust_principal: 'lambda',
        },
      }),
      resource({
        id: 'table-1',
        type: 'aws/dynamodb-table',
        name: 'items',
        layout: { x: 420, y: 240 },
        properties: {
          table_name: 'archviz-hobby-items',
          hash_key: 'id',
          hash_key_type: 'S',
          billing_mode: 'PAY_PER_REQUEST',
        },
      }),
      resource({
        id: 'fn-1',
        type: 'aws/lambda-function',
        name: 'handler',
        layout: { x: 420, y: 80 },
        properties: {
          function_name: 'archviz-hobby-handler',
          runtime: 'nodejs20.x',
          handler: 'index.handler',
          filename: 'function.zip',
        },
      }),
    ],
    relationships: [
      {
        id: 'c-assumes',
        sourceId: 'fn-1',
        targetId: 'role-lambda',
        relationship: 'assumes',
      },
      {
        id: 'c-reads',
        sourceId: 'fn-1',
        targetId: 'table-1',
        relationship: 'reads-from',
      },
    ],
  };
}
