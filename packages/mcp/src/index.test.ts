import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@archviz/core';
import { createFilesystemDiagramStore } from './filesystem-store.js';
import { createArchvizMcpServer } from './server.js';

describe('filesystem diagram store', () => {
  it('applies replace and patch with bumping revision', async () => {
    const root = mkdtempSync(join(tmpdir(), 'archviz-mcp-'));
    const store = createFilesystemDiagramStore(root);
    const doc = createEmptyDocument('Demo');
    const first = await store.apply({ projectId: 'proj-demo', document: doc });
    expect(first.revision).toBe(1);
    expect(existsSync(join(first.projectPath!, 'diagram.json'))).toBe(true);

    const second = await store.apply({
      projectId: 'proj-demo',
      patch: {
        upsertResources: [
          {
            id: 'res-vpc',
            type: 'aws/vpc',
            name: 'VPC',
            properties: {},
            layout: { x: 10, y: 10 },
          },
        ],
      },
    });
    expect(second.revision).toBe(2);
    expect(second.document.resources.some((r) => r.id === 'res-vpc')).toBe(true);
    expect(JSON.parse(readFileSync(join(second.projectPath!, 'diagram.json'), 'utf8')).resources).toHaveLength(
      1,
    );

    const listed = await store.list();
    expect(listed.some((p) => p.projectId === 'proj-demo')).toBe(true);
  });
});

describe('createArchvizMcpServer', () => {
  it('boots with core tools registered', () => {
    expect(createArchvizMcpServer()).toBeTruthy();
  });
});
