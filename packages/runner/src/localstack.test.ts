import { describe, expect, it } from 'vitest';
import { buildLocalstackRunArgs, DOCKER_SOCK_PATH } from './localstack.js';

describe('buildLocalstackRunArgs', () => {
  it('mounts /var/run/docker.sock (not ~/.docker/run) for Desktop compatibility', () => {
    const args = buildLocalstackRunArgs({
      image: 'localstack/localstack:latest',
      token: 'ls-test',
    });
    expect(args).toContain('-v');
    expect(args).toContain(`${DOCKER_SOCK_PATH}:${DOCKER_SOCK_PATH}`);
    expect(args.join(' ')).not.toContain('.docker/run/docker.sock');
    expect(args).toContain(`DOCKER_HOST=unix://${DOCKER_SOCK_PATH}`);
    expect(args).toContain('LOCALSTACK_AUTH_TOKEN=ls-test');
    expect(args).toContain('4510-4559:4510-4559');
    expect(args.at(-1)).toBe('localstack/localstack:latest');
  });

  it('omits auth token when unset', () => {
    const args = buildLocalstackRunArgs({ image: 'localstack/localstack:4.14.0' });
    expect(args.join(' ')).not.toContain('LOCALSTACK_AUTH_TOKEN');
  });
});
