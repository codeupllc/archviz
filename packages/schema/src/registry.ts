import type { ResourceDefinition, ResourceDefinitionJSON } from './types.js';

/**
 * Central registry of resource definitions. Built at startup from provider
 * packages; both the UI and the Terraform generator read from it.
 */
export class ResourceRegistry {
  private readonly byId = new Map<string, ResourceDefinition>();
  private readonly byCapability = new Map<string, Set<string>>();
  private readonly childrenOf = new Map<string, Set<string>>();

  register(definition: ResourceDefinition): void {
    if (this.byId.has(definition.id)) {
      throw new Error(`Resource already registered: ${definition.id}`);
    }
    this.byId.set(definition.id, definition);

    for (const cap of definition.capabilities) {
      let set = this.byCapability.get(cap);
      if (!set) {
        set = new Set();
        this.byCapability.set(cap, set);
      }
      set.add(definition.id);
    }

    for (const parent of definition.nesting.allowedParents) {
      let set = this.childrenOf.get(parent.type);
      if (!set) {
        set = new Set();
        this.childrenOf.set(parent.type, set);
      }
      set.add(definition.id);
    }
  }

  registerAll(definitions: readonly ResourceDefinition[]): void {
    for (const d of definitions) this.register(d);
  }

  get(id: string): ResourceDefinition | undefined {
    return this.byId.get(id);
  }

  require(id: string): ResourceDefinition {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Unknown resource type: ${id}`);
    return def;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  all(): ResourceDefinition[] {
    return [...this.byId.values()];
  }

  byProvider(provider: string): ResourceDefinition[] {
    return this.all().filter((d) => d.provider === provider);
  }

  byCategory(category: string): ResourceDefinition[] {
    return this.all().filter((d) => d.display.category === category);
  }

  /** Resource type ids that provide the given capability. */
  typesWithCapability(capability: string): string[] {
    return [...(this.byCapability.get(capability) ?? [])];
  }

  /** Resource type ids that may be nested inside the given parent type. */
  allowedChildren(parentType: string): string[] {
    return [...(this.childrenOf.get(parentType) ?? [])];
  }

  /** Whether `childType` may nest under `parentType`. */
  canNestType(childType: string, parentType: string): boolean {
    const def = this.byId.get(childType);
    if (!def) return false;
    return def.nesting.allowedParents.some((p) => p.type === parentType);
  }

  /** Nesting rule for child under parent, if any. */
  nestingRule(childType: string, parentType: string) {
    const def = this.byId.get(childType);
    return def?.nesting.allowedParents.find((p) => p.type === parentType);
  }

  /**
   * Whether a source type may connect to a target type with the given
   * relationship (type or capability match).
   */
  findConnectionRule(sourceType: string, relationship: string, targetType: string) {
    const source = this.byId.get(sourceType);
    if (!source) return undefined;
    const target = this.byId.get(targetType);
    if (!target) return undefined;

    return source.connections.find((rule) => {
      if (rule.relationship !== relationship) return false;
      return rule.targets.some((t) => {
        if ('type' in t && t.type) return t.type === targetType;
        if ('capability' in t && t.capability) {
          return target.capabilities.includes(t.capability);
        }
        return false;
      });
    });
  }

  /** All relationship names a source type may initiate toward a target type. */
  possibleRelationships(sourceType: string, targetType: string): string[] {
    const source = this.byId.get(sourceType);
    const target = this.byId.get(targetType);
    if (!source || !target) return [];

    return source.connections
      .filter((rule) =>
        rule.targets.some((t) => {
          if ('type' in t && t.type) return t.type === targetType;
          if ('capability' in t && t.capability) {
            return target.capabilities.includes(t.capability);
          }
          return false;
        }),
      )
      .map((r) => r.relationship);
  }

  toJSON(): ResourceDefinitionJSON[] {
    return this.all();
  }

  static fromJSON(defs: ResourceDefinitionJSON[]): ResourceRegistry {
    const registry = new ResourceRegistry();
    registry.registerAll(defs);
    return registry;
  }
}
