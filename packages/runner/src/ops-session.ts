import type { PlanEvent } from './plan-events.js';

export type { PlanEvent } from './plan-events.js';
export type OpKind = 'plan' | 'apply' | 'destroy' | 'start' | 'stop';

export interface OpsSnapshot {
  busy: boolean;
  kind: OpKind | null;
  startedAt: string | null;
  /** Buffered NDJSON events for the current (or just-finished) operation. */
  events: PlanEvent[];
}

const DEFAULT_MAX_EVENTS = 8_000;

/**
 * Tracks the in-flight terraform/LocalStack operation so Studio can reattach
 * after a browser refresh and still see logs.
 */
export function createOpsSession(maxEvents = DEFAULT_MAX_EVENTS) {
  let busy = false;
  let kind: OpKind | null = null;
  let startedAt: string | null = null;
  let events: PlanEvent[] = [];
  const listeners = new Set<(event: PlanEvent) => void>();

  function begin(next: OpKind): boolean {
    if (busy) return false;
    busy = true;
    kind = next;
    startedAt = new Date().toISOString();
    events = [];
    return true;
  }

  function emit(event: PlanEvent): void {
    events.push(event);
    if (events.length > maxEvents) {
      events = events.slice(events.length - maxEvents);
    }
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* subscriber write failures must not break the op */
      }
    }
  }

  function end(): void {
    busy = false;
  }

  function snapshot(): OpsSnapshot {
    return {
      busy,
      kind,
      startedAt,
      events: events.slice(),
    };
  }

  function subscribe(listener: (event: PlanEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    begin,
    emit,
    end,
    snapshot,
    subscribe,
    get busy() {
      return busy;
    },
  };
}

export type OpsSession = ReturnType<typeof createOpsSession>;
