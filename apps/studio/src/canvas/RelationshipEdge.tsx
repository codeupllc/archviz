import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useStudioServices } from '../state/StudioServices';
import type { ArchvizEdge } from './projection';

/**
 * Custom edge with a hover/selected "×" delete button. React Flow already
 * supports deleting a selected edge via Backspace/Delete, but that's not
 * discoverable — this makes removing a connection a visible, one-click
 * action instead.
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

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={`relationship-edge__label ${selected ? 'is-selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          // The label lives in a portal outside the SVG edge, so clicking it
          // doesn't select the edge by itself — wire it up explicitly to make
          // the label the edge's primary click target (it's much easier to
          // hit than the 1px line).
          onClick={(e) => {
            e.stopPropagation();
            store.send({ type: 'selection.set', ids: [], edgeIds: [id] });
          }}
        >
          {label && <span className="relationship-edge__text">{label}</span>}
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
