# LocalStack (Hobby-first)

Archviz can **apply** generated Terraform to [LocalStack](https://www.localstack.cloud/) — an emulated AWS API on your machine. This is the supported exception to the “no real AWS apply” rule: state and APIs stay local/ephemeral.

Real-cloud `terraform apply` is still **not** run by the runner. Use your terminal for that after review.

## Requirements

- Docker (Desktop / Engine) with the default socket at `/var/run/docker.sock`
- `terraform` on PATH
- Archviz runner: `pnpm runner` (from repo root; serves Studio on `http://127.0.0.1:4180`)
- Default image: **`localstack/localstack:4.14.0`** (last community release before LocalStack required an auth token in 2026.03). **No token needed.**

The runner starts LocalStack with **`/var/run/docker.sock` mounted** (not `~/.docker/run/docker.sock` — that path is for the Docker CLI only and fails as a volume mount on Docker Desktop for Mac) and **ports `4510–4559` published**. The socket is required for services that spawn sibling containers (ECS `RunTask`, Lambda). The extra ports are required for `docker push` into LocalStack ECR. Without the socket LocalStack returns `Docker not available`. If an older container is already running without these settings, **Apply** or **Start** recreates it.

On Docker Desktop: Settings → Advanced → enable **“Allow the default Docker socket to be used”** if `/var/run/docker.sock` mounts fail.

### ECS images (automatic build)

When LocalStack **Apply** succeeds and the diagram includes ECS, the runner:

1. Looks for a Dockerfile in the optional `appFiles` payload (Enterprise **Generate** sends `app/Dockerfile` + sources).
2. Finds `aws_ecr_repository` names in the Terraform.
3. `docker build`s the app, tags it as the LocalStack ECR URI (`…localhost.localstack.cloud:4566/<repo>:latest`), and best-effort `docker push`es.
4. Rewrites ECR `image_tag_mutability` to **MUTABLE** for the LocalStack workspace so `:latest` can be overwritten.
5. Forces a new ECS deployment, waits for a RUNNING task, probes `/health`, and emits a **service** NDJSON event with `url` + `swaggerUrl` for Studio **Open Swagger (LocalStack)**.

Studio shows **image** then **service** phases in the Output log. After Apply, use **Open Swagger (LocalStack)** on the Live Terraform Output card — or Enterprise **Run & Test** / **Open LocalStack API** — to hit the API running in LocalStack ECS.

Docker Compose under `app/` is still generated for offline CLI (`docker compose up`), but Studio Run & Test no longer starts Compose; it opens the LocalStack URL from Apply.

If no Dockerfile was sent, Apply still succeeds but emits a warning — containers will not start until you Generate and Apply again.

### DATABASE_URL (ECS → RDS)

When an ECS **service** `connects-to` an RDS instance (and `runs-task` a task definition), codegen injects a container `DATABASE_URL` environment variable pointing at that `aws_db_instance` (username/password/host/port/`db_name` from Terraform attributes). Without the edge, SQL apps on LocalStack ECS cannot reach RDS.

LocalStack often reports `DBName=test` even when the diagram set `db_name=app`, so the URL uses `coalesce(aws_db_instance.*.db_name, "postgres")` rather than a hard-coded diagram string.

The Go scaffold **pings with retries** and applies `app/internal/db/schema.sql` on startup (`EnsureSchema`). Without that, LocalStack RDS has no tables (unlike `docker compose`, which mounts schema into `docker-entrypoint-initdb.d`).

When the canvas has a separate **web** ECS tier, Studio **Open UI / Open LocalStack API** resolve the **API** service (the task with `DATABASE_URL`), not the web-only task.

Apply URLs are persisted under `terraform-out/<project>/localstack/.archviz-service.json` and restored after a runner restart via `GET /api/localstack/service` (Studio also caches them in `localStorage`). You should **not** need to Apply again just to Open UI — only when ECS is actually gone.
Optional env (also loaded from `.env` when you start the runner — Archviz root, cwd, or sibling `archviz-enterprise/.env`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LOCALSTACK_IMAGE` | `localstack/localstack:4.14.0` | Pin or upgrade the Docker image |
| `LOCALSTACK_AUTH_TOKEN` | unset | Required only for `latest` / `2026.03+` images |
| `LOCALSTACK_ENDPOINT` | `http://127.0.0.1:4566` | Terraform endpoint override |

Example repo-root `.env` (see `.env.example`):

```bash
LOCALSTACK_IMAGE=localstack/localstack:latest
LOCALSTACK_AUTH_TOKEN=ls-...
```

Then `pnpm runner` — no need to `export` in the shell.

## Hobby vs paid

| Plan | Cost | Archviz use |
|------|------|-------------|
| **Pinned 4.14.0 (default)** | Free, no account | Community-era services Archviz allowlists for local apply |
| **Hobby** | Free account + auth token | Same class of services on current images |
| **Base** | ~$39/license/mo annual | Commercial teams; more services |
| **Ultimate** | ~$89/license/mo annual | ECS, RDS, ALB, ElastiCache, etc. |
| **OSS sponsorship** | Free (apply) | Eligible public OSS projects — [LocalStack pricing / OSS](https://www.localstack.cloud/pricing) |

When `LOCALSTACK_AUTH_TOKEN` is set, Archviz also allows **Ultimate-hint** palette types (ECS, RDS, ALB, …) for Apply. Without a token, those diagrams show a Hobby badge and Apply stays disabled.

**Commercial / LLC:** Hobby/community terms are non-commercial. CodeUp LLC dogfooding needs Base/Ultimate (or OSS sponsorship). End users bring their own LocalStack license; Archviz does not vendor one.

## Studio

In the Terraform panel:

1. Start the runner (`pnpm runner`) with Docker available.
2. Build a Hobby-compatible diagram (or load the fixture below). For ECS/RDS API testing you need Ultimate (or a token) plus Generate’d app files.
3. **LS Destroy** (optional) — clears the LocalStack workspace and any previous Swagger URL.
4. **LocalStack Apply** — starts LocalStack if needed, writes HCL into `<export>/<diagram>/localstack/`, injects LocalStack provider endpoints, `terraform apply`, builds the ECS image when present, then discovers the service URL.
5. **Open Swagger (LocalStack)** appears on the Output card when an ECS task is reachable — use that for API testing against the applied stack.

Unsupported palette nodes (e.g. ECS, RDS without a token) show a **Hobby** badge and block Apply until you remove them or upgrade LocalStack.

**Plan** still uses your normal AWS credentials and never applies.

## Hobby allowlist (palette types)

Supported on Hobby by default:

- `aws/lambda-function`
- `aws/dynamodb-table`
- `aws/s3-bucket`
- `aws/sqs-queue`
- `aws/sns-topic`
- `aws/iam-role`
- `aws/cloudwatch-log-group`
- `aws/ssm-parameter`
- `aws/secrets-manager-secret`
- `aws/api-gateway-http-api`
- `aws/vpc`, `aws/subnet`, `aws/security-group`

Typically need **Ultimate** (or sponsorship):

- ECS cluster / service / task definition, ECR
- RDS / Aurora, ElastiCache
- ALB / target group, EC2

## Fixture

```bash
node scripts/write-localstack-hobby-fixture.mjs
```

Writes [`fixtures/localstack-hobby/`](../fixtures/localstack-hobby/) — Lambda + DynamoDB + IAM, plus `function.zip`.

## Runner API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Includes `localstack` status |
| GET | `/api/localstack/status` | Container / health |
| POST | `/api/localstack/start` | `docker run` LocalStack |
| POST | `/api/localstack/stop` | Remove container |
| GET | `/api/ops/current` | In-flight op snapshot (`busy`, `kind`, buffered events) for Studio refresh reattach |
| GET | `/api/ops/stream` | Replay buffer + live NDJSON until the op exits |
| POST | `/api/localstack/apply` | Body like `/api/plan` + `resourceTypes[]` |
| POST | `/api/localstack/destroy` | Same body; `terraform destroy` |

After a browser refresh, Studio polls health (`busy` / `op`) and, if an Apply/Plan is still running, opens `/api/ops/stream` so Output keeps filling without starting a second terraform.

Apply/destroy workspaces live under `<cwd>/<diagram-slug>/localstack/` so plan state against real AWS is never mixed with LocalStack state.

## See also

- [LocalStack pricing](https://www.localstack.cloud/pricing)
- [AWS coverage](./aws-coverage.md)
