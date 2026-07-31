import { describe, expect, it } from 'vitest';
import { createOpsSession } from './ops-session.js';

describe('createOpsSession', () => {
  it('buffers events and fans out to subscribers', () => {
    const ops = createOpsSession();
    expect(ops.begin('plan')).toBe(true);
    expect(ops.begin('apply')).toBe(false);

    const seen: string[] = [];
    const unsub = ops.subscribe((e) => seen.push(e.type));
    ops.emit({ type: 'phase', phase: 'plan' });
    ops.emit({ type: 'output', stream: 'stdout', text: 'hello\n' });
    expect(seen).toEqual(['phase', 'output']);
    expect(ops.snapshot().events).toHaveLength(2);
    expect(ops.snapshot().busy).toBe(true);
    expect(ops.snapshot().kind).toBe('plan');

    unsub();
    ops.emit({ type: 'info', message: 'x' });
    expect(seen).toEqual(['phase', 'output']);

    ops.end();
    expect(ops.snapshot().busy).toBe(false);
  });
});
