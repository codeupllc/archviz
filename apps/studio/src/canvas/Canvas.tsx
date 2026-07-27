import { useCallback, useMemo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  type Connection,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeChange,
  type EdgeChange,
  type OnConnectStartParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createConstraintEngine, type ArchvizDocument } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import { ResourceNode } from './ResourceNode';
import { ContainerNode } from './ContainerNode';
import { RelationshipEdge } from './RelationshipEdge';
import { documentToFlow } from './projection';
import {
  useDocument,
  useDiagnostics,
  useLastError,
  useSelectedResourceIds,
  useSelectedRelationshipIds,
} from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import { EditorActorContext } from '../state/EditorContext';

const nodeTypes = {
  resourceNode: ResourceNode,
  containerNode: ContainerNode,
};

const edgeTypes = {
  relationshipEdge: RelationshipEdge,
};

/**
 * Relationships are declared directionally on the schema (e.g. only
 * `aws/ecs-service` declares a `connects-to` rule targeting the
 * `network-service` capability — an RDS instance has no matching rule
 * pointing back at an ECS service). Users dragging a connection on the
 * canvas have no way to know which of the two nodes needs to be the drag
 * origin, so we try the relationship in both directions and use whichever
 * one is actually valid. Returns null if neither direction works.
 */
function resolveConnection(
  registry: ResourceRegistry,
  document: ArchvizDocument,
  a: string,
  b: string,
): { sourceId: string; targetId: string; relationship: string } | null {
  const engine = createConstraintEngine(registry);
  const resA = document.resources.find((r) => r.id === a);
  const resB = document.resources.find((r) => r.id === b);
  if (!resA || !resB) return null;

  const forward = registry.possibleRelationships(resA.type, resB.type);
  for (const rel of forward) {
    if (engine.canConnect(a, b, rel, document).ok) {
      return { sourceId: a, targetId: b, relationship: rel };
    }
  }

  const backward = registry.possibleRelationships(resB.type, resA.type);
  for (const rel of backward) {
    if (engine.canConnect(b, a, rel, document).ok) {
      return { sourceId: b, targetId: a, relationship: rel };
    }
  }

  return null;
}

function CanvasInner() {
  const document = useDocument();
  const diagnostics = useDiagnostics();
  const lastError = useLastError();
  const selectedResourceIds = useSelectedResourceIds();
  const selectedRelationshipIds = useSelectedRelationshipIds();
  const { store, registry } = useStudioServices();
  const editorRef = EditorActorContext.useActorRef();
  const { screenToFlowPosition } = useReactFlow();
  const connectingFromId = EditorActorContext.useSelector(
    (s) => s.context.connectingFromId,
  );
  const validTargetIds = EditorActorContext.useSelector((s) => s.context.validTargetIds);
  const feedback = EditorActorContext.useSelector((s) => s.context.feedback);
  const paletteDraggingType = EditorActorContext.useSelector(
    (s) => s.context.paletteDraggingType,
  );
  // Tracks an in-progress drag of an *existing* canvas node (as opposed to a
  // new resource dragged in from the palette) so we can highlight valid
  // re-parent targets the same way palette drags do.
  const [draggingNode, setDraggingNode] = useState<{ id: string; type: string } | null>(null);

  const selectedResourceIdSet = useMemo(
    () => new Set(selectedResourceIds),
    [selectedResourceIds],
  );
  const selectedRelationshipIdSet = useMemo(
    () => new Set(selectedRelationshipIds),
    [selectedRelationshipIds],
  );

  /** All descendant resource ids of `id` (used to prevent cyclical re-parenting). */
  const descendantIds = useCallback(
    (id: string): Set<string> => {
      const ids = new Set<string>();
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of document.resources) {
          if (r.parentId && (r.parentId === id || ids.has(r.parentId)) && !ids.has(r.id)) {
            ids.add(r.id);
            changed = true;
          }
        }
      }
      return ids;
    },
    [document.resources],
  );

  const nodeDropTargets = useMemo(() => {
    if (!draggingNode) return null;
    const excluded = descendantIds(draggingNode.id);
    excluded.add(draggingNode.id);
    const engine = createConstraintEngine(registry);
    const docWithoutNode = {
      ...document,
      resources: document.resources.filter((r) => r.id !== draggingNode.id),
    };
    const validContainerIds = new Set<string>();
    for (const r of document.resources) {
      if (excluded.has(r.id)) continue;
      const rDef = registry.get(r.type);
      if (rDef?.display.kind !== 'container') continue;
      if (engine.canNest(draggingNode.type, r.type, r.id, docWithoutNode).ok) {
        validContainerIds.add(r.id);
      }
    }
    return { validContainerIds };
  }, [draggingNode, registry, document, descendantIds]);

  const paletteDropTargets = useMemo(() => {
    if (!paletteDraggingType || !registry.has(paletteDraggingType)) return null;
    const engine = createConstraintEngine(registry);
    const validContainerIds = new Set<string>();
    for (const r of document.resources) {
      const rDef = registry.get(r.type);
      if (rDef?.display.kind !== 'container') continue;
      if (engine.canNest(paletteDraggingType, r.type, r.id, document).ok) {
        validContainerIds.add(r.id);
      }
    }
    const rootValid = engine.canNest(paletteDraggingType, null, null, document).ok;
    return { validContainerIds, rootValid };
  }, [paletteDraggingType, registry, document]);

  const dimmedIds = useMemo(() => {
    if (connectingFromId) {
      const valid = new Set(validTargetIds);
      valid.add(connectingFromId);
      const dimmed = new Set<string>();
      for (const r of document.resources) {
        if (!valid.has(r.id)) dimmed.add(r.id);
      }
      return dimmed;
    }
    const activeDropTargets = paletteDropTargets ?? nodeDropTargets;
    if (activeDropTargets && activeDropTargets.validContainerIds.size > 0) {
      const dimmed = new Set<string>();
      for (const r of document.resources) {
        const rDef = registry.get(r.type);
        if (rDef?.display.kind === 'container' && !activeDropTargets.validContainerIds.has(r.id)) {
          dimmed.add(r.id);
        }
      }
      return dimmed;
    }
    return undefined;
  }, [
    connectingFromId,
    validTargetIds,
    document.resources,
    paletteDropTargets,
    nodeDropTargets,
    registry,
  ]);

  const highlightedIds = useMemo(() => {
    if (connectingFromId) return new Set(validTargetIds);
    const activeDropTargets = paletteDropTargets ?? nodeDropTargets;
    if (activeDropTargets) return activeDropTargets.validContainerIds;
    return undefined;
  }, [connectingFromId, validTargetIds, paletteDropTargets, nodeDropTargets]);

  const { nodes, edges } = useMemo(
    () =>
      documentToFlow(document, registry, {
        diagnostics,
        dimmedIds,
        highlightedIds,
        selectedResourceIds: selectedResourceIdSet,
        selectedRelationshipIds: selectedRelationshipIdSet,
      }),
    [
      document,
      registry,
      diagnostics,
      dimmedIds,
      highlightedIds,
      selectedResourceIdSet,
      selectedRelationshipIdSet,
    ],
  );

  // A single, unified toast: either a live "feedback" message set by Canvas
  // interactions (e.g. a rejected drop, or an export confirmation) or the
  // store's lastError. Both sources share one dismiss timer so nothing gets
  // stuck on screen forever.
  const toast =
    feedback ??
    (lastError && lastError.length > 0
      ? { message: lastError.map((d) => d.message).join('; '), tone: 'error' as const }
      : null);

  const dismissToast = useCallback(() => {
    editorRef.send({ type: 'CLEAR_FEEDBACK' });
    store.send({ type: 'error.clear' });
  }, [editorRef, store]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, 5500);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  const onNodesChangeLive: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          store.send({
            type: 'resource.move',
            id: change.id,
            layout: { x: change.position.x, y: change.position.y },
            dragging: change.dragging,
          });
        }
        // Persist dimension changes from an active NodeResizer drag
        // (`resizing: true`) *and* from React Flow's own `expandParent`
        // auto-grow (fired, without `resizing`, when a nested child is
        // dragged near/past its parent's current bounds). We used to ignore
        // the latter, but since our `nodes` array is always rebuilt fresh
        // from `document` on every render, an un-persisted expandParent
        // change gets silently reset back to the old (smaller) size on the
        // very next render — which React Flow then immediately tries to
        // re-expand again, forever ("Maximum update depth exceeded") while
        // dragging a child near a container's edge.
        //
        // We guard with a value-equality check (not just `resizing`) so the
        // one-time first-render auto-measurement pass — which now rarely
        // differs from our own `measured` value, but theoretically still
        // could due to CSS — settles after a single update instead of being
        // reapplied every render.
        if (change.type === 'dimensions' && change.dimensions) {
          const resource = document.resources.find((r) => r.id === change.id);
          if (
            resource &&
            (resource.layout.width !== change.dimensions.width ||
              resource.layout.height !== change.dimensions.height)
          ) {
            store.send({
              type: 'resource.move',
              id: change.id,
              layout: {
                x: resource.layout.x,
                y: resource.layout.y,
                width: change.dimensions.width,
                height: change.dimensions.height,
              },
            });
          }
        }
        if (change.type === 'remove') {
          store.send({ type: 'resource.remove', id: change.id });
        }
      }
    },
    [store, document.resources],
  );

  const onEdgesChangeLive: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          store.send({ type: 'connection.remove', id: change.id });
        }
      }
    },
    [store],
  );

  const isValidConnection = useCallback(
    (connection: Connection | { source: string | null; target: string | null }) => {
      if (!connection.source || !connection.target) return false;
      const a = connection.source;
      const b = connection.target;
      // Relationships are directional in the schema (e.g. only ECS Service
      // declares "connects-to" a database, not the other way around), but
      // users can start a drag from either node. Try both orderings so the
      // connection succeeds regardless of which handle was dragged from.
      return resolveConnection(registry, document, a, b) !== null;
    },
    [registry, document],
  );

  const onConnectStart = useCallback(
    (_: unknown, params: OnConnectStartParams) => {
      if (!params.nodeId) return;
      const engine = createConstraintEngine(registry);
      const targets = engine.validTargetsFor(params.nodeId, undefined, document);
      editorRef.send({
        type: 'CONNECT_START',
        sourceId: params.nodeId,
        validTargetIds: targets.map((t) => t.resourceId),
      });
    },
    [editorRef, registry, document],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const source = document.resources.find((r) => r.id === connection.source);
      const target = document.resources.find((r) => r.id === connection.target);
      if (!source || !target) return;

      // Whichever node the drag actually started/ended on, figure out which
      // direction the relationship is valid in (it's often only valid one
      // way, e.g. ECS Service -> RDS, not RDS -> ECS Service).
      const resolved = resolveConnection(registry, document, source.id, target.id);
      if (!resolved) {
        editorRef.send({
          type: 'SET_FEEDBACK',
          message: `No valid connection between ${source.type} and ${target.type}`,
        });
        editorRef.send({ type: 'CONNECT_CANCEL' });
        return;
      }

      // Keep the edge anchored to the connection points the user actually
      // used. If the logical direction got flipped (resolved source is the
      // node the drag *ended* on), the handles swap along with it.
      const flipped = resolved.sourceId !== connection.source;
      store.send({
        type: 'connection.add',
        sourceId: resolved.sourceId,
        targetId: resolved.targetId,
        relationship: resolved.relationship,
        sourceHandle: (flipped ? connection.targetHandle : connection.sourceHandle) ?? undefined,
        targetHandle: (flipped ? connection.sourceHandle : connection.targetHandle) ?? undefined,
      });
      editorRef.send({ type: 'CONNECT_END' });
    },
    [document, registry, store, editorRef],
  );

  const onConnectEnd = useCallback(() => {
    editorRef.send({ type: 'CONNECT_CANCEL' });
  }, [editorRef]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const ids = selectedNodes.map((n) => n.id);
      const edgeIds = selectedEdges.map((e) => e.id);
      store.send({ type: 'selection.set', ids, edgeIds });
      editorRef.send({
        type: 'SELECT',
        resourceId: ids[0] ?? null,
      });
    },
    [store, editorRef],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const absoluteLayout = useCallback(
    (id: string): { x: number; y: number; width: number; height: number } => {
      const resource = document.resources.find((r) => r.id === id);
      if (!resource) return { x: 0, y: 0, width: 0, height: 0 };
      let x = resource.layout.x;
      let y = resource.layout.y;
      let parentId = resource.parentId;
      while (parentId) {
        const parent = document.resources.find((r) => r.id === parentId);
        if (!parent) break;
        x += parent.layout.x;
        y += parent.layout.y;
        parentId = parent.parentId;
      }
      return {
        x,
        y,
        width: resource.layout.width ?? 400,
        height: resource.layout.height ?? 280,
      };
    },
    [document.resources],
  );

  const onNodeDragStart = useCallback(
    (_event: unknown, node: Node) => {
      const resource = document.resources.find((r) => r.id === node.id);
      if (resource) setDraggingNode({ id: node.id, type: resource.type });
    },
    [document.resources],
  );

  // Dropping an existing node onto/into a container re-parents it, mirroring
  // how dragging a brand-new resource in from the palette works. Without
  // this, visually stacking e.g. a Subnet on top of a VPC just overlaps two
  // unrelated boxes rather than actually nesting one inside the other.
  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setDraggingNode(null);
      const resource = document.resources.find((r) => r.id === node.id);
      if (!resource) return;

      const abs = absoluteLayout(node.id);
      const centerX = abs.x + abs.width / 2;
      const centerY = abs.y + abs.height / 2;
      const excluded = descendantIds(node.id);
      excluded.add(node.id);

      const engine = createConstraintEngine(registry);
      const docWithoutNode = {
        ...document,
        resources: document.resources.filter((r) => r.id !== node.id),
      };

      let bestParentId: string | null = null;
      let bestParentAbs: { x: number; y: number } | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      for (const r of document.resources) {
        if (excluded.has(r.id)) continue;
        const rDef = registry.get(r.type);
        if (rDef?.display.kind !== 'container') continue;
        const rAbs = absoluteLayout(r.id);
        if (
          centerX < rAbs.x ||
          centerX > rAbs.x + rAbs.width ||
          centerY < rAbs.y ||
          centerY > rAbs.y + rAbs.height
        ) {
          continue;
        }
        if (!engine.canNest(resource.type, r.type, r.id, docWithoutNode).ok) continue;
        const area = rAbs.width * rAbs.height;
        if (area < bestArea) {
          bestArea = area;
          bestParentId = r.id;
          bestParentAbs = rAbs;
        }
      }

      if (bestParentId === (resource.parentId ?? null)) return;

      store.send({
        type: 'resource.reparent',
        id: node.id,
        parentId: bestParentId,
        layout: {
          x: bestParentAbs ? abs.x - bestParentAbs.x : abs.x,
          y: bestParentAbs ? abs.y - bestParentAbs.y : abs.y,
        },
      });
    },
    [document, registry, store, absoluteLayout, descendantIds],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/archviz-resource');
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const def = registry.get(type);
      if (!def) return;

      let parentId: string | null = null;
      let parentAbs: { x: number; y: number } | null = null;
      let bestArea = Number.POSITIVE_INFINITY;

      for (const r of document.resources) {
        const rDef = registry.get(r.type);
        if (rDef?.display.kind !== 'container') continue;
        const abs = absoluteLayout(r.id);
        if (
          position.x >= abs.x &&
          position.x <= abs.x + abs.width &&
          position.y >= abs.y &&
          position.y <= abs.y + abs.height
        ) {
          const area = abs.width * abs.height;
          if (area < bestArea) {
            bestArea = area;
            parentId = r.id;
            parentAbs = abs;
          }
        }
      }

      const parent = parentId
        ? document.resources.find((r) => r.id === parentId)
        : null;
      const engine = createConstraintEngine(registry);
      const nest = engine.canNest(
        type,
        parent?.type ?? null,
        parent?.id ?? null,
        document,
      );
      if (!nest.ok) {
        editorRef.send({
          type: 'SET_FEEDBACK',
          message: nest.diagnostics.map((d) => d.message).join('; '),
        });
        return;
      }

      store.send({
        type: 'resource.add',
        resourceType: type,
        parentId,
        layout: {
          x: parentAbs ? position.x - parentAbs.x : position.x,
          y: parentAbs ? position.y - parentAbs.y : position.y,
        },
      });
    },
    [document, registry, store, editorRef, screenToFlowPosition, absoluteLayout],
  );

  return (
    <div
      // `is-connecting` turns every node into a full-size drop target (via
      // CSS on the target handle) for the duration of a connection drag —
      // otherwise users have to release exactly on the tiny 9px handle dot,
      // which reads as "connections don't work".
      className={`canvas-root${connectingFromId ? ' is-connecting' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {toast && (
        <div className={`canvas-toast canvas-toast--${toast.tone}`} role="status">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            {toast.tone === 'error' ? (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
              </>
            ) : (
              <path d="M4.5 12.5 9.5 17.5 19.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          <span className="canvas-toast__message">{toast.message}</span>
          <button
            type="button"
            className="canvas-toast__dismiss"
            onClick={dismissToast}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {document.resources.length === 0 && (
        <div className="canvas-empty-hint">
          <div className="canvas-empty-hint__arrow" aria-hidden="true">
            ←
          </div>
          <div>
            <strong>Start with a VPC.</strong>
            <br />
            Drag it in from the panel on the left — most other resources need
            one to live in.
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChangeLive}
        onEdgesChange={onEdgesChangeLive}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onSelectionChange={onSelectionChange}
        // Loose mode lets a drag start or end on either handle (source or
        // target); combined with resolveConnection() trying both directions,
        // users never have to care which side of which node they grab.
        connectionMode={ConnectionMode.Loose}
        // Snap the in-progress connection line to a handle well before the
        // pointer is exactly on top of it.
        connectionRadius={48}
        fitView
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color="#e2e8f0" />
        <Controls />
        <MiniMap zoomable pannable />
      </ReactFlow>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
