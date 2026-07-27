import { describe, expect, it } from 'vitest';
import { parseProjectFile } from './storage';

describe('persistence', () => {
  it('parses a valid project file', () => {
    const doc = parseProjectFile(
      JSON.stringify({
        version: 1,
        meta: {
          name: 'demo',
          provider: 'aws',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        resources: [],
        relationships: [],
      }),
    );
    expect(doc.meta.name).toBe('demo');
  });

  it('rejects invalid project files', () => {
    expect(() => parseProjectFile('{}')).toThrow(/Invalid/);
  });
});
