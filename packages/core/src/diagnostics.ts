export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** Structural errors block gestures/export; semantic issues are warnings while drawing. */
export type DiagnosticTier = 'structural' | 'semantic';

export interface Diagnostic {
  code: string;
  message: string;
  severity: DiagnosticSeverity;
  tier: DiagnosticTier;
  resourceId?: string;
  relationshipId?: string;
  property?: string;
}

export interface ConstraintResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export function ok(): ConstraintResult {
  return { ok: true, diagnostics: [] };
}

export function fail(...diagnostics: Diagnostic[]): ConstraintResult {
  return { ok: false, diagnostics };
}

export function mergeResults(...results: ConstraintResult[]): ConstraintResult {
  const diagnostics = results.flatMap((r) => r.diagnostics);
  return {
    ok: diagnostics.every((d) => d.severity !== 'error'),
    diagnostics,
  };
}

export function hasStructuralErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.tier === 'structural' && d.severity === 'error');
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
