---
name: add-aws-resource
description: >-
  Adds or deepens Archviz AWS palette resources from Terraform AWS provider
  docs: defineResource, emitters/materializers, fixtures, and coverage tracking.
  Use when the user asks to add an AWS component, implement a Terraform AWS
  resource, extend provider-aws, pick the next backlog item, or update
  docs/aws-coverage.md.
---

# Add AWS resource (Archviz)

## Before coding

1. Read [docs/aws-coverage.md](../../../docs/aws-coverage.md) — covered list, companions, and **P0→P3** backlog.
2. Confirm scope with the user if ambiguous: **new palette node** vs **deepen existing** vs **companion-only** (emitter). Prefer deepen/companion when coverage says so.
3. Pick one Terraform resource (or a tight companion set). Do not boil the ocean.

## Fetch Terraform AWS features

Pull the **current** HashiCorp docs (do not rely on memory for required args):

1. Registry doc: `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/<NAME>`
   - Example: `.../docs/resources/sqs_queue` → `aws_sqs_queue`
2. Use WebFetch/WebSearch as needed. Extract:
   - **Required** arguments
   - Arguments that must be **references** (subnet_ids, role, vpc_id, …) → Archviz **connections** or **nesting**, never free-text ARNs when a node exists
   - Nested blocks that need a custom **emitter** (cannot be flat `terraform.attributes`)
   - Sensible optional props with defaults (keep the properties panel small)
3. Find a **similar existing** Archviz resource and copy its shape:
   - Simple node: `packages/provider-aws/src/resources/s3.ts`
   - Nested + required role: `lambda.ts`
   - Multi-AZ + emitter: `alb.ts` + ALB bits in `packages/codegen/src/aws-emitters.ts` / `aws-materializers.ts`
   - Secrets wiring: `secrets-manager.ts` / `ssm-parameter.ts`

## Implementation checklist

Copy and track:

```
- [ ] defineResource in packages/provider-aws/src/resources/<name>.ts
- [ ] Export + register in resources/index.ts and provider index.ts (awsResources array)
- [ ] ICON_LABELS / CATEGORY_COLORS in icons.ts if new icon/category
- [ ] Custom emitter and/or materializer if nested blocks / companions
- [ ] Add to buildAllResourcesDocument() in packages/codegen/src/demo-fixture.ts
- [ ] Assert required HCL in packages/codegen/src/all-resources.test.ts (and focused tests)
- [ ] Update packages/provider-aws/src/resources.test.ts id list + length
- [ ] pnpm test (affected packages) + node scripts/validate-fixture.mjs if terraform available
- [ ] Move item in docs/aws-coverage.md (backlog → covered); bump count / date
- [ ] One-line update README § “AWS resources” list
```

### defineResource rules

- `id`: `aws/<kebab-name>` matching existing style (`aws/lambda-function`).
- `terraform.resourceType`: exact TF type (`aws_sqs_queue`).
- Flat attrs → `prop('…')` / `ref.rel('relationship', 'attr', optional)`.
- Anything Terraform **requires** that can only come from another resource → connection with `cardinality.minOutgoing: 1` (see Lambda `assumes`) so Export/Plan block with a clear diagnostic instead of invalid HCL.
- Use capabilities (`network-service`, `network-client`, `storage`, …) for polymorphic `connects-to` / `reads-from` targets.
- `materialize.strategy`:
  - `attribute` — write a single attribute from the target
  - `annotation` — relationship recorded; emitter fills nested blocks
  - `sg-rule-pair` — security group ingress/egress between client and service
  - `resource` / custom — see `aws-materializers.ts`

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
3. `docs/aws-coverage.md` reflects the new reality.

## Anti-patterns

- Publishing every optional TF argument as a property.
- Hardcoding ARNs/IDs the canvas could express as edges.
- Adding EKS/CodePipeline/etc. from P2/P3 without an explicit user ask.
- Leaving the coverage doc stale.
)
