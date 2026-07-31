# LocalStack Hobby fixture

Minimal **Lambda + DynamoDB + IAM** diagram for free LocalStack Hobby apply.

## Generate Terraform

```bash
node scripts/write-localstack-hobby-fixture.mjs
```

Writes `terraform/` (HCL + `function.zip`) and `diagram.json`.

## Apply via Studio

1. `pnpm runner` (Docker required for LocalStack)
2. Open Studio, import or recreate this diagram
3. Click **LocalStack Apply** (Hobby allowlist must pass)

## Manual note

ECS / RDS diagrams are **not** Hobby — see [docs/localstack.md](../../docs/localstack.md).
