#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createArchvizMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createArchvizMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `archviz-mcp connected (filesystem store; ARCHVIZ_PROJECTS_DIR=${process.env.ARCHVIZ_PROJECTS_DIR ?? './projects'})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
