/** Resource category used for palette grouping and color conventions. */
export type ResourceCategory =
  | 'networking'
  | 'compute'
  | 'database'
  | 'storage'
  | 'security'
  | 'integration'
  | 'management';

/** Visual kind — containers become group nodes; nodes are leaf resources. */
export type ResourceKind = 'node' | 'container';

/** Display metadata for palette and canvas rendering. */
export interface ResourceDisplay {
  label: string;
  icon: string;
  category: ResourceCategory;
  kind: ResourceKind;
  /** Optional short description shown in the palette tooltip. */
  description?: string;
}

/** Property value types supported by the schema-driven form. */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'cidr'
  | 'reference'
  | 'list'
  | 'map';

export interface PropertyValidate {
  pattern?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
}

export interface PropertyDefinition {
  name: string;
  type: PropertyType;
  required: boolean;
  label?: string;
  description?: string;
  default?: unknown;
  enumValues?: string[];
  /** For type: 'reference' — resource type id(s) that may be selected. */
  referenceTypes?: string[];
  /** For type: 'list' — element type. */
  itemType?: PropertyType;
  validate?: PropertyValidate;
}

/** One-direction nesting rule: child declares who may contain it. */
export interface NestingParentRule {
  type: string;
  required?: boolean;
  /** Max instances of this child type under a single parent. */
  maxPerParent?: number | null;
}

export interface NestingRules {
  allowedParents: NestingParentRule[];
}

/** Target either a concrete type or a capability tag. */
export type ConnectionTarget =
  | { type: string; capability?: never }
  | { capability: string; type?: never };

export interface ConnectionCardinality {
  maxOutgoing?: number | null;
  maxIncoming?: number | null;
  /**
   * Minimum outgoing connections for a valid document. Use this when Terraform
   * *requires* an argument that can only come from a connection (e.g. a Lambda
   * function's `role`), so the diagram is flagged instead of generating HCL
   * that fails at plan time. Checked document-wide by validate(), not while a
   * single connection is being drawn.
   */
  minOutgoing?: number | null;
}

/**
 * How a connection materializes into Terraform.
 * Provider packages may register custom strategies (e.g. 'sg-rule-pair').
 */
export type MaterializeStrategy =
  | { strategy: 'attribute'; attribute: string }
  | { strategy: 'resource'; via: string }
  | { strategy: 'annotation' }
  | { strategy: string; [key: string]: unknown };

export interface ConnectionRule {
  relationship: string;
  targets: ConnectionTarget[];
  cardinality?: ConnectionCardinality;
  materialize: MaterializeStrategy;
  label?: string;
  bidirectional?: boolean;
}

/** Attribute expression helpers used in terraform.attributes mappings. */
export type AttrExpr =
  | { kind: 'prop'; name: string }
  | { kind: 'parent'; type: string; attr: string }
  | { kind: 'rel'; relationship: string; attr: string; many?: boolean }
  | { kind: 'literal'; value: unknown }
  | { kind: 'self'; attr: string };

/**
 * A nested HCL block within a resource (e.g. an ECS service's
 * `network_configuration { subnets = [...] }`). Attributes resolve exactly
 * like top-level `terraform.attributes` — same `AttrExpr` vocabulary.
 */
export interface TerraformNestedBlock {
  blockType: string;
  attributes: Record<string, AttrExpr>;
}

export interface TerraformMapping {
  resourceType: string;
  attributes: Record<string, AttrExpr>;
  /** Nested blocks emitted inside the resource body, e.g. network_configuration. */
  blocks?: TerraformNestedBlock[];
}

export interface ResourceDefinition {
  /** Fully-qualified id, e.g. 'aws/vpc'. */
  id: string;
  provider: string;
  display: ResourceDisplay;
  /** Capability tags this resource provides (e.g. 'network-service'). */
  capabilities: string[];
  nesting: NestingRules;
  connections: ConnectionRule[];
  properties: PropertyDefinition[];
  terraform: TerraformMapping;
}

/** JSON-serializable form of a ResourceDefinition (identical shape). */
export type ResourceDefinitionJSON = ResourceDefinition;
