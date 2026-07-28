# Agent instructions (Archviz)

How coding agents (Cursor, Claude Code, etc.) should contribute to this repo.

## Default workflow

1. **Pick work** from the public board: [Archviz AWS coverage](https://github.com/orgs/codeupllc/projects/1)  
   Prefer open **Todo** items labeled `P0`, then `good first issue` / `help wanted`.  
   Fallback: [issues](https://github.com/codeupllc/archviz/issues) + milestone **AWS coverage roadmap**.
2. **Claim** the issue (comment that you are taking it; set board status to In Progress when you can).
3. **One issue ≈ one PR.** Do not expand into neighboring backlog rows unless the issue says so.
4. **Implement** using the skill and coverage doc (below).
5. **Open a PR** with `Fixes #<n>` and the PR template checklist.

Human-oriented detail: [CONTRIBUTING.md](CONTRIBUTING.md).

## AWS resources (required reading)

When adding or deepening AWS palette nodes, connections, emitters, or materializers:

1. Read [`docs/aws-coverage.md`](docs/aws-coverage.md) (covered list, companions, connection audit, P0→P3).
2. Follow [`.cursor/skills/add-aws-resource/SKILL.md`](.cursor/skills/add-aws-resource/SKILL.md) end-to-end.
3. Update `docs/aws-coverage.md` in the **same** PR.

### Design rules (do not violate)

- **Connection-first:** canvas edges must materialize real HCL (SG rules, IAM on the workload role, companions) — no silent annotation gaps.
- **Do not auto-create IAM roles;** connect to an existing role. ECS app IAM → **Task Role**; secrets/ECR pull → **Execution Role**.
- Prefer deepen/companion over a new palette node when coverage says so.
- No drive-by refactors unrelated to the issue.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck

# After AWS resource / codegen changes (needs terraform on PATH):
node scripts/validate-fixture.mjs tmp/tf-fixture
```

Studio: `pnpm --filter @archviz/studio dev`  
Local Plan: `pnpm runner` from repo root (not `npx archviz-runner`).

## Definition of done

- Tests / typecheck green; fixture validate when Terraform is available
- Required missing connections surface as diagnostics, not invalid silent HCL
- Coverage doc updated for new/deepened resources
- PR links the issue with `Fixes #N`
