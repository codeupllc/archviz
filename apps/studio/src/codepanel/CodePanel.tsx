import { useMemo, useState } from 'react';
import { generate, buildDirectoryExport, collectRequiredVariables } from '@archviz/codegen';
import { checkLocalstackHobbyCompatibility } from '@archviz/provider-aws';
import { useDiagnostics, useDocument } from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import { useExportSettings } from '../state/exportSettings';
import { useProjectContext } from '../state/projectContext';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { useExportTerraform } from '../persistence/useExportTerraform';
import { usePlanRunner } from '../plan/usePlanRunner';
import { PlanPanel } from '../plan/PlanPanel';
import { TerraformToolbar } from '../plan/TerraformToolbar';

export function CodePanel() {
  const archvizDoc = useDocument();
  const diagnostics = useDiagnostics();
  const { registry } = useStudioServices();
  const { mode } = useExportSettings();
  const { exportTf, blocked, canPickLocation } = useExportTerraform();
  const { currentProjectId } = useProjectContext();
  const plan = usePlanRunner();
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const { files, requiredVariables } = useMemo(() => {
    if (mode === 'directories') {
      return {
        files: buildDirectoryExport(archvizDoc, registry, { emitDespiteErrors: true }).files,
        requiredVariables: [] as string[],
      };
    }
    const result = generate(archvizDoc, registry, {
      emitDespiteErrors: true,
      layout: mode === 'by-category' ? 'by-category' : 'single-file',
    });
    return { files: result.files, requiredVariables: collectRequiredVariables(result.plan) };
  }, [archvizDoc, registry, mode]);

  const resourceTypes = useMemo(
    () => archvizDoc.resources.map((r) => r.type),
    [archvizDoc.resources],
  );
  const hobby = useMemo(
    () =>
      checkLocalstackHobbyCompatibility(resourceTypes, {
        paidEntitlements: Boolean(plan.localstack?.authTokenConfigured),
      }),
    [resourceTypes, plan.localstack?.authTokenConfigured],
  );

  const filePaths = Object.keys(files).sort();
  const selected = activeFile && files[activeFile] !== undefined ? activeFile : (filePaths[0] ?? null);
  const preview = selected ? (files[selected] ?? '') : '';

  const planOpts = {
    project: { id: currentProjectId, name: archvizDoc.meta.name },
    requiredVariables,
    resourceTypes,
  };

  const panelTitle =
    plan.status === 'applying' ||
    plan.status === 'destroying' ||
    plan.status === 'starting' ||
    plan.outcome === 'applied' ||
    plan.outcome === 'destroyed'
      ? 'LocalStack'
      : 'Plan';

  return (
    <aside className="right-panel">
      <PropertiesPanel />
      <div className="code-panel">
        <TerraformToolbar
          blocked={blocked}
          layoutBlocked={mode === 'directories'}
          connected={plan.connected}
          running={plan.running}
          status={plan.status}
          terraformVersion={plan.terraformVersion}
          runnerDir={plan.runnerDir}
          localstack={plan.localstack}
          hobby={hobby}
          canPickLocation={canPickLocation}
          onPlan={() => void plan.runPlan(files, planOpts)}
          onLocalstackApply={() => void plan.runLocalstackApply(files, planOpts)}
          onLocalstackDestroy={() => void plan.runLocalstackDestroy(files, planOpts)}
          onStartLocalstack={() => void plan.startLocalstack()}
          onExport={() => exportTf()}
          onSaveAs={canPickLocation ? () => exportTf({ forceNewLocation: true }) : undefined}
        />
        {filePaths.length > 1 && (
          <div className="code-panel__tabs">
            {filePaths.map((path) => (
              <button
                key={path}
                type="button"
                className={`code-panel__tab ${path === selected ? 'code-panel__tab--active' : ''}`}
                onClick={() => setActiveFile(path)}
              >
                {path}
              </button>
            ))}
          </div>
        )}
        <pre className="code-panel__body">{preview}</pre>
        <PlanPanel
          title={panelTitle}
          status={plan.status}
          log={plan.log}
          outcome={plan.outcome}
          summary={plan.summary}
          warnings={plan.warnings}
          running={plan.running}
          localstackSwaggerUrl={plan.localstackSwaggerUrl}
        />
        <div className="diagnostics">
          <div className="diagnostics__title">Diagnostics ({diagnostics.length})</div>
          <ul>
            {diagnostics.map((d, i) => (
              <li
                key={`${d.code}-${i}`}
                className={`diagnostics__item diagnostics__item--${d.severity}`}
              >
                <strong>{d.tier}</strong> {d.message}
              </li>
            ))}
            {diagnostics.length === 0 && (
              <li className="diagnostics__empty">No issues</li>
            )}
          </ul>
        </div>
      </div>
    </aside>
  );
}
