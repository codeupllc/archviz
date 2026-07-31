import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from './load-env.js';

describe('loadEnvFile', () => {
  const keys = ['ARCHVIZ_TEST_ENV_A', 'ARCHVIZ_TEST_ENV_B'];

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('loads KEY=VALUE without overriding existing env', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archviz-env-'));
    const file = path.join(dir, '.env');
    process.env.ARCHVIZ_TEST_ENV_A = 'keep-me';
    await fs.writeFile(
      file,
      ['# comment', 'ARCHVIZ_TEST_ENV_A=ignored', "ARCHVIZ_TEST_ENV_B='quoted'", ''].join('\n'),
    );

    expect(loadEnvFile(file)).toBe(true);
    expect(process.env.ARCHVIZ_TEST_ENV_A).toBe('keep-me');
    expect(process.env.ARCHVIZ_TEST_ENV_B).toBe('quoted');

    await fs.rm(dir, { recursive: true, force: true });
  });
});
