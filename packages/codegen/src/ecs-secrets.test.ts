import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type ArchvizDocument, type ResourceInstance } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { generate, generateMainTf } from './index.js';

const registry = createAwsRegistry();

function resource(partial: Partial<ResourceInstance> & Pick<ResourceInstance, 'id' | 'type' | 'name'>): ResourceInstance {
  return {
    properties: {},
    parentId: null,
    layout: { x: 0, y: 0 },
    ...partial,
  };
}

describe('ECS / ECR / Docker-reference resources', () => {
  function ecsDoc(): ArchvizDocument {
    return {
      ...createEmptyDocument('ecs-demo'),
      resources: [
        resource({ id: 'vpc-1', type: 'aws/vpc', name: 'vpc', properties: { cidr_block: '10.0.0.0/16' } }),
        resource({
          id: 'subnet-1',
          type: 'aws/subnet',
          name: 'subnet',
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        resource({
          id: 'sg-1',
          type: 'aws/security-group',
          name: 'sg',
          parentId: 'vpc-1',
          properties: { description: 'app sg' },
        }),
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'ecr-1',
          type: 'aws/ecr-repository',
          name: 'ecr',
          properties: { repository_name: 'app', scan_on_push: true },
        }),
        resource({ id: 'cluster-1', type: 'aws/ecs-cluster', name: 'cluster', properties: { cluster_name: 'app-cluster' } }),
        resource({
          id: 'taskdef-1',
          type: 'aws/ecs-task-definition',
          name: 'taskdef',
          properties: { family: 'app', cpu: '256', memory: '512', container_port: 3000, image_tag: 'v1' },
        }),
        resource({
          id: 'service-1',
          type: 'aws/ecs-service',
          name: 'service',
          parentId: 'cluster-1',
          properties: { service_name: 'app-service', launch_type: 'FARGATE' },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'pulls-image', sourceId: 'taskdef-1', targetId: 'ecr-1' },
        { id: 'r2', relationship: 'execution-role', sourceId: 'taskdef-1', targetId: 'role-1' },
        { id: 'r3', relationship: 'runs-task', sourceId: 'service-1', targetId: 'taskdef-1' },
        { id: 'r4', relationship: 'attached-to', sourceId: 'service-1', targetId: 'sg-1' },
        { id: 'r5', relationship: 'runs-in', sourceId: 'service-1', targetId: 'subnet-1' },
      ],
    };
  }

  it('generates a valid, unblocked ECS pipeline', () => {
    const result = generate(ecsDoc(), registry, { layout: 'single-file', emitDespiteErrors: true });
    expect(result.blocked).toBe(false);
  });

  it('emits nested blocks for ECR scanning config and ECS cluster settings', () => {
    const hcl = generateMainTf(ecsDoc(), registry);
    expect(hcl).toContain('resource "aws_ecr_repository" "ecr"');
    expect(hcl).toContain('image_scanning_configuration {');
    expect(hcl).toContain('scan_on_push = true');
    expect(hcl).toContain('resource "aws_ecs_cluster" "cluster"');
    expect(hcl).toContain('setting {');
    expect(hcl).toContain('containerInsights');
  });

  it('wires the task definition to its ECR image, execution role, and log group companion', () => {
    const hcl = generateMainTf(ecsDoc(), registry);
    expect(hcl).toContain('resource "aws_ecs_task_definition" "taskdef"');
    expect(hcl).toMatch(/execution_role_arn\s+= aws_iam_role\.role\.arn/);
    expect(hcl).toMatch(/container_definitions\s+= jsonencode\(/);
    expect(hcl).toContain('aws_ecr_repository.ecr.repository_url');
    expect(hcl).toContain(':v1');
    expect(hcl).toContain('resource "aws_cloudwatch_log_group" "taskdef_logs"');
    expect(hcl).toContain('/ecs/app');
  });

  it('wires the ECS service network_configuration from runs-in/attached-to connections', () => {
    const hcl = generateMainTf(ecsDoc(), registry);
    expect(hcl).toContain('resource "aws_ecs_service" "service"');
    expect(hcl).toContain('network_configuration {');
    expect(hcl).toContain('aws_subnet.subnet.id');
    expect(hcl).toContain('aws_security_group.sg.id');
    expect(hcl).toContain('task_definition');
    expect(hcl).toContain('aws_ecs_task_definition.taskdef.id');
  });

  it('injects DATABASE_URL when an ECS service connects-to RDS', () => {
    const doc = ecsDoc();
    doc.resources.push(
      resource({
        id: 'sg-db',
        type: 'aws/security-group',
        name: 'db-sg',
        parentId: 'vpc-1',
        properties: { description: 'db' },
      }),
      resource({
        id: 'rds-1',
        type: 'aws/rds-instance',
        name: 'db',
        parentId: 'subnet-1',
        properties: {
          engine: 'postgres',
          instance_class: 'db.t3.micro',
          allocated_storage: 20,
          username: 'admin',
          password: 'changeme',
          db_name: 'app',
        },
      }),
    );
    doc.relationships.push(
      { id: 'r-svc-rds', relationship: 'connects-to', sourceId: 'service-1', targetId: 'rds-1' },
      { id: 'r-rds-sg', relationship: 'attached-to', sourceId: 'rds-1', targetId: 'sg-db' },
    );

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('DATABASE_URL');
    expect(hcl).toContain('aws_db_instance.db.username');
    expect(hcl).toContain('aws_db_instance.db.password');
    expect(hcl).toContain('aws_db_instance.db.address');
    expect(hcl).toContain('aws_db_instance.db.port');
    expect(hcl).toContain('coalesce(aws_db_instance.db.db_name, "postgres")');
    // Create-order: ECS service waits for RDS before registering tasks
    expect(hcl).toMatch(/resource "aws_ecs_service" "service"[\s\S]*?depends_on\s*=\s*\[[\s\S]*?aws_db_instance\.db/);
  });
});

describe('Secrets & variables', () => {
  function baseDoc(secretProps: Record<string, unknown>): ArchvizDocument {
    return {
      ...createEmptyDocument('secrets-demo'),
      resources: [
        resource({ id: 'vpc-1', type: 'aws/vpc', name: 'vpc', properties: { cidr_block: '10.0.0.0/16' } }),
        resource({
          id: 'subnet-1',
          type: 'aws/subnet',
          name: 'subnet',
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        resource({
          id: 'sg-1',
          type: 'aws/security-group',
          name: 'sg',
          parentId: 'vpc-1',
          properties: { description: 'db sg' },
        }),
        resource({
          id: 'secret-1',
          type: 'aws/secrets-manager-secret',
          name: 'db-secret',
          properties: { secret_name: 'app/db-password', ...secretProps },
        }),
        resource({
          id: 'rds-1',
          type: 'aws/rds-instance',
          name: 'db',
          parentId: 'subnet-1',
          properties: {
            engine: 'postgres',
            instance_class: 'db.t3.micro',
            allocated_storage: 20,
            username: 'admin',
            password: 'changeme',
          },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'uses-secret', sourceId: 'rds-1', targetId: 'secret-1' },
        { id: 'r-rds-sg', relationship: 'attached-to', sourceId: 'rds-1', targetId: 'sg-1' },
      ],
    };
  }

  it('generated-password: creates random_password + secret_version and wires RDS password', () => {
    const doc = baseDoc({ source: 'generated-password' });
    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "random_password" "db_secret_password"');
    expect(hcl).toContain('resource "aws_secretsmanager_secret_version" "db_secret_version"');
    expect(hcl).toContain('secret_string = random_password.db_secret_password.result');
    expect(hcl).toContain('resource "aws_db_instance" "db"');
    expect(hcl).toMatch(/password\s+= random_password\.db_secret_password\.result/);
    expect(hcl).not.toMatch(/password\s+= "changeme"/);

    const result = generate(doc, registry, { layout: 'single-file' });
    expect(result.files['main.tf']).toContain('source  = "hashicorp/random"');
  });

  it('variable source: emits a sensitive variable and wires RDS password to var.*, no random provider needed', () => {
    const doc = baseDoc({ source: 'variable' });
    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('variable "db_secret_value"');
    expect(hcl).toContain('sensitive = true');
    expect(hcl).toMatch(/secret_string\s+= var\.db_secret_value/);
    expect(hcl).toMatch(/password\s+= var\.db_secret_value/);

    const result = generate(doc, registry, { layout: 'single-file' });
    expect(result.files['main.tf']).not.toContain('hashicorp/random');
  });

  it('SSM SecureString parameter can also back a secret-value-ref connection', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('ssm-demo'),
      resources: [
        resource({ id: 'vpc-1', type: 'aws/vpc', name: 'vpc', properties: { cidr_block: '10.0.0.0/16' } }),
        resource({
          id: 'subnet-1',
          type: 'aws/subnet',
          name: 'subnet',
          parentId: 'vpc-1',
          properties: { cidr_block: '10.0.1.0/24' },
        }),
        resource({
          id: 'sg-1',
          type: 'aws/security-group',
          name: 'sg',
          parentId: 'vpc-1',
          properties: { description: 'db sg' },
        }),
        resource({
          id: 'param-1',
          type: 'aws/ssm-parameter',
          name: 'db-param',
          properties: {
            parameter_name: '/app/db-password',
            type: 'SecureString',
            value: 'placeholder',
          },
        }),
        resource({
          id: 'rds-1',
          type: 'aws/rds-instance',
          name: 'db',
          parentId: 'subnet-1',
          properties: {
            engine: 'postgres',
            instance_class: 'db.t3.micro',
            allocated_storage: 20,
            username: 'admin',
            password: 'changeme',
          },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'uses-secret', sourceId: 'rds-1', targetId: 'param-1' },
        { id: 'r-rds-sg', relationship: 'attached-to', sourceId: 'rds-1', targetId: 'sg-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('resource "aws_ssm_parameter" "db_param"');
    expect(hcl).toMatch(/password\s+= aws_ssm_parameter\.db_param\.value/);
  });

  it('ECS task definition injects secrets by ARN, never by value', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('ecs-secrets-demo'),
      resources: [
        resource({
          id: 'role-1',
          type: 'aws/iam-role',
          name: 'exec-role',
          properties: { assume_role_policy: '{}' },
        }),
        resource({
          id: 'secret-1',
          type: 'aws/secrets-manager-secret',
          name: 'db-secret',
          properties: { secret_name: 'app/db-password', source: 'generated-password' },
        }),
        resource({
          id: 'param-1',
          type: 'aws/ssm-parameter',
          name: 'api-key',
          properties: { parameter_name: '/app/api-key', type: 'SecureString', value: 'placeholder' },
        }),
        resource({
          id: 'taskdef-1',
          type: 'aws/ecs-task-definition',
          name: 'taskdef',
          properties: { family: 'app', cpu: '256', memory: '512' },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'execution-role', sourceId: 'taskdef-1', targetId: 'role-1' },
        { id: 'r2', relationship: 'uses-secret', sourceId: 'taskdef-1', targetId: 'secret-1' },
        { id: 'r3', relationship: 'uses-secret', sourceId: 'taskdef-1', targetId: 'param-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);

    // secrets array inside container_definitions: env name derived from the
    // resource name, valueFrom pointing at the ARN (not the plaintext value)
    expect(hcl).toContain('secrets = [');
    expect(hcl).toContain('{ name = "DB_SECRET", valueFrom = aws_secretsmanager_secret.db_secret.arn }');
    expect(hcl).toContain('{ name = "API_KEY", valueFrom = aws_ssm_parameter.api_key.arn }');
    expect(hcl).not.toContain('valueFrom = random_password');

    // execution role gets a read policy scoped to exactly the connected ARNs
    expect(hcl).toContain('resource "aws_iam_role_policy" "taskdef_secrets_access"');
    expect(hcl).toMatch(/role\s+= aws_iam_role\.exec_role\.id/);
    expect(hcl).toContain('Action   = ["secretsmanager:GetSecretValue"]');
    expect(hcl).toContain('Resource = [aws_secretsmanager_secret.db_secret.arn]');
    expect(hcl).toContain('Action   = ["ssm:GetParameters"]');
    expect(hcl).toContain('Resource = [aws_ssm_parameter.api_key.arn]');

    // the connection rule satisfies the constraint engine — export is not blocked
    expect(generate(doc, registry, { layout: 'single-file' }).blocked).toBe(false);
  });

  it('ECS task definition without an execution role warns instead of emitting a policy', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('ecs-secrets-no-role'),
      resources: [
        resource({
          id: 'secret-1',
          type: 'aws/secrets-manager-secret',
          name: 'db-secret',
          properties: { secret_name: 'app/db-password', source: 'generated-password' },
        }),
        resource({
          id: 'taskdef-1',
          type: 'aws/ecs-task-definition',
          name: 'taskdef',
          properties: { family: 'app', cpu: '256', memory: '512' },
        }),
      ],
      relationships: [
        { id: 'r1', relationship: 'uses-secret', sourceId: 'taskdef-1', targetId: 'secret-1' },
      ],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('secrets = [');
    expect(hcl).toContain('WARNING: secrets are injected below but no Execution Role is connected');
    expect(hcl).not.toContain('aws_iam_role_policy');
  });

  it('promotes a plain property to a Terraform variable', () => {
    const doc: ArchvizDocument = {
      ...createEmptyDocument('varpromo-demo'),
      resources: [
        resource({
          id: 'vpc-1',
          type: 'aws/vpc',
          name: 'vpc',
          properties: { cidr_block: '10.0.0.0/16' },
          variableBindings: { cidr_block: 'vpc_cidr' },
        }),
      ],
      relationships: [],
    };

    const hcl = generateMainTf(doc, registry);
    expect(hcl).toContain('variable "vpc_cidr"');
    expect(hcl).toContain('default = "10.0.0.0/16"');
    expect(hcl).toContain('cidr_block = var.vpc_cidr');
    expect(hcl).not.toContain('cidr_block = "10.0.0.0/16"');
  });
});
