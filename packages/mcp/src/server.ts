import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createFilesystemDiagramStore } from './filesystem-store.js';
import { registerCoreTools } from './register-core.js';
import type { CoreToolDeps, DiagramStore } from './types.js';

export interface CreateArchvizMcpServerOptions {
  /** Override persistence (Enterprise passes an HTTP store). */
  store?: DiagramStore;
  defaultOutDir?: string;
  name?: string;
  version?: string;
}

/** Standalone OSS MCP server (filesystem diagram store by default). */
export function createArchvizMcpServer(opts: CreateArchvizMcpServerOptions = {}): McpServer {
  const server = new McpServer({
    name: opts.name ?? 'archviz',
    version: opts.version ?? '0.1.0',
  });
  const deps: CoreToolDeps = {
    store: opts.store ?? createFilesystemDiagramStore(),
    defaultOutDir: opts.defaultOutDir,
  };
  registerCoreTools(server, deps);
  return server;
}
