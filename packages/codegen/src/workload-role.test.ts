import { describe, expect, it } from 'vitest';
import { createEmptyDocument, validate, type ArchvizDocument, type ResourceInstance } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';

function resource(
  partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>,
): ResourceInstance {
  return { properties: {}, parentId: null, layout: { x: 0, y: 0 }, ...partial };
}

describe('missing-workload-role for SQS edges', () => {
  const registry = createAwsRegistry();

  it('errors when an ECS Service writes to SQS without a Task Role', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sqs-no-task-role'),
      resources: [
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
          name: 'service',
          parentId: 'cluster',
          properties: { service_name: 'service', desired_count: 1, launch_type: 'FARGATE' },
        }),
        resource({
          id: 'q',
          type: 'aws/sqs-queue',
          name: 'jobs',
          properties: { queue_name: 'jobs' },
        }),
      ],
      relationships: [
        { id: 'r-run', relationship: 'runs-task', sourceId: 'svc', targetId: 'td' },
        { id: 'r-write', relationship: 'writes-to', sourceId: 'svc', targetId: 'q' },
      ],
    };

    const result = validate(doc, registry);
    const hit = result.diagnostics.find((d) => d.code === 'missing-workload-role');
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('error');
    expect(hit?.resourceId).toBe('svc');
    expect(hit?.relationshipId).toBe('r-write');
    expect(hit?.message).toMatch(/Task Role/);
    expect(result.ok).toBe(false);
  });

  it('clears once the Task Definition has a Task Role', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('sqs-with-task-role'),
      resources: [
        resource({
          id: 'role',
          type: 'aws/iam-role',
          name: 'task-role',
          properties: { assume_role_policy: '{}' },
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
          name: 'service',
          parentId: 'cluster',
          properties: { service_name: 'service', desired_count: 1, launch_type: 'FARGATE' },
        }),
        resource({
          id: 'q',
          type: 'aws/sqs-queue',
          name: 'jobs',
          properties: { queue_name: 'jobs' },
        }),
      ],
      relationships: [
        { id: 'r-task', relationship: 'task-role', sourceId: 'td', targetId: 'role' },
        { id: 'r-run', relationship: 'runs-task', sourceId: 'svc', targetId: 'td' },
        { id: 'r-write', relationship: 'writes-to', sourceId: 'svc', targetId: 'q' },
      ],
    };

    const result = validate(doc, registry);
    expect(result.diagnostics.filter((d) => d.code === 'missing-workload-role')).toEqual([]);
  });
});
