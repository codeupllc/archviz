import type { Node, Edge } from '@xyflow/react';
import type { ArchvizDocument, Diagnostic } from '@archviz/core';
import type { ResourceRegistry } from '@archviz/schema';
import { CATEGORY_COLORS } from '@archviz/provider-aws';
import {
  displayLabelForRelationship,
  relationshipOptionsFor,
} from './relationshipOptions';

export type ArchvizNodeData = {
  resourceId: string;
  resourceType: string;
  label: string;
  category: string;
  kind: 'node' | 'container';
  color: string;
  icon: string;
  dimmed: boolean;
  highlighted: boolean;
  errorCount: number;
  warningCount: number;
  overlays?: unknown;
};

export type ArchvizNode = Node<ArchvizNodeData>;
export type ArchvizEdgeData = {
  offset: number;
  /** Schema relationship id, e.g. reads-from / writes-to. */
  relationship: string;
  /** Other valid kinds for this endpoint pair (includes current). */
  alternatives: Array<{ relationship: string; label: string }>;
};
export type ArchvizEdge = Edge<ArchvizEdgeData>;

export function documentToFlow(
  document: ArchvizDocument,
  registry: ResourceRegistry,
  opts: {
    diagnostics?: Diagnostic[];
    dimmedIds?: Set<string>;
    highlightedIds?: Set<string>;
    selectedResourceIds?: Set<string>;
    selectedRelationshipIds?: Set<string>;
  } = {},
): { nodes: ArchvizNode[]; edges: ArchvizEdge[] } {
  const diagByResource = new Map<string, Diagnostic[]>();
  for (const d of opts.diagnostics ?? []) {
    if (!d.resourceId) continue;
    const list = diagByResource.get(d.resourceId) ?? [];
    list.push(d);
    diagByResource.set(d.resourceId, list);
  }

  // Parents before children for React Flow nesting
  const sorted = [...document.resources].sort((a, b) => {
    const depth = (id: string | null | undefined, seen = new Set<string>()): number => {
      if (!id || seen.has(id)) return 0;
      seen.add(id);
      const r = document.resources.find((x) => x.id === id);
      return r?.parentId ? 1 + depth(r.parentId, seen) : 0;
    };
    return depth(a.parentId) - depth(b.parentId);
  });

  const nodes: ArchvizNode[] = sorted.map((resource) => {
    const def = registry.get(resource.type);
    const kind = def?.display.kind ?? 'node';
    const category = def?.display.category ?? 'management';
    const diags = diagByResource.get(resource.id) ?? [];
    const errorCount = diags.filter((d) => d.severity === 'error').length;
    const warningCount = diags.filter((d) => d.severity === 'warning').length;
    const width = resource.layout.width ?? (kind === 'container' ? 400 : 160);
    const height = resource.layout.height ?? (kind === 'container' ? 280 : 80);

    return {
      id: resource.id,
      type: kind === 'container' ? 'containerNode' : 'resourceNode',
      position: { x: resource.layout.x, y: resource.layout.y },
      parentId: resource.parentId ?? undefined,
      extent: resource.parentId ? ('parent' as const) : undefined,
      // Lets a parent container auto-grow if a child is dragged/resized past
      // its current bounds, instead of the child visually overflowing it.
      expandParent: resource.parentId ? true : undefined,
      // React Flow is fully controlled here, so selection state must be fed
      // back in via the `nodes` prop — otherwise every unrelated document
      // change (e.g. a keystroke elsewhere) redraws the node array without
      // `selected: true` and React Flow silently drops the selection.
      selected: opts.selectedResourceIds?.has(resource.id) ?? false,
      width,
      height,
      style: { width, height },
      // React Flow only considers a node "initialized" once it has a
      // `measured.width`/`height` — normally populated asynchronously by its
      // own ResizeObserver after the DOM node mounts. Since this projection
      // rebuilds fresh node objects on every document change (any move,
      // selection, diagnostics update, etc.), and `measured` isn't derived
      // from the top-level `width`/`height` we set above, React Flow was
      // wiping the previously-measured size back to `undefined` on almost
      // every render. Dragging a node while it's momentarily "uninitialized"
      // logs error #015 and, because position math for it comes back
      // `NaN`/wrong, can cascade into a render loop. Providing `measured`
      // ourselves (we already know the real size from `layout`) keeps it
      // permanently initialized regardless of how often this array is
      // rebuilt.
      measured: { width, height },
      data: {
        resourceId: resource.id,
        resourceType: resource.type,
        label: resource.name,
        category,
        kind,
        color: CATEGORY_COLORS[category] ?? '#64748b',
        icon: def?.display.icon ?? '?',
        dimmed: opts.dimmedIds?.has(resource.id) ?? false,
        highlighted: opts.highlightedIds?.has(resource.id) ?? false,
        errorCount,
        warningCount,
      },
    };
  });

  // Every node has exactly one source handle and one target handle, so
  // multiple relationships converging on the same node/handle would
  // otherwise be drawn stacked directly on top of each other. Give each one
  // a slightly different step-path offset so they fan out and stay visually
  // distinguishable.
  const edgeIndexByEndpoints = new Map<string, number>();
  const edges: ArchvizEdge[] = document.relationships.map((rel) => {
    const key = `${rel.sourceId}->${rel.targetId}`;
    const index = edgeIndexByEndpoints.get(key) ?? 0;
    edgeIndexByEndpoints.set(key, index + 1);
    const alternatives = relationshipOptionsFor(registry, document, rel);

    return {
      id: rel.id,
      source: rel.sourceId,
      target: rel.targetId,
      // Anchor to the connection points the user drew between; older
      // documents without stored handles keep the classic right -> left.
      sourceHandle: rel.sourceHandle ?? 'right',
      targetHandle: rel.targetHandle ?? 'left',
      label: displayLabelForRelationship(registry, document, rel),
      type: 'relationshipEdge',
      data: {
        offset: 12 + index * 14,
        relationship: rel.relationship,
        alternatives,
      },
      animated: rel.relationship === 'connects-to',
      selected: opts.selectedRelationshipIds?.has(rel.id) ?? false,
      style: { stroke: '#64748b' },
      labelStyle: { fontSize: 10, fill: '#64748b' },
    };
  });

  return { nodes, edges };
}
