/** Layout position/size kept namespaced so semantic diffs stay clean. */
export interface ResourceLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** A placed resource instance in the diagram. */
export interface ResourceInstance {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  parentId?: string | null;
  layout: ResourceLayout;
  /**
   * Properties promoted to a Terraform `variable` instead of an inline
   * literal. Maps property name -> variable name (without `var.` prefix).
   * The property's current value becomes that variable's default.
   */
  variableBindings?: Record<string, string>;
  /**
   * Which named service/directory this resource belongs to for multi-service
   * Terraform export. Defaults to "shared" when unset.
   */
  serviceGroup?: string | null;
}

/** An edge between two resources. */
export interface RelationshipInstance {
  id: string;
  relationship: string;
  sourceId: string;
  targetId: string;
  /**
   * Which connection point ('top' | 'right' | 'bottom' | 'left') the edge is
   * anchored to on each node. Purely visual — omitted for older documents,
   * which fall back to right -> left.
   */
  sourceHandle?: string;
  targetHandle?: string;
}

/** The semantic document — single source of truth for the diagram. */
export interface ArchvizDocument {
  version: 1;
  meta: {
    name: string;
    provider: string;
    createdAt: string;
    updatedAt: string;
  };
  resources: ResourceInstance[];
  relationships: RelationshipInstance[];
}

export function createEmptyDocument(
  name = 'Untitled',
  provider = 'aws',
): ArchvizDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    meta: { name, provider, createdAt: now, updatedAt: now },
    resources: [],
    relationships: [],
  };
}

export function touchDocument(doc: ArchvizDocument): ArchvizDocument {
  return {
    ...doc,
    meta: { ...doc.meta, updatedAt: new Date().toISOString() },
  };
}

export function findResource(
  doc: ArchvizDocument,
  id: string,
): ResourceInstance | undefined {
  return doc.resources.find((r) => r.id === id);
}

export function findRelationship(
  doc: ArchvizDocument,
  id: string,
): RelationshipInstance | undefined {
  return doc.relationships.find((r) => r.id === id);
}

export function childrenOf(
  doc: ArchvizDocument,
  parentId: string,
): ResourceInstance[] {
  return doc.resources.filter((r) => r.parentId === parentId);
}

export function relationshipsFrom(
  doc: ArchvizDocument,
  sourceId: string,
  relationship?: string,
): RelationshipInstance[] {
  return doc.relationships.filter(
    (r) => r.sourceId === sourceId && (relationship === undefined || r.relationship === relationship),
  );
}

export function relationshipsTo(
  doc: ArchvizDocument,
  targetId: string,
  relationship?: string,
): RelationshipInstance[] {
  return doc.relationships.filter(
    (r) => r.targetId === targetId && (relationship === undefined || r.relationship === relationship),
  );
}
