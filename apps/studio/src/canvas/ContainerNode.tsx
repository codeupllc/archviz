import { memo } from 'react';
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import { ResourceIcon } from '../icons/ResourceIcon';
import type { ArchvizNode } from './projection';

export const ContainerNode = memo(function ContainerNode({
  data,
  selected,
}: NodeProps<ArchvizNode>) {
  return (
    <div
      className={[
        'container-node',
        selected ? 'is-selected' : '',
        data.dimmed ? 'is-dimmed' : '',
        data.highlighted ? 'is-highlighted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ borderColor: data.color }}
    >
      <NodeResizer
        minWidth={240}
        minHeight={160}
        isVisible={selected}
        lineStyle={{ borderColor: data.color }}
        handleStyle={{ background: data.color }}
      />
      {/* Same four-way connection points as ResourceNode (see comment there
          for why they're all type="source" and why left comes first). */}
      <Handle id="left" type="source" position={Position.Left} className="node-handle" />
      <div className="container-node__header">
        <span
          className="container-node__icon"
          style={{ background: data.color }}
        >
          <ResourceIcon icon={data.icon} width={14} height={14} />
        </span>
        <span className="container-node__title" style={{ color: data.color }}>
          {data.label}
        </span>
        <span className="container-node__type">{data.resourceType.replace(/^aws\//, '')}</span>
        {data.errorCount > 0 && (
          <span className="node-badge node-badge--error">{data.errorCount}</span>
        )}
      </div>
      <Handle id="top" type="source" position={Position.Top} className="node-handle" />
      <Handle id="right" type="source" position={Position.Right} className="node-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="node-handle" />
    </div>
  );
});
