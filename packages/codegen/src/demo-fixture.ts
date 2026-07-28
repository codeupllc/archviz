import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';

function resource(
  partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>,
): ResourceInstance {
  return { properties: {}, parentId: null, layout: { x: 0, y: 0 }, ...partial };
}

/**
 * A document exercising every resource type in the AWS provider, wired the way
 * a user would wire it. Used by tests and CI to assert the generated HCL is
 * accepted by `terraform validate` — i.e. every argument Terraform requires is
 * actually emitted for every resource we ship.
 */
export function buildAllResourcesDocument(): ArchvizDocument {
  return {
    ...createEmptyDocument('all-resources'),
    resources: [
      resource({
        id: 'vpc-1',
        type: 'aws/vpc',
        name: 'main',
        properties: {
          cidr_block: '10.0.0.0/16',
          enable_dns_hostnames: true,
          enable_dns_support: true,
        },
      }),
      resource({
        id: 'subnet-a',
        type: 'aws/subnet',
        name: 'private-a',
        parentId: 'vpc-1',
        properties: { cidr_block: '10.0.1.0/24', availability_zone: 'us-east-1a' },
      }),
      resource({
        id: 'subnet-b',
        type: 'aws/subnet',
        name: 'private-b',
        parentId: 'vpc-1',
        properties: { cidr_block: '10.0.2.0/24', availability_zone: 'us-east-1b' },
      }),
      resource({
        id: 'sg-1',
        type: 'aws/security-group',
        name: 'app-sg',
        parentId: 'vpc-1',
        properties: { description: 'application security group' },
      }),
      resource({
        id: 'sg-2',
        type: 'aws/security-group',
        name: 'data-sg',
        parentId: 'vpc-1',
        properties: { description: 'data tier security group' },
      }),
      resource({
        id: 'role-exec',
        type: 'aws/iam-role',
        name: 'exec-role',
        properties: {
          assume_role_policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: { Service: 'ecs-tasks.amazonaws.com' },
              },
            ],
          }),
        },
      }),
      resource({
        id: 'role-lambda',
        type: 'aws/iam-role',
        name: 'lambda-role',
        properties: {
          assume_role_policy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
              {
                Action: 'sts:AssumeRole',
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
              },
            ],
          }),
        },
      }),
      resource({
        id: 'ec2-1',
        type: 'aws/ec2-instance',
        name: 'web',
        parentId: 'subnet-a',
        properties: { ami: 'ami-0c55b159cbfafe1f0', instance_type: 't3.micro' },
      }),
      resource({
        id: 'rds-1',
        type: 'aws/rds-instance',
        name: 'app-db',
        parentId: 'subnet-a',
        properties: {
          engine: 'postgres',
          engine_version: '16.3',
          instance_class: 'db.t3.micro',
          allocated_storage: 20,
          username: 'admin',
          password: 'changeme',
          skip_final_snapshot: true,
        },
      }),
      resource({
        id: 'aurora-1',
        type: 'aws/aurora-cluster',
        name: 'analytics',
        parentId: 'vpc-1',
        properties: {
          engine: 'aurora-postgresql',
          master_username: 'admin',
          master_password: 'changeme',
          skip_final_snapshot: true,
        },
      }),
      resource({
        id: 'aurora-inst-1',
        type: 'aws/aurora-cluster-instance',
        name: 'analytics-writer',
        parentId: 'aurora-1',
        properties: { instance_class: 'db.t4g.medium' },
      }),
      resource({
        id: 'cache-1',
        type: 'aws/elasticache-cluster',
        name: 'sessions',
        parentId: 'subnet-a',
        properties: {
          cluster_id: 'sessions',
          engine: 'redis',
          node_type: 'cache.t3.micro',
          num_cache_nodes: 1,
          port: 6379,
        },
      }),
      resource({
        id: 's3-1',
        type: 'aws/s3-bucket',
        name: 'assets',
        properties: { bucket: 'archviz-demo-assets', force_destroy: false },
      }),
      resource({
        id: 'ddb-1',
        type: 'aws/dynamodb-table',
        name: 'users',
        properties: {
          table_name: 'users',
          hash_key: 'id',
          hash_key_type: 'S',
          range_key: 'created_at',
          range_key_type: 'N',
          billing_mode: 'PAY_PER_REQUEST',
        },
      }),
      resource({
        id: 'tg-1',
        type: 'aws/target-group',
        name: 'web-tg',
        parentId: 'vpc-1',
        properties: { port: 80, protocol: 'HTTP', target_type: 'instance' },
      }),
      resource({
        id: 'alb-1',
        type: 'aws/alb',
        name: 'public-alb',
        parentId: 'subnet-a',
        properties: { internal: false, load_balancer_type: 'application' },
      }),
      resource({
        id: 'lambda-1',
        type: 'aws/lambda-function',
        name: 'worker',
        properties: {
          function_name: 'worker',
          runtime: 'nodejs20.x',
          handler: 'index.handler',
          filename: 'function.zip',
          memory_size: 128,
          timeout: 3,
        },
      }),
      resource({
        id: 'ecr-1',
        type: 'aws/ecr-repository',
        name: 'app-images',
        properties: {
          repository_name: 'app',
          image_tag_mutability: 'IMMUTABLE',
          scan_on_push: true,
        },
      }),
      resource({
        id: 'ecs-cluster-1',
        type: 'aws/ecs-cluster',
        name: 'app-cluster',
        properties: { cluster_name: 'app-cluster', container_insights: 'disabled' },
      }),
      resource({
        id: 'taskdef-1',
        type: 'aws/ecs-task-definition',
        name: 'app-task',
        properties: {
          family: 'app',
          cpu: '256',
          memory: '512',
          container_port: 3000,
          image_tag: 'v1',
        },
      }),
      resource({
        id: 'svc-1',
        type: 'aws/ecs-service',
        name: 'app-service',
        parentId: 'ecs-cluster-1',
        properties: {
          service_name: 'app-service',
          desired_count: 1,
          launch_type: 'FARGATE',
          assign_public_ip: false,
        },
      }),
      resource({
        id: 'secret-1',
        type: 'aws/secrets-manager-secret',
        name: 'db-password',
        properties: { secret_name: 'app/db-password', source: 'generated-password' },
      }),
      resource({
        id: 'ssm-1',
        type: 'aws/ssm-parameter',
        name: 'api-key',
        properties: { parameter_name: '/app/api-key', type: 'SecureString', value: 'placeholder' },
      }),
      resource({
        id: 'sqs-1',
        type: 'aws/sqs-queue',
        name: 'jobs',
        properties: {
          queue_name: 'app-jobs',
          fifo_queue: false,
          delay_seconds: 0,
          visibility_timeout_seconds: 30,
          message_retention_seconds: 345600,
        },
      }),
      resource({
        id: 'sns-1',
        type: 'aws/sns-topic',
        name: 'events',
        properties: { topic_name: 'app-events', fifo_topic: false },
      }),
      resource({
        id: 'apigw-1',
        type: 'aws/api-gateway-http-api',
        name: 'api',
        properties: {
          name: 'my-http-api',
          protocol_type: 'HTTP',
          description: 'HTTP API for Lambda',
        },
      }),
    ],
    relationships: [
      { id: 'r-ec2-sg', relationship: 'attached-to', sourceId: 'ec2-1', targetId: 'sg-1' },
      { id: 'r-ec2-role', relationship: 'assumes', sourceId: 'ec2-1', targetId: 'role-exec' },
      { id: 'r-ec2-s3', relationship: 'reads-from', sourceId: 'ec2-1', targetId: 's3-1' },
      { id: 'r-ec2-rds', relationship: 'connects-to', sourceId: 'ec2-1', targetId: 'rds-1' },
      { id: 'r-rds-sg', relationship: 'attached-to', sourceId: 'rds-1', targetId: 'sg-2' },
      { id: 'r-rds-secret', relationship: 'uses-secret', sourceId: 'rds-1', targetId: 'secret-1' },
      { id: 'r-aurora-sg', relationship: 'attached-to', sourceId: 'aurora-1', targetId: 'sg-2' },
      { id: 'r-cache-sg', relationship: 'attached-to', sourceId: 'cache-1', targetId: 'sg-2' },
      { id: 'r-alb-sg', relationship: 'attached-to', sourceId: 'alb-1', targetId: 'sg-1' },
      { id: 'r-alb-subnet-a', relationship: 'runs-in', sourceId: 'alb-1', targetId: 'subnet-a' },
      { id: 'r-alb-subnet-b', relationship: 'runs-in', sourceId: 'alb-1', targetId: 'subnet-b' },
      { id: 'r-alb-tg', relationship: 'routes-to', sourceId: 'alb-1', targetId: 'tg-1' },
      { id: 'r-tg-ec2', relationship: 'forwards-to', sourceId: 'tg-1', targetId: 'ec2-1' },
      { id: 'r-lambda-role', relationship: 'assumes', sourceId: 'lambda-1', targetId: 'role-lambda' },
      { id: 'r-lambda-ddb', relationship: 'reads-from', sourceId: 'lambda-1', targetId: 'ddb-1' },
      { id: 'r-lambda-sqs', relationship: 'reads-from', sourceId: 'lambda-1', targetId: 'sqs-1' },
      { id: 'r-lambda-sqs-write', relationship: 'writes-to', sourceId: 'lambda-1', targetId: 'sqs-1' },
      { id: 'r-lambda-sns-write', relationship: 'writes-to', sourceId: 'lambda-1', targetId: 'sns-1' },
      { id: 'r-sns-sqs', relationship: 'delivers-to', sourceId: 'sns-1', targetId: 'sqs-1' },
      { id: 'r-apigw-lambda', relationship: 'routes-to', sourceId: 'apigw-1', targetId: 'lambda-1' },
      { id: 'r-td-ecr', relationship: 'pulls-image', sourceId: 'taskdef-1', targetId: 'ecr-1' },
      {
        id: 'r-td-exec',
        relationship: 'execution-role',
        sourceId: 'taskdef-1',
        targetId: 'role-exec',
      },
      {
        id: 'r-td-task',
        relationship: 'task-role',
        sourceId: 'taskdef-1',
        targetId: 'role-exec',
      },
      { id: 'r-td-secret', relationship: 'uses-secret', sourceId: 'taskdef-1', targetId: 'ssm-1' },
      { id: 'r-svc-td', relationship: 'runs-task', sourceId: 'svc-1', targetId: 'taskdef-1' },
      { id: 'r-svc-sg', relationship: 'attached-to', sourceId: 'svc-1', targetId: 'sg-1' },
      { id: 'r-svc-sqs-write', relationship: 'writes-to', sourceId: 'svc-1', targetId: 'sqs-1' },
      { id: 'r-svc-subnet-a', relationship: 'runs-in', sourceId: 'svc-1', targetId: 'subnet-a' },
      { id: 'r-svc-subnet-b', relationship: 'runs-in', sourceId: 'svc-1', targetId: 'subnet-b' },
      { id: 'r-svc-rds', relationship: 'connects-to', sourceId: 'svc-1', targetId: 'rds-1' },
    ],
  };
}
