import { useMemo, useState } from 'react';
import { generate, buildDirectoryExport, collectRequiredVariables } from '@archviz/codegen';
import { useDiagnostics, useDocument } from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import { useExportSettings } from '../state/exportSettings';
import { useProjectContext } from '../state/projectContext';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { useExportTerraform } from '../persistence/useExportTerraform';
import { usePlanRunner } from '../plan/usePlanRunner';
import { PlanPanel } from '../plan/PlanPanel';

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

  const filePaths = Object.keys(files).sort();
  const selected = activeFile && files[activeFile] !== undefined ? activeFile : (filePaths[0] ?? null);
  const preview = selected ? (files[selected] ?? '') : '';

  return (
    <aside className="right-panel">
      <PropertiesPanel />
      <div className="code-panel">
        <div className="code-panel__header">
          <span>Terraform</span>
          <div className="code-panel__actions">
            {blocked && <span className="code-panel__badge">errors</span>}
            <button
              type="button"
              className="btn"
              disabled={blocked || mode === 'directories' || !plan.connected || plan.running}
              onClick={() =>
                void plan.runPlan(files, {
                  project: { id: currentProjectId, name: archvizDoc.meta.name },
                  requiredVariables,
                })
              }
              title={
                mode === 'directories'
                  ? 'Plan is not available for the multi-service layout (each service is its own root module) — switch to single file or by category'
                  : !plan.connected
                    ? 'Start the local runner first: run "npx archviz-runner" in the folder you export to'
                    : blocked
                      ? 'Fix errors before planning'
                      : plan.terraformVersion === null
                        ? 'Runner is connected but terraform was not found on its PATH'
                        : `Run terraform plan in ${plan.runnerDir}`
              }
            >
              {plan.running ? 'Planning…' : 'Plan'}
            </button>
            {canPickLocation && (
              <button
                type="button"
                className="btn"
                disabled={blocked}
                onClick={() => exportTf({ forceNewLocation: true })}
                title="Pick a different file/folder to save to"
              >
                Save As…
              </button>
            )}
            <button
              type="button"
              className="btn"
              disabled={blocked}
              onClick={() => exportTf()}
              title={
                blocked
                  ? 'Fix errors before exporting'
                  : canPickLocation
                    ? 'Choose where to save (remembers your choice)'
                    : 'Download the generated Terraform'
              }
            >
              Export
            </button>
          </div>
        </div>
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
          status={plan.status}
          log={plan.log}
          outcome={plan.outcome}
          summary={plan.summary}
          warnings={plan.warnings}
          running={plan.running}
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
