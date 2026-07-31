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

describe('SQS IAM from reads-from / writes-to', () => {
  it('grants consume vs produce on the Lambda execution role for that queue', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sqs-iam'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'fn-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'q-1',
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
        { id: 'r-read', relationship: 'reads-from', sourceId: 'fn-1', targetId: 'q-1' },
        { id: 'r-write', relationship: 'writes-to', sourceId: 'fn-1', targetId: 'q-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_sqs_consume_jobs"');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_sqs_produce_jobs"');
    expect(hcl).toMatch(/Action\s+=\s+\["sqs:ReceiveMessage"/);
    expect(hcl).toMatch(/Action\s+=\s+\["sqs:SendMessage"/);
    expect(hcl).toContain('Resource = [aws_sqs_queue.jobs.arn]');
    expect(hcl).toContain('role = aws_iam_role.fn_role.id');
    expect(hcl).toContain('resource "aws_lambda_event_source_mapping" "worker_from_jobs"');
    expect(hcl).toContain('event_source_arn = aws_sqs_queue.jobs.arn');
    expect(hcl).toContain('function_name    = aws_lambda_function.worker.arn');
  });

  it('warns and skips IAM when no role is assumed', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sqs-no-role'),
      resources: [
        resource({
          id: 'q-1',
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
        { id: 'r-write', relationship: 'writes-to', sourceId: 'fn-1', targetId: 'q-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).not.toContain('aws_iam_role_policy');
    expect(hcl).toMatch(/WARNING:.*writes-to.*no assumes/);
  });

  it('puts ECS service SQS access on the task role, not the execution role', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sqs-ecs'),
      resources: [
        resource({
          id: 'exec',
          type: 'aws/iam-role',
          name: 'exec-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'task',
          type: 'aws/iam-role',
          name: 'task-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'q-1',
          type: 'aws/sqs-queue',
          name: 'jobs',
          properties: { queue_name: 'jobs' },
        }),
        resource({
          id: 'cluster',
          type: 'aws/ecs-cluster',
          name: 'cluster',
          properties: { cluster_name: 'app' },
        }),
        resource({
          id: 'td',
          type: 'aws/ecs-task-definition',
          name: 'td',
          properties: { family: 'app', cpu: '256', memory: '512' },
        }),
        resource({
          id: 'svc',
          type: 'aws/ecs-service',
          name: 'svc',
          parentId: 'cluster',
          properties: { service_name: 'svc', desired_count: 1, launch_type: 'FARGATE' },
        }),
      ],
      relationships: [
        { id: 'r-exec', relationship: 'execution-role', sourceId: 'td', targetId: 'exec' },
        { id: 'r-task', relationship: 'task-role', sourceId: 'td', targetId: 'task' },
        { id: 'r-run', relationship: 'runs-task', sourceId: 'svc', targetId: 'td' },
        { id: 'r-write', relationship: 'writes-to', sourceId: 'svc', targetId: 'q-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_iam_role_policy" "svc_sqs_produce_jobs"');
    expect(hcl).toContain('role = aws_iam_role.task_role.id');
    expect(hcl).not.toMatch(
      /resource "aws_iam_role_policy" "svc_sqs_produce_jobs"[\s\S]*?role = aws_iam_role\.exec_role\.id/,
    );
  });
});
