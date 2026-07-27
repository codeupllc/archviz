import { useEffect, useMemo, useState } from 'react';
import { createConstraintEngine } from '@archviz/core';
import { createAwsRegistry } from '@archviz/provider-aws';
import { createDocumentStore } from './state/documentStore';
import { StudioServicesProvider, useStudioServices } from './state/StudioServices';
import { ExportSettingsProvider } from './state/exportSettings';
import { ProjectProvider } from './state/projectContext';
import { EditorActorContext } from './state/EditorContext';
import { useDocument } from './state/hooks';
import { Canvas } from './canvas/Canvas';
import { Palette } from './palette/Palette';
import { CodePanel } from './codepanel/CodePanel';
import { Toolbar, useAutosave } from './persistence/Toolbar';
import { resolveInitialProject } from './persistence/storage';

/** Global Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z or Ctrl+Y (redo) shortcuts. */
function useUndoRedoShortcuts(): void {
  const { store } = useStudioServices();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'z' && event.key.toLowerCase() !== 'y') return;

      // Let a focused text field handle its own native undo/redo.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      event.preventDefault();
      const isRedo =
        event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey);
      store.send({ type: isRedo ? 'history.redo' : 'history.undo' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);
}

/** Editable diagram name shown in the header, backed by document.meta.name. */
function DiagramNameField() {
  const { store } = useStudioServices();
  const document = useDocument();
  const [draft, setDraft] = useState(document.meta.name);

  useEffect(() => setDraft(document.meta.name), [document.meta.name]);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== document.meta.name) {
      store.send({ type: 'document.rename', name });
      store.send({ type: 'history.checkpoint' });
    } else {
      setDraft(document.meta.name);
    }
  };

  return (
    <input
      className="app-header__diagram-name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      title="Rename this diagram"
      aria-label="Diagram name"
    />
  );
}

function StudioInner() {
  useAutosave();
  useUndoRedoShortcuts();
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__logo">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
              <rect x="8.5" y="13.5" width="7" height="7" rx="1.5" />
              <path d="M10.5 7h3M7 10.5V13.5M17 10.5v3M10.5 17h3" />
            </svg>
          </div>
          <h1>Archviz</h1>
          <span className="app-header__divider" aria-hidden="true" />
          <DiagramNameField />
        </div>
        <p>Visual infrastructure builder for Terraform</p>
        <Toolbar />
      </header>
      <div className="app-body">
        <Palette />
        <Canvas />
        <CodePanel />
      </div>
    </div>
  );
}

export function App() {
  const initialProject = useMemo(() => resolveInitialProject(), []);
  const services = useMemo(() => {
    const registry = createAwsRegistry();
    const engine = createConstraintEngine(registry);
    const store = createDocumentStore(registry, initialProject.document);
    return { registry, engine, store };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StudioServicesProvider value={services}>
      <EditorActorContext.Provider>
        <ExportSettingsProvider>
          <ProjectProvider initialId={initialProject.id}>
            <StudioInner />
          </ProjectProvider>
        </ExportSettingsProvider>
      </EditorActorContext.Provider>
    </StudioServicesProvider>
  );
}
