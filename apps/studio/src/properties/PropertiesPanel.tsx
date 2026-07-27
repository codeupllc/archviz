import {
  useDocument,
  useSelectedResourceIds,
  useSelectedRelationshipIds,
  useDiagnostics,
} from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import type { PropertyDefinition } from '@archviz/schema';

function sanitizeVarName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'value';
}

/** Small "promote to variable" toggle shown next to any field's label. */
function VariableToggle({
  varName,
  onToggle,
}: {
  varName: string | undefined;
  onToggle: (varName: string | null) => void;
}) {
  if (varName) {
    return (
      <button
        type="button"
        className="var-toggle var-toggle--active"
        title={`Bound to var.${varName} — click to inline the value again`}
        onClick={() => onToggle(null)}
      >
        var.{varName} ×
      </button>
    );
  }
  return (
    <button
      type="button"
      className="var-toggle"
      title="Promote this value to a Terraform variable"
      onClick={() => {
        const suggested = window.prompt('Variable name (no var. prefix):');
        if (suggested === null) return;
        onToggle(sanitizeVarName(suggested));
      }}
    >
      → var
    </button>
  );
}

function Field({
  prop,
  value,
  onChange,
  onCommit,
  hasError,
  varName,
  onToggleVariable,
}: {
  prop: PropertyDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  onCommit: () => void;
  hasError: boolean;
  varName?: string;
  onToggleVariable: (varName: string | null) => void;
}) {
  const label = prop.label ?? prop.name;
  const id = `prop-${prop.name}`;
  const isBound = Boolean(varName);

  if (prop.type === 'boolean') {
    return (
      <label className="prop-field prop-field--checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={isBound}
          onChange={(e) => {
            onChange(e.target.checked);
            onCommit();
          }}
        />
        <span>
          {label}
          {prop.required ? ' *' : ''}
        </span>
        <VariableToggle varName={varName} onToggle={onToggleVariable} />
      </label>
    );
  }

  if (prop.type === 'enum' && prop.enumValues) {
    return (
      <label className={`prop-field ${hasError ? 'has-error' : ''}`} htmlFor={id}>
        <span className="prop-field__label">
          {label}
          {prop.required ? ' *' : ''}
          <VariableToggle varName={varName} onToggle={onToggleVariable} />
        </span>
        <select
          id={id}
          value={value == null ? '' : String(value)}
          disabled={isBound}
          onChange={(e) => {
            onChange(e.target.value);
            onCommit();
          }}
        >
          <option value="">—</option>
          {prop.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (prop.type === 'number') {
    return (
      <label className={`prop-field ${hasError ? 'has-error' : ''}`} htmlFor={id}>
        <span className="prop-field__label">
          {label}
          {prop.required ? ' *' : ''}
          <VariableToggle varName={varName} onToggle={onToggleVariable} />
        </span>
        <input
          id={id}
          type="number"
          value={value == null || value === '' ? '' : Number(value)}
          min={prop.validate?.min}
          max={prop.validate?.max}
          disabled={isBound}
          onChange={(e) =>
            onChange(e.target.value === '' ? '' : Number(e.target.value))
          }
          onBlur={onCommit}
        />
      </label>
    );
  }

  // string, cidr, reference, list, map — text for v1
  const isMultiline =
    prop.name.includes('policy') ||
    (typeof value === 'string' && value.includes('\n'));

  return (
    <label className={`prop-field ${hasError ? 'has-error' : ''}`} htmlFor={id}>
      <span className="prop-field__label">
        {label}
        {prop.required ? ' *' : ''}
        <VariableToggle varName={varName} onToggle={onToggleVariable} />
      </span>
      {isMultiline ? (
        <textarea
          id={id}
          rows={6}
          value={value == null ? '' : String(value)}
          disabled={isBound}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value == null ? '' : String(value)}
          placeholder={prop.type === 'cidr' ? '10.0.0.0/16' : undefined}
          disabled={isBound}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      )}
      {prop.description && (
        <span className="prop-field__hint">{prop.description}</span>
      )}
    </label>
  );
}

export function PropertiesPanel() {
  const document = useDocument();
  const selectedIds = useSelectedResourceIds();
  const selectedRelationshipIds = useSelectedRelationshipIds();
  const diagnostics = useDiagnostics();
  const { store, registry } = useStudioServices();

  const resourceId = selectedIds[0];
  const resource = resourceId
    ? document.resources.find((r) => r.id === resourceId)
    : undefined;
  const def = resource ? registry.get(resource.type) : undefined;

  if (!resource || !def) {
    const relationshipId = selectedRelationshipIds[0];
    const relationship = relationshipId
      ? document.relationships.find((r) => r.id === relationshipId)
      : undefined;

    if (relationship) {
      const sourceRes = document.resources.find((r) => r.id === relationship.sourceId);
      const targetRes = document.resources.find((r) => r.id === relationship.targetId);
      return (
        <aside className="properties-panel">
          <div className="properties-panel__header">
            <div className="properties-panel__title">Connection</div>
            <div className="properties-panel__type">{relationship.relationship}</div>
          </div>
          <div className="properties-panel__connection-summary">
            <div>
              <strong>From:</strong> {sourceRes?.name ?? relationship.sourceId}
            </div>
            <div>
              <strong>To:</strong> {targetRes?.name ?? relationship.targetId}
            </div>
          </div>
          <button
            type="button"
            className="btn btn--danger properties-panel__delete"
            onClick={() =>
              store.send({ type: 'connection.remove', id: relationship.id })
            }
          >
            Delete connection
          </button>
        </aside>
      );
    }

    return (
      <aside className="properties-panel">
        <div className="properties-panel__empty">
          Select a resource or connection to edit
        </div>
      </aside>
    );
  }

  const errorProps = new Set(
    diagnostics
      .filter((d) => d.resourceId === resource.id && d.property && d.severity === 'error')
      .map((d) => d.property!),
  );

  const resourceDiags = diagnostics.filter((d) => d.resourceId === resource.id);

  const commit = () => store.send({ type: 'history.checkpoint' });

  const serviceGroups = Array.from(
    new Set(
      document.resources
        .map((r) => r.serviceGroup)
        .filter((g): g is string => Boolean(g)),
    ),
  ).sort();

  const onDelete = () => {
    if (!window.confirm(`Delete "${resource.name}"? This also removes anything nested inside it.`)) {
      return;
    }
    store.send({ type: 'resource.remove', id: resource.id });
  };

  return (
    <aside className="properties-panel">
      <div className="properties-panel__header">
        <div className="properties-panel__title">{def.display.label}</div>
        <div className="properties-panel__type">{resource.type}</div>
      </div>

      <label className="prop-field" htmlFor="resource-name">
        <span className="prop-field__label">Name</span>
        <input
          id="resource-name"
          type="text"
          value={resource.name}
          onChange={(e) =>
            store.send({ type: 'resource.rename', id: resource.id, name: e.target.value })
          }
          onBlur={commit}
        />
      </label>

      <label className="prop-field" htmlFor="resource-service-group">
        <span className="prop-field__label">Service / Directory</span>
        <input
          id="resource-service-group"
          type="text"
          list="service-group-options"
          placeholder="shared"
          value={resource.serviceGroup ?? ''}
          onChange={(e) =>
            store.send({
              type: 'resource.setServiceGroup',
              id: resource.id,
              serviceGroup: e.target.value,
            })
          }
          onBlur={commit}
        />
        <datalist id="service-group-options">
          {serviceGroups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <span className="prop-field__hint">
          Groups resources for multi-service Terraform export (one directory/state per group).
        </span>
      </label>

      <div className="properties-panel__section">Properties</div>
      {def.properties.map((prop) => (
        <Field
          key={prop.name}
          prop={prop}
          value={resource.properties[prop.name]}
          hasError={errorProps.has(prop.name)}
          varName={resource.variableBindings?.[prop.name]}
          onToggleVariable={(varName) => {
            store.send({
              type: 'variable.set',
              id: resource.id,
              property: prop.name,
              varName,
            });
            commit();
          }}
          onChange={(value) =>
            store.send({
              type: 'property.update',
              id: resource.id,
              property: prop.name,
              value,
            })
          }
          onCommit={commit}
        />
      ))}

      {resourceDiags.length > 0 && (
        <div className="properties-panel__diags">
          {resourceDiags.map((d, i) => (
            <div
              key={`${d.code}-${i}`}
              className={`properties-panel__diag properties-panel__diag--${d.severity}`}
            >
              {d.message}
            </div>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--danger properties-panel__delete" onClick={onDelete}>
        Delete resource
      </button>
    </aside>
  );
}
