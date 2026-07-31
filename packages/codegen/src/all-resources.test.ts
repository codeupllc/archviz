import { describe, expect, it } from 'vitest';
import { createAwsRegistry } from '@archviz/provider-aws';
import { buildAllResourcesDocument } from './demo-fixture.js';
import { generate, generateMainTf } from './index.js';

const registry = createAwsRegistry();

/**
 * Guards against resource definitions that silently omit arguments Terraform
 * requires. `terraform validate` on this same fixture runs in CI
 * (scripts/validate-fixture.mjs); these assertions catch the same regressions
 * in the fast unit-test loop.
 */
describe('all-resources fixture', () => {
  it('covers every resource type in the registry', () => {
    const used = new Set(buildAllResourcesDocument().resources.map((r) => r.type));
    const missing = registry.all().map((d) => d.id).filter((id) => !used.has(id));
    expect(missing).toEqual([]);
  });

  it('validates without errors', () => {
    const result = generate(buildAllResourcesDocument(), registry, { layout: 'by-category' });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
    expect(result.blocked).toBe(false);
  });

  it('emits the arguments Terraform requires for each resource', () => {
    const hcl = generateMainTf(buildAllResourcesDocument(), registry);

    // Previously missing entirely
    expect(hcl).toMatch(/resource "aws_lambda_function" "worker" \{[\s\S]*?function_name\s+= "worker"/);
    expect(hcl).toMatch(/resource "aws_lambda_function" "worker" \{[\s\S]*?role\s+= aws_iam_role\.lambda_role\.arn/);
    expect(hcl).toMatch(/resource "aws_dynamodb_table" "users" \{[\s\S]*?name\s+= "users"/);
    expect(hcl).toMatch(/resource "aws_ssm_parameter" "api_key" \{[\s\S]*?value\s+= "placeholder"/);
    expect(hcl).toMatch(/resource "aws_sqs_queue" "jobs" \{[\s\S]*?name\s+= "app-jobs"/);
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_sqs_consume_jobs"');
    expect(hcl).toContain('sqs:ReceiveMessage');
    expect(hcl).toContain('resource "aws_lambda_event_source_mapping" "worker_from_jobs"');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_sqs_produce_jobs"');
    expect(hcl).toContain('sqs:SendMessage');
    expect(hcl).toContain('resource "aws_iam_role_policy" "web_s3_consume_assets"');
    expect(hcl).toContain('s3:GetObject');
    expect(hcl).toContain('resource "aws_iam_role_policy" "worker_dynamodb_consume_users"');
    expect(hcl).toContain('dynamodb:GetItem');
    expect(hcl).toMatch(/resource "aws_sns_topic" "events" \{[\s\S]*?name\s+= "app-events"/);
    expect(hcl).toContain('resource "aws_sns_topic_subscription" "events_to_jobs"');
    expect(hcl).toContain('resource "aws_sqs_queue_policy" "jobs_from_events"');
    expect(hcl).toContain('sns:Publish');

    // CloudWatch Log Group
    expect(hcl).toMatch(/resource "aws_cloudwatch_log_group" "lambda_logs" \{[\s\S]*?name\s+= "\/aws\/lambda\/worker"/);
    expect(hcl).toMatch(/retention_in_days\s+= 7/);

    // API Gateway HTTP API integration, route, and stage
    expect(hcl).toMatch(/resource "aws_apigatewayv2_api" "api" \{[\s\S]*?name\s+= "my-http-api"/);
    expect(hcl).toMatch(/protocol_type\s+= "HTTP"/);
    expect(hcl).toContain('resource "aws_apigatewayv2_integration" "api_to_worker_integration"');
    expect(hcl).toMatch(/integration_type\s+= "AWS_PROXY"/);
    expect(hcl).toMatch(/integration_uri\s+= aws_lambda_function\.worker\.invoke_arn/);
    expect(hcl).toContain('resource "aws_apigatewayv2_route" "api_to_worker_route"');
    expect(hcl).toMatch(/route_key\s+= "ANY \/\{proxy\+\}"/);
    expect(hcl).toContain('resource "aws_apigatewayv2_stage" "api_stage"');
    expect(hcl).toContain('resource "aws_lambda_permission" "api_invoke_worker"');
    expect(hcl).toMatch(/principal\s+= "apigateway\.amazonaws\.com"/);
    expect(hcl).toMatch(/auto_deploy\s+= true/);

    // DynamoDB requires an attribute definition per key
    expect(hcl).toMatch(/attribute \{\s+name = "id"\s+type = "S"/);
    expect(hcl).toMatch(/attribute \{\s+name = "created_at"\s+type = "N"/);

    // ALB subnets must be a list spanning parent + "also spans" connections
    expect(hcl).toMatch(
      /resource "aws_lb" "public_alb" \{[\s\S]*?subnets = \[\s+aws_subnet\.private_a\.id,\s+aws_subnet\.private_b\.id/,
    );

    // Listener and attachment must be real LB resources, not source_id/target_id stubs
    expect(hcl).toContain('resource "aws_lb_listener" "public_alb_to_web_tg"');
    expect(hcl).toContain('load_balancer_arn = aws_lb.public_alb.arn');
    expect(hcl).toMatch(/default_action \{\s+type\s+= "forward"\s+target_group_arn = aws_lb_target_group\.web_tg\.arn/);
    expect(hcl).toContain('load_balancer_type = "network"');
    expect(hcl).toContain('resource "aws_lb_listener" "public_nlb_to_tcp_tg"');
    expect(hcl).toContain('resource "aws_internet_gateway" "main_igw"');
    expect(hcl).toContain('lambda.amazonaws.com');
    expect(hcl).toContain('ecs-tasks.amazonaws.com');
    expect(hcl).toMatch(
      /resource "aws_lb_target_group_attachment" "web_tg_to_web" \{\s+target_group_arn = aws_lb_target_group\.web_tg\.arn/,
    );
    expect(hcl).not.toContain('source_id');

    // EC2 needs an instance profile, not the role directly
    expect(hcl).toContain('resource "aws_iam_instance_profile" "web_profile"');
    expect(hcl).toMatch(/iam_instance_profile\s+= aws_iam_instance_profile\.web_profile\.name/);
  });

  it('emits each security-group rule pair once even when several resources share it', () => {
    const hcl = generateMainTf(buildAllResourcesDocument(), registry);
    const egressRules = hcl.match(/resource "aws_vpc_security_group_egress_rule" "(\w+)"/g) ?? [];
    expect(new Set(egressRules).size).toBe(egressRules.length);
  });

  it('omits incomplete nested blocks rather than emitting invalid ones', () => {
    // A Lambda with no subnet parent and no security group must not get a vpc_config.
    const doc = buildAllResourcesDocument();
    const hcl = generateMainTf(doc, registry);
    expect(hcl).not.toMatch(/vpc_config \{\s+\}/);
    expect(hcl).not.toMatch(/network_configuration \{\s+assign_public_ip = false\s+\}/);
  });
});

describe('missing required connections', () => {
  it('flags a Lambda with no execution role instead of generating invalid HCL', () => {
    const doc = buildAllResourcesDocument();
    const withoutRole = {
      ...doc,
      relationships: doc.relationships.filter((r) => r.id !== 'r-lambda-role'),
    };

    const result = generate(withoutRole, registry, { layout: 'single-file' });
    expect(result.blocked).toBe(true);
    expect(
      result.diagnostics.some(
        (d) => d.code === 'missing-required-connection' && d.message.includes('Execution Role'),
      ),
    ).toBe(true);
  });

  it('flags an ECS service without Subnet (runs-in) before awsvpc Apply fails', () => {
    const doc = buildAllResourcesDocument();
    const withoutSubnet = {
      ...doc,
      relationships: doc.relationships.filter((r) => r.id !== 'r-svc-subnet-a' && r.id !== 'r-svc-subnet-b'),
    };

    const result = generate(withoutSubnet, registry, { layout: 'single-file' });
    expect(result.blocked).toBe(true);
    expect(
      result.diagnostics.some(
        (d) =>
          d.code === 'missing-required-connection' &&
          d.message.includes('Subnet') &&
          d.resourceId === 'svc-1',
      ),
    ).toBe(true);
  });
});
