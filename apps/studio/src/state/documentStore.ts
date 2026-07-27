import { createStore } from '@xstate/store';
import {
  createEmptyDocument,
  createConstraintEngine,
  normalizeDocument,
  touchDocument,
  type ArchvizDocument,
  type ResourceInstance,
  type RelationshipInstance,
  type ConstraintResult,
  type Diagnostic,
} from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import { computeAutoLayout } from './autoLayout';

export interface HistoryEntry {
  document: ArchvizDocument;
  selectedResourceIds: string[];
}

export interface DocumentStoreContext {
  document: ArchvizDocument;
  selectedResourceIds: string[];
  selectedRelationshipIds: string[];
  lastError: Diagnostic[] | null;
  diagnostics: Diagnostic[];
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  /**
   * Identifies the current "editing gesture" (e.g. `rename:res-1` or
   * `move:res-2`). Consecutive mutations that share a signature are
   * coalesced into a single history entry so that e.g. typing a whole
   * resource name, or dragging a node across the canvas, becomes one undo
   * step instead of one per keystroke/pixel.
   */
  editSignature: string | null;
}

const MAX_HISTORY = 100;

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function revalidate(
  document: ArchvizDocument,
  registry: ResourceRegistry,
): Diagnostic[] {
  return createConstraintEngine(registry).validate(document).diagnostics;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function snapshot(ctx: DocumentStoreContext): HistoryEntry {
  return { document: ctx.document, selectedResourceIds: ctx.selectedResourceIds };
}

/** Always pushes a fresh history checkpoint (used for structural changes). */
function checkpoint(
  ctx: DocumentStoreContext,
): Pick<DocumentStoreContext, 'history' | 'editSignature'> {
  const past = [...ctx.history.past, snapshot(ctx)].slice(-MAX_HISTORY);
  return { history: { past, future: [] }, editSignature: null };
}

/**
 * Pushes a history checkpoint only if `signature` differs from the last one
 * (used for continuous edits like typing or dragging, so they coalesce).
 */
function coalescedCheckpoint(
  ctx: DocumentStoreContext,
  signature: string,
): Pick<DocumentStoreContext, 'history' | 'editSignature'> {
  if (ctx.editSignature === signature) {
    return { history: ctx.history, editSignature: signature };
  }
  const past = [...ctx.history.past, snapshot(ctx)].slice(-MAX_HISTORY);
  return { history: { past, future: [] }, editSignature: signature };
}

export function createDocumentStore(registry: ResourceRegistry, initial?: ArchvizDocument) {
  const engine = createConstraintEngine(registry);
  const document = normalizeDocument(initial ?? createEmptyDocument(), registry);

  return createStore({
    context: {
      document,
      selectedResourceIds: [] as string[],
      selectedRelationshipIds: [] as string[],
      lastError: null as Diagnostic[] | null,
      diagnostics: revalidate(document, registry),
      history: { past: [], future: [] } as { past: HistoryEntry[]; future: HistoryEntry[] },
      editSignature: null as string | null,
    } satisfies DocumentStoreContext,
    on: {
      'document.load': (ctx, event: { document: ArchvizDocument }) => {
        // Diagrams saved before a resource gained a property need those
        // defaults backfilled, or they'd load with spurious validation errors.
        const doc = normalizeDocument(event.document, registry);
        return {
          ...ctx,
          document: doc,
          selectedResourceIds: [],
          selectedRelationshipIds: [],
          lastError: null,
          diagnostics: revalidate(doc, registry),
          history: { past: [], future: [] },
          editSignature: null,
        };
      },

      'document.rename': (ctx, event: { name: string }) => {
        const signature = 'document-rename';
        const { history, editSignature } = coalescedCheckpoint(ctx, signature);
        const document = touchDocument({
          ...ctx.document,
          meta: { ...ctx.document.meta, name: event.name },
        });
        return { ...ctx, document, history, editSignature };
      },

      'resource.add': (
        ctx,
        event: {
          resourceType: string;
          name?: string;
          parentId?: string | null;
          layout: { x: number; y: number; width?: number; height?: number };
          properties?: Record<string, unknown>;
        },
      ) => {
        const def = registry.get(event.resourceType);
        if (!def) {
          return {
            ...ctx,
            lastError: [
              {
                code: 'unknown-type',
                message: `Unknown type ${event.resourceType}`,
                severity: 'error' as const,
                tier: 'structural' as const,
              },
            ],
          };
        }

        const parent = event.parentId
          ? ctx.document.resources.find((r) => r.id === event.parentId)
          : null;
        const nest = engine.canNest(
          event.resourceType,
          parent?.type ?? null,
          parent?.id ?? null,
          ctx.document,
        );
        if (!nest.ok) {
          return { ...ctx, lastError: nest.diagnostics };
        }

        const defaults: Record<string, unknown> = {};
        for (const p of def.properties) {
          if (p.default !== undefined) defaults[p.name] = p.default;
        }

        // Nested containers default smaller than root-level ones so a fresh
        // Subnet doesn't blanket its parent VPC edge-to-edge; `expandParent`
        // (set at the React Flow projection layer) still grows the parent if
        // the user drags/resizes past its bounds.
        const isNestedContainer = def.display.kind === 'container' && Boolean(parent);
        const defaultWidth =
          def.display.kind === 'container' ? (isNestedContainer ? 260 : 400) : 160;
        const defaultHeight =
          def.display.kind === 'container' ? (isNestedContainer ? 160 : 280) : 80;

        const resource: ResourceInstance = {
          id: newId('res'),
          type: event.resourceType,
          name: event.name ?? `${def.display.label}-${ctx.document.resources.length + 1}`,
          properties: { ...defaults, ...event.properties },
          parentId: event.parentId ?? null,
          layout: {
            x: event.layout.x,
            y: event.layout.y,
            width: event.layout.width ?? defaultWidth,
            height: event.layout.height ?? defaultHeight,
          },
        };

        const document = touchDocument({
          ...ctx.document,
          resources: [...ctx.document.resources, resource],
        });

        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
          selectedResourceIds: [resource.id],
          selectedRelationshipIds: [],
          diagnostics: revalidate(document, registry),
        };
      },

      'resource.remove': (ctx, event: { id: string }) => {
        if (!ctx.document.resources.some((r) => r.id === event.id)) return ctx;

        const toRemove = new Set<string>([event.id]);
        // Cascade-remove descendants
        let changed = true;
        while (changed) {
          changed = false;
          for (const r of ctx.document.resources) {
            if (r.parentId && toRemove.has(r.parentId) && !toRemove.has(r.id)) {
              toRemove.add(r.id);
              changed = true;
            }
          }
        }

        const removedRelIds = new Set(
          ctx.document.relationships
            .filter((rel) => toRemove.has(rel.sourceId) || toRemove.has(rel.targetId))
            .map((rel) => rel.id),
        );

        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.filter((r) => !toRemove.has(r.id)),
          relationships: ctx.document.relationships.filter((rel) => !removedRelIds.has(rel.id)),
        });

        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          selectedResourceIds: ctx.selectedResourceIds.filter((id) => !toRemove.has(id)),
          selectedRelationshipIds: ctx.selectedRelationshipIds.filter(
            (id) => !removedRelIds.has(id),
          ),
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'resource.move': (
        ctx,
        event: {
          id: string;
          layout: { x: number; y: number; width?: number; height?: number };
          /** True while an interactive drag/resize gesture is in progress. */
          dragging?: boolean;
        },
      ) => {
        const signature = `move:${event.id}`;
        const { history, editSignature } = coalescedCheckpoint(ctx, signature);

        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) =>
            r.id === event.id
              ? {
                  ...r,
                  layout: {
                    ...r.layout,
                    ...event.layout,
                  },
                }
              : r,
          ),
        });
        return {
          ...ctx,
          document,
          lastError: null,
          history,
          // Close the gesture once the drag/resize ends so the *next* one
          // starts a fresh undo step instead of merging with this one.
          editSignature: event.dragging === false ? null : editSignature,
        };
      },

      'resource.reparent': (
        ctx,
        event: { id: string; parentId: string | null; layout?: { x: number; y: number } },
      ) => {
        const resource = ctx.document.resources.find((r) => r.id === event.id);
        if (!resource) return ctx;

        const parent = event.parentId
          ? ctx.document.resources.find((r) => r.id === event.parentId)
          : null;

        const nest = engine.canNest(
          resource.type,
          parent?.type ?? null,
          parent?.id ?? null,
          {
            ...ctx.document,
            resources: ctx.document.resources.filter((r) => r.id !== event.id),
          },
        );
        if (!nest.ok) {
          return { ...ctx, lastError: nest.diagnostics };
        }

        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) =>
            r.id === event.id
              ? {
                  ...r,
                  parentId: event.parentId,
                  layout: event.layout
                    ? { ...r.layout, x: event.layout.x, y: event.layout.y }
                    : r.layout,
                }
              : r,
          ),
        });

        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'resource.rename': (ctx, event: { id: string; name: string }) => {
        const signature = `rename:${event.id}`;
        const { history, editSignature } = coalescedCheckpoint(ctx, signature);
        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) =>
            r.id === event.id ? { ...r, name: event.name } : r,
          ),
        });
        return {
          ...ctx,
          document,
          history,
          editSignature,
          diagnostics: revalidate(document, registry),
        };
      },

      'property.update': (
        ctx,
        event: { id: string; property: string; value: unknown },
      ) => {
        const signature = `property:${event.id}:${event.property}`;
        const { history, editSignature } = coalescedCheckpoint(ctx, signature);
        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) =>
            r.id === event.id
              ? {
                  ...r,
                  properties: { ...r.properties, [event.property]: event.value },
                }
              : r,
          ),
        });
        return {
          ...ctx,
          document,
          history,
          editSignature,
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'variable.set': (
        ctx,
        event: { id: string; property: string; varName: string | null },
      ) => {
        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) => {
            if (r.id !== event.id) return r;
            const bindings = { ...r.variableBindings };
            if (event.varName) {
              bindings[event.property] = event.varName;
            } else {
              delete bindings[event.property];
            }
            return { ...r, variableBindings: bindings };
          }),
        });
        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'resource.setServiceGroup': (
        ctx,
        event: { id: string; serviceGroup: string | null },
      ) => {
        const signature = `service-group:${event.id}`;
        const { history, editSignature } = coalescedCheckpoint(ctx, signature);
        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) =>
            r.id === event.id ? { ...r, serviceGroup: event.serviceGroup || null } : r,
          ),
        });
        return {
          ...ctx,
          document,
          history,
          editSignature,
          diagnostics: revalidate(document, registry),
        };
      },

      /** Closes the current coalescing gesture (e.g. on input blur) without mutating the document. */
      'history.checkpoint': (ctx) => ({ ...ctx, editSignature: null }),

      'history.undo': (ctx) => {
        if (ctx.history.past.length === 0) return ctx;
        const previous = ctx.history.past[ctx.history.past.length - 1]!;
        const past = ctx.history.past.slice(0, -1);
        const future = [snapshot(ctx), ...ctx.history.future].slice(0, MAX_HISTORY);
        const validIds = new Set(previous.document.resources.map((r) => r.id));
        return {
          ...ctx,
          document: previous.document,
          selectedResourceIds: previous.selectedResourceIds.filter((id) => validIds.has(id)),
          selectedRelationshipIds: [],
          lastError: null,
          diagnostics: revalidate(previous.document, registry),
          history: { past, future },
          editSignature: null,
        };
      },

      'history.redo': (ctx) => {
        if (ctx.history.future.length === 0) return ctx;
        const next = ctx.history.future[0]!;
        const future = ctx.history.future.slice(1);
        const past = [...ctx.history.past, snapshot(ctx)].slice(-MAX_HISTORY);
        const validIds = new Set(next.document.resources.map((r) => r.id));
        return {
          ...ctx,
          document: next.document,
          selectedResourceIds: next.selectedResourceIds.filter((id) => validIds.has(id)),
          selectedRelationshipIds: [],
          lastError: null,
          diagnostics: revalidate(next.document, registry),
          history: { past, future },
          editSignature: null,
        };
      },

      'connection.add': (
        ctx,
        event: {
          sourceId: string;
          targetId: string;
          relationship: string;
          sourceHandle?: string;
          targetHandle?: string;
        },
      ) => {
        const result: ConstraintResult = engine.canConnect(
          event.sourceId,
          event.targetId,
          event.relationship,
          ctx.document,
        );
        if (!result.ok) {
          return { ...ctx, lastError: result.diagnostics };
        }

        const relationship: RelationshipInstance = {
          id: newId('rel'),
          relationship: event.relationship,
          sourceId: event.sourceId,
          targetId: event.targetId,
          sourceHandle: event.sourceHandle,
          targetHandle: event.targetHandle,
        };

        const document = touchDocument({
          ...ctx.document,
          relationships: [...ctx.document.relationships, relationship],
        });

        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'layout.autoArrange': (ctx) => {
        if (ctx.document.resources.length === 0) return ctx;
        const layouts = computeAutoLayout(ctx.document, registry);
        const document = touchDocument({
          ...ctx.document,
          resources: ctx.document.resources.map((r) => {
            const layout = layouts[r.id];
            return layout ? { ...r, layout } : r;
          }),
        });
        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
        };
      },

      'connection.remove': (ctx, event: { id: string }) => {
        if (!ctx.document.relationships.some((r) => r.id === event.id)) return ctx;
        const document = touchDocument({
          ...ctx.document,
          relationships: ctx.document.relationships.filter((r) => r.id !== event.id),
        });
        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          selectedRelationshipIds: ctx.selectedRelationshipIds.filter((id) => id !== event.id),
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'connection.setRelationship': (ctx, event: { id: string; relationship: string }) => {
        const existing = ctx.document.relationships.find((r) => r.id === event.id);
        if (!existing) return ctx;
        if (existing.relationship === event.relationship) return ctx;

        const withoutCurrent = {
          ...ctx.document,
          relationships: ctx.document.relationships.filter((r) => r.id !== event.id),
        };
        const result: ConstraintResult = engine.canConnect(
          existing.sourceId,
          existing.targetId,
          event.relationship,
          withoutCurrent,
        );
        if (!result.ok) {
          return { ...ctx, lastError: result.diagnostics };
        }

        const document = touchDocument({
          ...ctx.document,
          relationships: ctx.document.relationships.map((r) =>
            r.id === event.id ? { ...r, relationship: event.relationship } : r,
          ),
        });

        return {
          ...ctx,
          ...checkpoint(ctx),
          document,
          lastError: null,
          diagnostics: revalidate(document, registry),
        };
      },

      'selection.set': (ctx, event: { ids: string[]; edgeIds?: string[] }) => {
        const edgeIds = event.edgeIds ?? [];
        // React Flow's SelectionListener re-fires onSelectionChange with a
        // freshly-computed (but often content-identical) array on *every*
        // store update, not just real selection changes — including every
        // frame of a node drag. If we always replaced these arrays with new
        // references, that would ripple into `nodes`/`edges` being rebuilt,
        // which feeds back into React Flow's store and re-triggers
        // onSelectionChange again, forever ("Maximum update depth exceeded").
        // Bailing out (returning the same arrays) when nothing actually
        // changed breaks that cycle.
        if (
          sameIds(ctx.selectedResourceIds, event.ids) &&
          sameIds(ctx.selectedRelationshipIds, edgeIds)
        ) {
          return ctx;
        }
        return {
          ...ctx,
          selectedResourceIds: event.ids,
          selectedRelationshipIds: edgeIds,
          // Leaving a field/resource to change selection should close whatever
          // edit gesture was in progress, so the next edit is a new undo step.
          editSignature: null,
        };
      },

      'error.clear': (ctx) => ({ ...ctx, lastError: null }),
    },
  });
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;
