# AWS resource coverage

Living inventory of Archviz palette nodes (`@archviz/provider-aws`) vs Terraform AWS resources still worth adding.

**How to update:** when you ship (or intentionally defer) a resource, edit this file in the same PR. Agents implementing new AWS nodes must follow [`.cursor/skills/add-aws-resource/SKILL.md`](../.cursor/skills/add-aws-resource/SKILL.md).

**Counts:** 24 palette resources · last reviewed 2026-07-28

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
| ✓ | `aws/sqs-queue` | `aws_sqs_queue` | integration | Lambda/ECS/EC2: `reads-from` / `writes-to` IAM on assumed role |
| ✓ | `aws/sns-topic` | `aws_sns_topic` | integration | `writes-to` → Publish IAM; `delivers-to` → SQS subscription + queue policy |
| ✓ | `aws/api-gateway-http-api` | `aws_apigatewayv2_api` | networking | HTTP API for Lambda; `routes-to` → integration/route/stage companions |
| ✓ | `aws/cloudwatch-log-group` | `aws_cloudwatch_log_group` | management | Standalone logs; optional `logs-to` from Lambda |

### Companions (emitted, not palette nodes)

These appear in generated HCL when relationships/emitters need them — do **not** duplicate as palette nodes unless the user needs to configure them independently.

| Terraform type | Triggered by |
|---|---|
| `aws_lb_listener` | ALB → Target Group (`routes-to`) |
| `aws_iam_instance_profile` | EC2 → IAM Role (`assumes`) |
| `aws_cloudwatch_log_group` | ECS Task Definition emitter (auto-created for containers) |
| `aws_iam_role_policy` | Task Def secrets + Execution Role; API IAM from reads-from/writes-to |
| `aws_sns_topic_subscription` | SNS → SQS (`delivers-to`) |
| `aws_sqs_queue_policy` | SNS → SQS delivery allow |
| `aws_secretsmanager_secret_version` | Secrets Manager source |
| `random_password` | Secrets Manager `generated-password` |
| `aws_apigatewayv2_integration` | API Gateway HTTP API → Lambda (`routes-to`) |
| `aws_apigatewayv2_route` | API Gateway HTTP API → Lambda (`routes-to`) |
| `aws_apigatewayv2_stage` | API Gateway HTTP API auto-deploy stage |
| Security-group rule resources | `connects-to` / `sg-rule-pair` |

---

## Backlog (highest priority first)

Priority = diagram value for common AWS architectures Archviz already sketches (web/API + data + containers), not “every HashiCorp resource.”

### P0 — Completes existing flows

| Candidate | Terraform type(s) | Why | Suggested connections / nesting |
|---|---|---|---|
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

## Connection materialization audit

Every canvas edge should answer: **what Terraform must this become?** Not every edge needs IAM — pick the mechanism AWS actually uses.

| Access pattern | What AWS needs | Archviz edge today | Materializes? | Gap / next deepen |
|---|---|---|---|---|
| Compute → RDS / Aurora / ElastiCache | Network path (SG allow) | `connects-to` → `network-service` | **Yes** — `sg-rule-pair` | Optional later: IAM DB auth (rare); port-specific rules |
| Compute → Secrets / SSM (inject) | Value/ARN wiring + often IAM | `uses-secret` | **Yes** — value ref + ECS exec-role policy | — |
| Compute → SQS consume / produce | IAM on workload role | `reads-from` / `writes-to` | **Yes** — `api-iam` / `reads-from` | Lambda event-source mapping |
| Compute → S3 / DynamoDB | IAM on workload role | `reads-from` / `writes-to` | **Yes** — same `api-iam` pattern (swappable on edge label) | Finer-grained actions / KMS |
| Compute → SNS publish | IAM on workload role | `writes-to` | **Yes** — `api-iam` Publish | Lambda subscription deepen |
| SNS → SQS fan-out | Subscription + queue policy | `delivers-to` | **Yes** — `sns-sqs-subscription` | Filter policies / raw delivery |
| Lambda / EC2 → IAM Role | Role ARN / instance profile | `assumes` | **Partial** — Lambda attr + EC2 instance profile | Managed-policy attaches |
| ECS Task Def → Task / Exec role | Role ARNs | `task-role` / `execution-role` | **Attrs +** secrets policy on exec | App IAM (S3/DDB) should target **task-role** |
| ALB → Target Group | Listener | `routes-to` | **Yes** — `lb-listener` | HTTPS + ACM |
| TG → EC2 | Attachment | `forwards-to` | **Yes** — attachment | ECS/Lambda targets |
| Task Def → ECR | Image URI | `pulls-image` | **Yes** — emitter in `container_definitions` | Exec-role `ecr:GetAuthorizationToken` if missing |
| ALB / Service → Subnets | Multi-AZ lists | `runs-in` | **Yes** — emitters | — |

### Do services need IAM roles to “read from” a DB?

**Usually no for RDS/Aurora/ElastiCache.** Those are VPC network services: the service needs:

1. Subnets / SG attachment (already modeled)
2. `connects-to` the DB so **security-group rules** open the path (`sg-rule-pair`)

Password/secret wiring is separate (`uses-secret`), not an IAM “read from DB” policy. IAM database authentication is an optional deepen, not the default.

**Yes for DynamoDB / S3 / SQS / SNS / …** — no SG path; the workload’s assumed role (Lambda `assumes`, EC2 instance profile, ECS **task** role) needs a queue/table/bucket-scoped policy. SQS is the template; S3/DynamoDB `reads-from` should follow the same pattern.

### Rule of thumb for agents

When adding or deepening a connection, choose **one primary materialization** (combine only when AWS requires both, e.g. ECS secrets = ARN inject + exec-role IAM):

1. **Nesting / attribute** — identity wiring (`subnet_id`, `role`, `cluster`)
2. **Security group** — VPC network reachability
3. **IAM on assumed role** — AWS API access to a resource ARN
4. **Companion resource** — listener, attachment, event source mapping, secret version
5. **Annotation** — only when the diagram is intentional documentation *or* an emitter on another node already covers it

Never leave a user-facing “Reads from / Writes to / Connects to” edge as silent annotation if Terraform would fail or be insecure without it — either emit HCL or show a diagnostic/WARNING.

**No Policy palette node.** IAM is emitted as `aws_iam_role_policy` companions on the workload’s assumed role when the edge says so (SQS / S3 / DynamoDB). The studio edge label cycles relationship kinds when several are valid (select, then click again, or use the Connection properties dropdown).

Missing workload role for SQS (and similar API edges) is a **structural error** on the compute node — same class as Lambda missing Execution Role — so Diagnostics / Export / Plan surface it, not only a `# WARNING` in `.tf`.

---

## Deepen existing nodes (before net-new when possible)

Often better than a new palette entry:

1. **S3** — versioning, encryption, public access block companions; finer IAM actions
2. **ALB** — HTTPS listener + ACM connection; path-based listener rules
3. **Lambda** — event source mappings for SQS consume
4. **SQS** — DLQ via `redrive_policy` connection; FIFO name validation
5. **RDS / Aurora** — subnet group companion; Performance Insights; optional IAM DB auth
6. **IAM Role** — attach managed policy ARNs property; trust-principal presets (ecs-tasks vs ec2)
7. **VPC** — optional IGW/NAT synthesis from properties (like ECS log group)
8. **ECR pulls** — ensure execution role can pull if not covered by managed policies

---

## Source of truth

- Registry list: `packages/provider-aws/src/resources/index.ts` + `createAwsRegistry()`
- Required-arg guardrail: `packages/codegen/src/demo-fixture.ts` + `scripts/validate-fixture.mjs`
- Human summary: README § “AWS resources”
)
