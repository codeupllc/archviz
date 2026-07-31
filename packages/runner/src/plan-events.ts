export type PlanEvent =
  | { type: 'workspace'; dir: string }
  | {
      type: 'phase';
      phase: 'write' | 'init' | 'plan' | 'apply' | 'destroy' | 'start' | 'stop' | 'image' | 'service';
    }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'info'; message: string }
  | { type: 'warning'; message: string }
  | { type: 'service'; url: string; swaggerUrl: string }
  | { type: 'exit'; code: number; ok: boolean; changes: boolean | null }
  | { type: 'error'; message: string };
