import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generateMainTf } from './index.js';

const registry = createAwsRegistry();

function resource(
  partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>,
): ResourceInstance {
  return { properties: {}, parentId: null, layout: { x: 0, y: 0 }, ...partial };
}

describe('API IAM reads-from / writes-to (S3 / DynamoDB / SQS)', () => {
  it('grants S3 and DynamoDB consume/produce on the Lambda role', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('api-iam'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'fn-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'bucket',
          type: 'aws/s3-bucket',
          name: 'assets',
          properties: { bucket: 'assets' },
        }),
        resource({
          id: 'table',
          type: 'aws/dynamodb-table',
          name: 'users',
          properties: {
            table_name: 'users',
            hash_key: 'id',
            hash_key_type: 'S',
            billing_mode: 'PAY_PER_REQUEST',
          },
        }),
        resource({
          id: 'fn-1',
          type: 'aws/lambda-function',
          name: 'worker',
          properties: {
            function_name: 'worker',
            runtime: 'nodejs20.x',
            handler: 'index.handler',
            filename: 'function.zip',
          },
        }),
      ],
      relationships: [
        { id: 'r-role', relationship: 'assumes', sourceId: 'fn-1', targetId: 'role-1' },
        { id: 'r-s3-read', relationship: 'reads-from', sourceId: 'fn-1', targetId: 'bucket' },
        { id: 'r-s3-write', relationship: 'writes-to', sourceId: 'fn-1', targetId: 'bucket' },
        { id: 'r-ddb-read', relationship: 'reads-from', sourceId: 'fn-1', targetId: 'table' },
        { id: 'r-ddb-write', relationship: 'writes-to', sourceId: 'fn-1', targetId: 'table' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_s3_consume_assets"');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_s3_produce_assets"');
    expect(hcl).toContain('s3:GetObject');
    expect(hcl).toContain('s3:PutObject');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_dynamodb_consume_users"');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_dynamodb_produce_users"');
    expect(hcl).toContain('dynamodb:GetItem');
    expect(hcl).toContain('dynamodb:PutItem');
    expect(hcl).toContain('role = aws_iam_role.fn_role.id');
  });

  it('exposes reads-from and writes-to as swappable options toward S3', () => {
    const options = registry.possibleRelationships('aws/lambda-function', 'aws/s3-bucket');
    expect(options).toEqual(expect.arrayContaining(['reads-from', 'writes-to']));
  });
});
