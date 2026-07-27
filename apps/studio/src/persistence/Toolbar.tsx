import { useEffect, useRef, useState } from 'react';
import { createEmptyDocument } from '@archviz/core';
import { useDocument, useCanUndo, useCanRedo } from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import { useProjectContext } from '../state/projectContext';
import {
  downloadProjectFile,
  openProjectFile,
  saveProjectDocument,
  createProject,
} from './storage';
import { useExportTerraform } from './useExportTerraform';
import { useExportSettings, type ExportMode } from '../state/exportSettings';
import { ProjectsModal } from './ProjectsModal';

/** Autosave the current document into its project's storage slot (debounced). */
export function useAutosave(debounceMs = 500): void {
  const document = useDocument();
  const { currentProjectId } = useProjectContext();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveProjectDocument(currentProjectId, document);
    }, debounceMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [document, currentProjectId, debounceMs]);
}

export function Toolbar() {
  const { store } = useStudioServices();
  const document = useDocument();
  const { setCurrentProjectId } = useProjectContext();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { exportTf, blocked, canPickLocation } = useExportTerraform();
  const { mode, setMode } = useExportSettings();
  const [showProjects, setShowProjects] = useState(false);

  const onSave = () => {
    downloadProjectFile(document);
  };

  const onOpen = async () => {
    const doc = await openProjectFile();
    if (!doc) return;
    // Imported files become their own new diagram in the project list,
    // rather than silently overwriting whatever is currently open.
    const id = createProject(doc);
    store.send({ type: 'document.load', document: doc });
    setCurrentProjectId(id);
  };

  const onNew = () => {
    if (
      !window.confirm(
        'Start a new diagram? The current one stays saved — you can switch back to it from "Diagrams".',
      )
    ) {
      return;
    }
    const newDoc = createEmptyDocument();
    const id = createProject(newDoc);
    store.send({ type: 'document.load', document: newDoc });
    setCurrentProjectId(id);
  };

  const onUndo = () => store.send({ type: 'history.undo' });
  const onRedo = () => store.send({ type: 'history.redo' });
  const onAutoArrange = () => store.send({ type: 'layout.autoArrange' });

  return (
    <div className="app-header__actions">
      <button
        type="button"
        className="btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl/Cmd+Z)"
      >
        ↶ Undo
      </button>
      <button
        type="button"
        className="btn"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl/Cmd+Shift+Z)"
      >
        ↷ Redo
      </button>
      <button
        type="button"
        className="btn"
        onClick={onAutoArrange}
        disabled={document.resources.length === 0}
        title="Tidy the diagram: pack children into their containers and arrange everything in a grid (undoable)"
      >
        Auto-arrange
      </button>
      <span className="app-header__divider" aria-hidden="true" />
      <button
        type="button"
        className="btn"
        onClick={() => setShowProjects(true)}
        title="Browse, rename, duplicate, or delete your saved diagrams"
      >
        Diagrams
      </button>
      <button type="button" className="btn" onClick={onNew}>
        New
      </button>
      <button type="button" className="btn" onClick={onOpen} title="Import an .archviz.json file as a new diagram">
        Import
      </button>
      <button type="button" className="btn" onClick={onSave} title="Download this diagram as an .archviz.json file">
        Download
      </button>
      <select
        className="btn export-mode-select"
        value={mode}
        onChange={(e) => setMode(e.target.value as ExportMode)}
        title="How the exported Terraform is organized into files/folders"
      >
        <option value="single-file">Single file (main.tf)</option>
        <option value="by-category">By category (network.tf, compute.tf…)</option>
        <option value="directories">Multi-service directories</option>
      </select>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => exportTf()}
        disabled={blocked}
        title={
          blocked
            ? 'Fix errors before exporting'
            : canPickLocation
              ? 'Choose where to save (remembers your choice)'
              : 'Download the generated Terraform'
        }
      >
        Export .tf
      </button>
      {showProjects && (
        <ProjectsModal
          onClose={() => {
            setShowProjects(false);
          }}
        />
      )}
    </div>
  );
}