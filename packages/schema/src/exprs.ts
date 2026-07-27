import type { AttrExpr } from './types.js';

/** Reference a property value on the resource itself. */
export function prop(name: string): AttrExpr {
  return { kind: 'prop', name };
}

/** Reference an attribute on the resource's parent of the given type. */
export function refParent(type: string, attr: string): AttrExpr {
  return { kind: 'parent', type, attr };
}

/** Reference an attribute on a related resource via a relationship. */
export function refRel(relationship: string, attr: string, many = false): AttrExpr {
  return { kind: 'rel', relationship, attr, many };
}

/** Emit a literal value. */
export function literal(value: unknown): AttrExpr {
  return { kind: 'literal', value };
}

/** Reference an attribute of the resource itself after creation (rare). */
export function self(attr: string): AttrExpr {
  return { kind: 'self', attr };
}

/** Namespace matching the plan's `ref.parent(...)` ergonomics. */
export const ref = {
  parent: refParent,
  rel: refRel,
  self,
};
