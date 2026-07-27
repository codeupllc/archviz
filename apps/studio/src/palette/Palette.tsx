import { CATEGORY_COLORS } from '@archviz/provider-aws';
import type { ResourceDefinition } from '@archviz/schema';
import { useStudioServices } from '../state/StudioServices';
import { useDocument } from '../state/hooks';
import { EditorActorContext } from '../state/EditorContext';
import { ResourceIcon } from '../icons/ResourceIcon';

const CATEGORY_ORDER = [
  'networking',
  'compute',
  'database',
  'storage',
  'security',
  'integration',
  'management',
] as const;

/** Whether at least one ancestor-eligible resource already exists to satisfy this type's required parent(s). */
function isPlaceable(def: ResourceDefinition, resourceTypeIds: Set<string>): boolean {
  const required = def.nesting.allowedParents.filter((p) => p.required);
  if (required.length === 0) return true;
  return required.some((p) => resourceTypeIds.has(p.type));
}

export function Palette() {
  const { registry } = useStudioServices();
  const document = useDocument();
  const editorRef = EditorActorContext.useActorRef();
  const resources = registry.all();
  const existingTypes = new Set(document.resources.map((r) => r.type));

  const byCategory = CATEGORY_ORDER.map((category) => ({
    category,
    items: resources.filter((r) => r.display.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="palette">
      <div className="palette__title">Resources</div>
      <p className="palette__hint">Drag onto the canvas</p>
      {byCategory.map((group) => (
        <div key={group.category} className="palette__group">
          <div
            className="palette__group-label"
            style={{ color: CATEGORY_COLORS[group.category] }}
          >
            {group.category}
          </div>
          {group.items.map((item) => {
            const requiredParents = item.nesting.allowedParents.filter((p) => p.required);
            const placeable = isPlaceable(item, existingTypes);
            const requirementLabel = requiredParents
              .map((p) => registry.get(p.type)?.display.label ?? p.type)
              .join(' or ');

            return (
              <div
                key={item.id}
                className={`palette__item${placeable ? '' : ' palette__item--locked'}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/archviz-resource', item.id);
                  e.dataTransfer.effectAllowed = 'move';
                  editorRef.send({ type: 'PALETTE_DRAG_START', resourceType: item.id });
                }}
                onDragEnd={() => editorRef.send({ type: 'PALETTE_DRAG_END' })}
                title={item.display.description ?? item.display.label}
              >
                <span
                  className="palette__icon"
                  style={{ background: CATEGORY_COLORS[item.display.category] }}
                >
                  <ResourceIcon icon={item.display.icon} width={16} height={16} />
                </span>
                <span className="palette__text">
                  <span className="palette__label">{item.display.label}</span>
                  {requirementLabel && (
                    <span className="palette__requirement">
                      {placeable ? `in ${requirementLabel}` : `needs ${requirementLabel} first`}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
