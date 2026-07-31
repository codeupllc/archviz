import { describe, expect, it } from 'vitest';
import { checkLocalstackHobbyCompatibility } from './localstack-hobby.js';

describe('checkLocalstackHobbyCompatibility', () => {
  it('accepts Hobby serverless graphs', () => {
    const result = checkLocalstackHobbyCompatibility([
      'aws/lambda-function',
      'aws/dynamodb-table',
      'aws/iam-role',
    ]);
    expect(result.ok).toBe(true);
    expect(result.message).toBeNull();
    expect(result.paidEntitlements).toBe(false);
  });

  it('rejects ECS/RDS on Hobby without a token', () => {
    const result = checkLocalstackHobbyCompatibility([
      'aws/lambda-function',
      'aws/ecs-service',
      'aws/rds-instance',
    ]);
    expect(result.ok).toBe(false);
    expect(result.unsupported).toEqual(expect.arrayContaining(['aws/ecs-service', 'aws/rds-instance']));
    expect(result.ultimateHints).toEqual(
      expect.arrayContaining(['aws/ecs-service', 'aws/rds-instance']),
    );
    expect(result.message).toContain('Ultimate');
  });

  it('allows ECS/RDS when paid entitlements (auth token) are enabled', () => {
    const result = checkLocalstackHobbyCompatibility(
      ['aws/ecs-cluster', 'aws/ecs-service', 'aws/ecs-task-definition', 'aws/rds-instance', 'aws/vpc'],
      { paidEntitlements: true },
    );
    expect(result.ok).toBe(true);
    expect(result.paidEntitlements).toBe(true);
  });
});
