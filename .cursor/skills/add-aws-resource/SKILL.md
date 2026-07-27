---
name: add-aws-resource
description: >-
  Adds or deepens Archviz AWS palette resources from Terraform AWS provider
  docs: defineResource, emitters/materializers, fixtures, and coverage tracking.
  Use when the user asks to add an AWS component, implement a Terraform AWS
  resource, extend provider-aws, pick the next backlog item, update
  docs/aws-coverage.md, or deepen connection materialization (IAM, SG rules,
  companions) on existing edges.
---

# Add AWS resource (Archviz)

## Before coding

1. Read [docs/aws-coverage.md](../../../docs/aws-coverage.md) — covered list, companions, **connection materialization audit**, and **P0→P3** backlog.
2. Confirm scope with the user if ambiguous: **new palette node** vs **deepen existing** vs **companion-only** (emitter) vs **deepen a connection**. Prefer deepen/companion when coverage says so.
3. Pick one Terraform resource (or a tight companion set). Do not boil the ocean.

## Connection-first design (do this for every edge)

Before shipping a relationship, ask: **what must Terraform emit for this edge to be real?**

| If AWS access is… | Prefer materialization | Examples |
|---|---|---|
| VPC network reachability | `sg-rule-pair` via `connects-to` | EC2/Lambda/ECS → RDS, Aurora, ElastiCache |
| API access to a resource ARN | IAM on **assumed workload role** (`sqs-iam` pattern) | → SQS, S3, DynamoDB, SNS |
| Identity / attachment attr | `attribute` / `ref.rel` / nesting | `role`, `subnet_id`, `cluster`, `task_definition` |
| Extra AWS object | companion emitter / materializer | LB listener, TG attachment, secret version, event source mapping |
| Already handled elsewhere | `annotation` only | Document why; else it is a **gap** |

**RDS / Aurora / ElastiCache:** services do **not** need an IAM “read DB” policy by default — they need SG path (`connects-to`) plus optional `uses-secret` for passwords. IAM DB auth is a later deepen.

**S3 / DynamoDB / SQS:** no SG path — emit role policies via `api-iam` / `reads-from` (consume vs produce; edge label cycles when both exist).

Resolve workload roles like SQS does: Lambda/EC2 `assumes`; ECS Service → Task Definition → **task-role** (app IAM), not execution role (secrets pull stays on execution role).

See the audit table in `docs/aws-coverage.md` before inventing a new strategy.

## Fetch Terraform AWS features

Pull the **current** HashiCorp docs (do not rely on memory for required args):

1. Registry doc: `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/<NAME>`
   - Example: `.../docs/resources/sqs_queue` → `aws_sqs_queue`
2. Use WebFetch/WebSearch as needed. Extract:
   - **Required** arguments
   - Arguments that must be **references** (subnet_ids, role, vpc_id, …) → Archviz **connections** or **nesting**, never free-text ARNs when a node exists
   - Nested blocks that need a custom **emitter** (cannot be flat `terraform.attributes`)
   - Whether consumers need **IAM**, **SG rules**, or **both**
   - Sensible optional props with defaults (keep the properties panel small)
3. Find a **similar existing** Archviz resource and copy its shape:
   - Simple node: `packages/provider-aws/src/resources/s3.ts`
   - Nested + required role: `lambda.ts`
   - Multi-AZ + emitter: `alb.ts` + ALB bits in `packages/codegen/src/aws-emitters.ts` / `aws-materializers.ts`
   - Secrets wiring: `secrets-manager.ts` / `ssm-parameter.ts`
   - IAM-from-edge: `sqs-iam` / `reads-from` in `aws-materializers.ts`

## Implementation checklist

Copy and track:

```
- [ ] defineResource in packages/provider-aws/src/resources/<name>.ts
- [ ] Export + register in resources/index.ts and provider index.ts (awsResources array)
- [ ] ICON_LABELS / CATEGORY_COLORS in icons.ts if new icon/category
- [ ] For each connection: pick SG / IAM / attribute / companion / annotation (justify annotation)
- [ ] Custom emitter and/or materializer if nested blocks / companions / IAM
- [ ] Add to buildAllResourcesDocument() in packages/codegen/src/demo-fixture.ts
- [ ] Assert required HCL in packages/codegen/src/all-resources.test.ts (and focused tests)
- [ ] Update packages/provider-aws/src/resources.test.ts id list + length
- [ ] pnpm test (affected packages) + node scripts/validate-fixture.mjs if terraform available
- [ ] Move item in docs/aws-coverage.md (backlog → covered); bump count / date; refresh connection audit if edges changed
- [ ] One-line update README § “AWS resources” list
```

### defineResource rules

- `id`: `aws/<kebab-name>` matching existing style (`aws/lambda-function`).
- `terraform.resourceType`: exact TF type (`aws_sqs_queue`).
- Flat attrs → `prop('…')` / `ref.rel('relationship', 'attr', optional)`.
- Anything Terraform **requires** that can only come from another resource → connection with `cardinality.minOutgoing: 1` (see Lambda `assumes`) so Export/Plan block with a clear diagnostic instead of invalid HCL.
- Use capabilities (`network-service`, `network-client`, `storage`, …) for polymorphic `connects-to` / `reads-from` targets.
- Do **not** duplicate the same `relationship` name twice on one resource (`defineResource` forbids it) — dispatch by target type inside one materializer (see `reads-from`).
- `materialize.strategy`:
  - `attribute` — write a single attribute from the target
  - `annotation` — diagram-only unless an emitter elsewhere covers it
  - `sg-rule-pair` — security group ingress/egress between client and service
  - `sqs-iam` / `reads-from` — IAM on assumed role for messaging/API resources
  - `secret-value-ref`, `lb-listener`, `instance-profile`, … — see `aws-materializers.ts`

### When you need an emitter

Add `registerResourceEmitter('aws/…', …)` in `packages/codegen/src/aws-emitters.ts` if you must emit:

- Nested blocks (`vpc_config`, `container_definitions`, …)
- Companion resources (log groups, listeners, secret versions, instance profiles)

Keep companions **out of the palette** unless users must configure them as first-class nodes (document under “Companions” in coverage).

### Outputs (optional)

If the resource has a stable useful attr (endpoint, url, arn), extend `packages/codegen/src/outputs.ts` like VPC/ALB/RDS.

## Definition of done

Generated HCL for a minimal valid diagram:

1. Passes unit tests and `validate-fixture` (terraform validate) when possible.
2. Missing required connections surface as **diagnostics**, not silent omit.
3. User-facing data/access edges emit real HCL (or an explicit WARNING) — not silent annotation.
4. `docs/aws-coverage.md` reflects the new reality (including the connection audit when relevant).

## Anti-patterns

- Publishing every optional TF argument as a property.
- Hardcoding ARNs/IDs the canvas could express as edges.
- Adding IAM “read DB” policies for RDS when `connects-to` SG rules are the real requirement.
- Leaving `reads-from` / `writes-to` / `connects-to` as silent annotation when plan would need IAM or SG changes.
- Adding EKS/CodePipeline/etc. from P2/P3 without an explicit user ask.
- Leaving the coverage doc stale.
