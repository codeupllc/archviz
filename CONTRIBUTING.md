# Contributing to Archviz

Thanks for helping build an open-source visual Terraform builder. This repo is set up so humans and coding agents can pick a scoped GitHub issue, implement it, and open a PR.

## Pick work

1. Open the **[Archviz AWS coverage](https://github.com/orgs/codeupllc/projects/1)** board or the [issue list](https://github.com/codeupllc/archviz/issues).
2. Prefer **P0** / `good first issue` / `help wanted` items that are still open.
3. Comment on the issue when you start (`I'll take this`) so others don't duplicate work.
4. One issue ≈ one PR. Keep deepen and new-resource work separate unless the issue says otherwise.

Living backlog detail lives in [`docs/aws-coverage.md`](docs/aws-coverage.md). Agents adding AWS nodes must follow [`.cursor/skills/add-aws-resource/SKILL.md`](.cursor/skills/add-aws-resource/SKILL.md).

Coding agents should load **[AGENTS.md](AGENTS.md)** (Cursor and similar) or **[CLAUDE.md](CLAUDE.md)** (Claude Code); both point at the same workflow.

## Dev loop

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck

# After adding/changing a Terraform resource:
node scripts/validate-fixture.mjs tmp/tf-fixture
```

Studio UI: `pnpm --filter @archviz/studio dev`  
Local Plan button: `pnpm runner` (from repo root).

## PR checklist (AWS resources)

- [ ] `defineResource` + register + icon
- [ ] Emitters / materializers for real connections (SG or IAM as appropriate)
- [ ] Fixture + unit tests; `validate-fixture` clean when Terraform is available
- [ ] `docs/aws-coverage.md` updated in the same PR
- [ ] Screenshot or short video of the node/connection in Studio (attach to PR or `docs/images/`)
- [ ] No drive-by refactors unrelated to the issue

## Design rules (short)

- **Connection-first**: if an edge exists on the canvas, generated HCL should materialize it (SG rules, IAM on the workload role, companions) — don't leave silent gaps.
- **Don't auto-create IAM roles**; connect to an existing role. ECS app IAM goes on the **Task Role**, not the Execution Role.
- Prefer deepen/companion over a new palette node when coverage says so.

## Communication

- Use the issue for design questions; keep PR descriptions short (what + why, link the issue with `Fixes #N`).
- Bug reports: repro steps, expected vs actual, diagram export if possible (`.archviz.json`).
