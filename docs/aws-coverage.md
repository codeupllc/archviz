# AWS resource coverage

Living inventory of Archviz palette nodes (`@archviz/provider-aws`) vs Terraform AWS resources still worth adding.

**How to update:** when you ship (or intentionally defer) a resource, edit this file in the same PR. Agents implementing new AWS nodes must follow [`.cursor/skills/add-aws-resource/SKILL.md`](../.cursor/skills/add-aws-resource/SKILL.md).

**Counts:** 21 palette resources · last reviewed 2026-07-27

---

## Covered (palette)

| Priority done | Archviz id | Terraform type | Category | Notes |
|---|---|---|---|---|
| ✓ | `aws/vpc` | `aws_vpc` | networking | |
| ✓ | `aws/subnet` | `aws_subnet` | networking | Parent: VPC |
| ✓ | `aws/security-group` | `aws_security_group` | security | Parent: VPC; rules via `sg-rule-pair` |
| ✓ | `aws/ec2-instance` | `aws_instance` | compute | Parent: Subnet |
| ✓ | `aws/lambda-function` | `aws_lambda_function` | compute | Requires Execution Role (`assumes`) |
| ✓ | `aws/alb` | `aws_lb` | networking | Multi-AZ via `runs-in`; listener via materializer |
| ✓ | `aws/target-group` | `aws_lb_target_group` | networking | Parent: VPC |
| ✓ | `aws/rds-instance` | `aws_db_instance` | database | `uses-secret` for password |
| ✓ | `aws/aurora-cluster` | `aws_rds_cluster` | database | |
| ✓ | `aws/aurora-cluster-instance` | `aws_rds_cluster_instance` | database | Parent: Aurora cluster |
| ✓ | `aws/elasticache-cluster` | `aws_elasticache_cluster` | database | Redis/Memcached |
| ✓ | `aws/dynamodb-table` | `aws_dynamodb_table` | database | |
| ✓ | `aws/s3-bucket` | `aws_s3_bucket` | storage | |
| ✓ | `aws/iam-role` | `aws_iam_role` | security | |
| ✓ | `aws/ecr-repository` | `aws_ecr_repository` | storage | |
| ✓ | `aws/ecs-cluster` | `aws_ecs_cluster` | compute | |
| ✓ | `aws/ecs-task-definition` | `aws_ecs_task_definition` | compute | Emitter builds `container_definitions` + log group |
| ✓ | `aws/ecs-service` | `aws_ecs_service` | compute | Parent: ECS cluster; subnets via `runs-in` |
| ✓ | `aws/secrets-manager-secret` | `aws_secretsmanager_secret` | security | Companion version + random/variable |
| ✓ | `aws/ssm-parameter` | `aws_ssm_parameter` | management | |
| ✓ | `aws/sqs-queue` | `aws_sqs_queue` | integration | Lambda/ECS/EC2 can `reads-from` |

### Companions (emitted, not palette nodes)

These appear in generated HCL when relationships/emitters need them — do **not** duplicate as palette nodes unless the user needs to configure them independently.

| Terraform type | Triggered by |
|---|---|
| `aws_lb_listener` | ALB → Target Group (`routes-to`) |
| `aws_iam_instance_profile` | EC2 → IAM Role (`assumes`) |
| `aws_cloudwatch_log_group` | ECS Task Definition emitter |
| `aws_iam_role_policy` | Task Def secrets + Execution Role |
| `aws_secretsmanager_secret_version` | Secrets Manager source |
| `random_password` | Secrets Manager `generated-password` |
| Security-group rule resources | `connects-to` / `sg-rule-pair` |

---

## Backlog (highest priority first)

Priority = diagram value for common AWS architectures Archviz already sketches (web/API + data + containers), not “every HashiCorp resource.”

### P0 — Completes existing flows

| Candidate | Terraform type(s) | Why | Suggested connections / nesting |
|---|---|---|---|
| SNS Topic | `aws_sns_topic` (+ optional subscription) | Fan-out; pairs with SQS | `publishes-to` → SQS or Lambda |
| API Gateway HTTP API | `aws_apigatewayv2_api` (+ route/integration companions) | Front Lambda without ALB | `routes-to` → Lambda |
| CloudWatch Log Group | `aws_cloudwatch_log_group` | Standalone logs for Lambda; ECS already synthesizes one | Optional nest / `logs-to` from Lambda |
| NLB | `aws_lb` (`load_balancer_type=network`) | TCP/UDP; ECS/EC2 already exist | Mirror ALB patterns |

### P1 — High-value architecture blocks

| Candidate | Terraform type(s) | Why |
|---|---|---|
| CloudFront Distribution | `aws_cloudfront_distribution` | Front S3/ALB |
| Route 53 Zone + Record | `aws_route53_zone`, `aws_route53_record` | DNS → ALB/CloudFront |
| ACM Certificate | `aws_acm_certificate` | HTTPS on ALB/CloudFront |
| VPC Endpoint | `aws_vpc_endpoint` | Private S3/ECR/Secrets without NAT |
| NAT Gateway + EIP | `aws_nat_gateway`, `aws_eip` | Private subnet egress (today users hand-write) |
| Internet Gateway | `aws_internet_gateway` | Public VPC egress (often assumed) |
| Auto Scaling Group + Launch Template | `aws_autoscaling_group`, `aws_launch_template` | EC2 fleet behind ALB/TG |
| EventBridge Rule | `aws_cloudwatch_event_rule` (+ target) | Schedule/event → Lambda |
| Cognito User Pool | `aws_cognito_user_pool` (+ client) | Auth in front of API |

### P2 — Nice-to-have / specialized

| Candidate | Terraform type(s) | Why later |
|---|---|---|
| WAF Web ACL | `aws_wafv2_web_acl` | Security edge; needs CloudFront/ALB association |
| Kinesis Data Stream | `aws_kinesis_stream` | Streaming; less common than SQS |
| Step Functions | `aws_sfn_state_machine` | Orchestration JSON is heavy for a diagram node |
| EKS Cluster + Node Group | `aws_eks_cluster`, … | Large surface; ECS covers containers for now |
| OpenSearch Domain | `aws_opensearch_domain` | Niche vs DynamoDB/RDS |
| MSK Cluster | `aws_msk_cluster` | Heavy Kafka |
| CodePipeline / CodeBuild | `aws_codepipeline`, … | CI lives outside Archviz non-goals |
| Bedrock / SageMaker | various | AI specialty; low diagram frequency |
| Glue / Athena | various | Analytics specialty |

### P3 — Prefer companions or out of scope

Keep as emitter/materializer output (or leave to hand-written `.tf`) unless users repeatedly ask for canvas control:

- `aws_db_subnet_group`, `aws_elasticache_subnet_group`
- `aws_lb_listener_rule`, `aws_lb_target_group_attachment`
- `aws_iam_role_policy_attachment`, managed policy ARNs as free-text
- S3 bucket public-access-block / versioning as **properties or companions** of `aws/s3-bucket` (prefer deepening S3 over a new node)
- Remote state / backends (explicit non-goal — see README)

---

## Deepen existing nodes (before net-new when possible)

Often better than a new palette entry:

1. **S3** — versioning, encryption, public access block companions
2. **ALB** — HTTPS listener + ACM connection; path-based listener rules
3. **Lambda** — event source mappings (SQS/SNS/EventBridge) once those nodes exist; `publishes-to` producer edge
4. **SQS** — DLQ via `redrive_policy` connection to another queue; FIFO name validation
5. **RDS / Aurora** — subnet group companion; Performance Insights toggles
6. **IAM Role** — attach managed policy ARNs property; trust-principal presets
7. **VPC** — optional IGW/NAT synthesis from properties (like ECS log group)

---

## Source of truth

- Registry list: `packages/provider-aws/src/resources/index.ts` + `createAwsRegistry()`
- Required-arg guardrail: `packages/codegen/src/demo-fixture.ts` + `scripts/validate-fixture.mjs`
- Human summary: README § “AWS resources”
)
