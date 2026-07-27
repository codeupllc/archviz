import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ResourceIcon } from '../icons/ResourceIcon';
import type { ArchvizNode } from './projection';

function Badge({ count, tone }: { count: number; tone: 'error' | 'warning' }) {
  if (count <= 0) return null;
  return (
    <span className={`node-badge node-badge--${tone}`} title={`${count} ${tone}(s)`}>
      {count}
    </span>
  );
}

export const ResourceNode = memo(function ResourceNode({
  data,
  selected,
}: NodeProps<ArchvizNode>) {
  return (
    <div
      className={[
        'resource-node',
        selected ? 'is-selected' : '',
        data.dimmed ? 'is-dimmed' : '',
        data.highlighted ? 'is-highlighted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ borderLeftColor: data.color }}
    >
      {/* Four connection points, one per side. All are type="source": with
          ConnectionMode.Loose any of them can start or end a connection, and
          React Flow resolves an edge's source anchor only from source-typed
          handles. The left handle is rendered first so the other dots (later
          in the DOM) win hit-testing over it while it is stretched into the
          full-node drop zone during a connection drag. */}
      <Handle id="left" type="source" position={Position.Left} className="node-handle" />
      <div className="resource-node__icon" style={{ background: data.color }}>
        <ResourceIcon icon={data.icon} width={20} height={20} />
      </div>
      <div className="resource-node__body">
        <div className="resource-node__label">{data.label}</div>
        <div className="resource-node__type">{data.resourceType.replace(/^aws\//, '')}</div>
      </div>
      <div className="resource-node__badges">
        <Badge count={data.errorCount} tone="error" />
        <Badge count={data.warningCount} tone="warning" />
      </div>
      <Handle id="top" type="source" position={Position.Top} className="node-handle" />
      <Handle id="right" type="source" position={Position.Right} className="node-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="node-handle" />
    </div>
  );
});
