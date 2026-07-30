import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generate } from '@archviz/codegen';
import { createConstraintEngine, type ArchvizDocument } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { z } from 'zod';
import { documentSchema, patchSchema } from './schemas.js';
import { jsonResult } from './result.js';
import type { CoreToolDeps } from './types.js';

const registry = createAwsRegistry();
const engine = createConstraintEngine(registry);

/**
 * Registers the shared Archviz MCP tool surface. Enterprise calls this once,
 * then adds premium tools — do not re-register these names.
 */
export function registerCoreTools(server: McpServer, deps: CoreToolDeps): void {
  const { store } = deps;

  server.registerTool(
    'list_projects',
    {
      description: 'List Archviz projects / diagrams known to the active store.',
      inputSchema: {},
    },
    async () => {
      const projects = await store.list();
      return jsonResult({ ok: true, projects });
    },
  );

  server.registerTool(
    'get_diagram',
    {
      description: 'Read the architecture diagram for a projectId. Prefer before apply_diagram.',
      inputSchema: {
        projectId: z.string().describe('Project id, e.g. proj-8ec98c5d'),
      },
    },
    async ({ projectId }) => {
      const found = await store.get(projectId);
      if (!found) {
        return jsonResult({ ok: false, error: `project not found: ${projectId}` }, true);
      }
      return jsonResult({
        ok: true,
        projectId: found.projectId,
        revision: found.revision,
        projectPath: found.projectPath,
        document: found.document,
      });
    },
  );

  server.registerTool(
    'apply_diagram',
    {
      description:
        'Create or update a diagram. Prefer small patches so UIs watching the store can update live. mode=replace for a full rewrite.',
      inputSchema: {
        projectId: z.string(),
        mode: z.enum(['replace', 'patch']).default('patch'),
        document: documentSchema.optional().describe('Required when mode=replace'),
        patch: patchSchema.optional().describe('Required when mode=patch'),
      },
    },
    async ({ projectId, mode, document, patch }) => {
      try {
        if (mode === 'replace' && !document) {
          return jsonResult({ ok: false, error: 'document required for mode=replace' }, true);
        }
        if (mode === 'patch' && !patch) {
          return jsonResult({ ok: false, error: 'patch required for mode=patch' }, true);
        }
        const written = await store.apply({
          projectId,
          document: mode === 'replace' ? (document as ArchvizDocument) : undefined,
          patch: mode === 'patch' ? patch : undefined,
        });
        return jsonResult({
          ok: true,
          projectId: written.projectId,
          revision: written.revision,
          projectPath: written.projectPath,
          document: written.document,
        });
      } catch (err) {
        return jsonResult(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    'list_resource_types',
    {
      description: 'List registered Archviz resource type ids (AWS palette).',
      inputSchema: {},
    },
    async () => {
      const types = registry.all().map((d) => d.id).sort();
      return jsonResult({ ok: true, types, count: types.length });
    },
  );

  server.registerTool(
    'validate_diagram',
    {
      description: 'Run constraint validation on a project diagram or an inline document.',
      inputSchema: {
        projectId: z.string().optional(),
        document: documentSchema.optional(),
      },
    },
    async ({ projectId, document }) => {
      let doc: ArchvizDocument | null = (document as ArchvizDocument | undefined) ?? null;
      if (!doc && projectId) {
        const found = await store.get(projectId);
        doc = found?.document ?? null;
      }
      if (!doc) {
        return jsonResult({ ok: false, error: 'projectId or document required' }, true);
      }
      const result = engine.validate(doc);
      return jsonResult({
        ok: result.diagnostics.every((d) => d.severity !== 'error'),
        diagnostics: result.diagnostics,
      });
    },
  );

  server.registerTool(
    'generate_terraform',
    {
      description:
        'Deterministic Terraform from the diagram via @archviz/codegen (no LLM). Writes .tf under outDir.',
      inputSchema: {
        projectId: z.string().optional(),
        document: documentSchema.optional(),
        outDir: z
          .string()
          .optional()
          .describe('Output directory for .tf files (default: <project>/terraform or ./terraform-out)'),
      },
    },
    async ({ projectId, document, outDir }) => {
      let doc: ArchvizDocument | null = (document as ArchvizDocument | undefined) ?? null;
      let basePath: string | undefined;
      if (!doc && projectId) {
        const found = await store.get(projectId);
        doc = found?.document ?? null;
        basePath = found?.projectPath;
      }
      if (!doc) {
        return jsonResult({ ok: false, error: 'projectId or document required' }, true);
      }
      const result = generate(doc, registry, {
        emitDespiteErrors: true,
        layout: 'by-category',
      });
      const dest = resolve(
        outDir ??
          (basePath ? join(basePath, 'terraform') : deps.defaultOutDir ?? join(process.cwd(), 'terraform-out')),
      );
      mkdirSync(dest, { recursive: true });
      const written: string[] = [];
      for (const [name, content] of Object.entries(result.files)) {
        const flat = name.includes('/') ? name.replace(/\//g, '__') : name;
        const file = flat.endsWith('.tf') ? flat : `${flat}.tf`;
        writeFileSync(join(dest, file), content.endsWith('\n') ? content : `${content}\n`, 'utf8');
        written.push(file);
      }
      return jsonResult({
        ok: !result.blocked,
        outDir: dest,
        files: written,
        diagnostics: result.diagnostics,
      });
    },
  );
}
