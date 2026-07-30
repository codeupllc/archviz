# Archviz MCP (open source)

Cursor (or any MCP client) can drive diagrams and Terraform through `@archviz/mcp`.

## Tools (core)

| Tool | Purpose |
|------|---------|
| `list_projects` | List diagrams in the store |
| `get_diagram` | Read `ArchvizDocument` + revision |
| `apply_diagram` | Replace or patch (prefer small patches) |
| `list_resource_types` | AWS palette type ids |
| `validate_diagram` | Constraint diagnostics |
| `generate_terraform` | `@archviz/codegen` → `.tf` files |

## Run

```bash
pnpm --filter @archviz/mcp build
pnpm --filter @archviz/mcp start
# or via .cursor/mcp.json in this repo
```

Default store: filesystem under `ARCHVIZ_PROJECTS_DIR` (default `./projects/<id>/diagram.json`).

## Enterprise

[Archviz Enterprise](https://github.com/codeupllc/archviz-enterprise) **imports** `registerCoreTools` from `@archviz/mcp` and adds premium tools (`generate_project`, `run_project`, …) with an HTTP diagram store so Studio can live-follow. It does **not** duplicate the core tool names.
