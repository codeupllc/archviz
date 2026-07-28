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

describe('SNS topic', () => {
  it('emits publish IAM and SQS subscription + queue policy', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sns'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'fn-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'topic',
          type: 'aws/sns-topic',
          name: 'events',
          properties: { topic_name: 'events', fifo_topic: false },
        }),
        resource({
          id: 'queue',
          type: 'aws/sqs-queue',
          name: 'jobs',
          properties: { queue_name: 'jobs' },
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
        { id: 'r-pub', relationship: 'writes-to', sourceId: 'fn-1', targetId: 'topic' },
        { id: 'r-sub', relationship: 'delivers-to', sourceId: 'topic', targetId: 'queue' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_sns_topic" "events"');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_sns_produce_events"');
    expect(hcl).toContain('sns:Publish');
    expect(hcl).toContain('resource "aws_sns_topic_subscription" "events_to_jobs"');
    expect(hcl).toContain('protocol  = "sqs"');
    expect(hcl).toContain('resource "aws_sqs_queue_policy" "jobs_from_events"');
    expect(hcl).toContain('sns.amazonaws.com');
  });
});
