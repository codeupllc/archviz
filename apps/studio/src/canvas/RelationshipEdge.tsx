import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useStudioServices } from '../state/StudioServices';
import type { ArchvizEdge } from './projection';

/**
 * Custom edge with a hover/selected "×" delete button. When more than one
 * relationship kind is valid between the endpoints (e.g. Reads from /
 * Writes to → SQS), clicking the label cycles the kind — which swaps the
 * generated IAM policy without a separate Policy node.
 */
export const RelationshipEdge = memo(function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  selected,
  data,
}: EdgeProps<ArchvizEdge>) {
  const { store } = useStudioServices();
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    // Multiple relationships between the same pair of nodes (or converging
    // on the same handle) would otherwise draw exactly on top of one
    // another — each edge gets a distinct offset so they fan out.
    offset: data?.offset ?? 20,
    borderRadius: 8,
  });

  const alternatives = data?.alternatives ?? [];
  const canCycle = alternatives.length > 1;
  const current = data?.relationship;

  const cycleRelationship = () => {
    if (!canCycle || !current) return;
    const idx = alternatives.findIndex((a) => a.relationship === current);
    const next = alternatives[(idx + 1) % alternatives.length];
    if (!next || next.relationship === current) return;
    store.send({ type: 'connection.setRelationship', id, relationship: next.relationship });
  };

  const cycleHint = canCycle
    ? selected
      ? `Click to switch (${alternatives.map((a) => a.label).join(' → ')})`
      : `Select, then click again to switch (${alternatives.map((a) => a.label).join(' / ')})`
    : undefined;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={`relationship-edge__label ${selected ? 'is-selected' : ''} ${canCycle ? 'is-cyclable' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          title={cycleHint}
          // The label lives in a portal outside the SVG edge, so clicking it
          // doesn't select the edge by itself — wire it up explicitly to make
          // the label the edge's primary click target (it's much easier to
          // hit than the 1px line).
          onClick={(e) => {
            e.stopPropagation();
            // First click selects; further clicks cycle when multiple kinds exist.
            if (selected && canCycle) {
              cycleRelationship();
            } else {
              store.send({ type: 'selection.set', ids: [], edgeIds: [id] });
            }
          }}
        >
          {label && (
            <span className="relationship-edge__text">
              {label}
              {canCycle ? <span className="relationship-edge__cycle-hint" aria-hidden>⇄</span> : null}
            </span>
          )}
          <button
            type="button"
            className="relationship-edge__delete"
            title="Delete this connection"
            onClick={(e) => {
              e.stopPropagation();
              store.send({ type: 'connection.remove', id });
            }}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
