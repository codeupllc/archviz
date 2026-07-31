import { describe, expect, it } from 'vitest';
import { createAwsRegistry, awsResources } from './index.js';
import { definitionsToJsonString, definitionsFromJsonString } from '@archviz/schema';

describe('aws resource definitions', () => {
  it('registers all 26 resource types', () => {
    const registry = createAwsRegistry();
    const ids = [
      'aws/vpc',
      'aws/subnet',
      'aws/internet-gateway',
      'aws/ec2-instance',
      'aws/security-group',
      'aws/rds-instance',
      'aws/aurora-cluster',
      'aws/aurora-cluster-instance',
      'aws/elasticache-cluster',
      'aws/s3-bucket',
      'aws/alb',
      'aws/nlb',
      'aws/target-group',
      'aws/lambda-function',
      'aws/dynamodb-table',
      'aws/iam-role',
      'aws/ecr-repository',
      'aws/ecs-cluster',
      'aws/ecs-task-definition',
      'aws/ecs-service',
      'aws/secrets-manager-secret',
      'aws/ssm-parameter',
      'aws/sqs-queue',
      'aws/sns-topic',
      'aws/api-gateway-http-api',
      'aws/cloudwatch-log-group',
    ];
    for (const id of ids) {
      expect(registry.get(id), id).toBeDefined();
    }
    expect(awsResources).toHaveLength(26);
  });

  it('enforces nesting and capability connections', () => {
    const registry = createAwsRegistry();
    expect(registry.canNestType('aws/subnet', 'aws/vpc')).toBe(true);
    expect(registry.canNestType('aws/internet-gateway', 'aws/vpc')).toBe(true);
    expect(registry.canNestType('aws/ec2-instance', 'aws/subnet')).toBe(true);
    expect(registry.canNestType('aws/security-group', 'aws/vpc')).toBe(true);
    expect(registry.canNestType('aws/target-group', 'aws/vpc')).toBe(true);
    expect(registry.canNestType('aws/nlb', 'aws/subnet')).toBe(true);

    expect(
      registry.findConnectionRule('aws/ec2-instance', 'connects-to', 'aws/rds-instance')
        ?.materialize.strategy,
    ).toBe('sg-rule-pair');

    expect(
      registry.findConnectionRule('aws/ec2-instance', 'connects-to', 'aws/s3-bucket'),
    ).toBeUndefined();

    expect(
      registry.findConnectionRule('aws/alb', 'routes-to', 'aws/target-group')?.cardinality
        ?.maxOutgoing,
    ).toBeNull();
    expect(
      registry.findConnectionRule('aws/nlb', 'routes-to', 'aws/target-group')?.materialize.strategy,
    ).toBe('lb-listener');
  });

  it('round-trips through JSON serializer', () => {
    const json = definitionsToJsonString(awsResources);
    const restored = definitionsFromJsonString(json);
    expect(restored).toHaveLength(26);
  });
});
