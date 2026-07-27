import { useState } from 'react';
import { createEmptyDocument } from '@archviz/core';
import { useStudioServices } from '../state/StudioServices';
import { useProjectContext } from '../state/projectContext';
import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
  duplicateProject,
  loadProjectDocument,
  type ProjectMeta,
} from './storage';

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export function ProjectsModal({ onClose }: { onClose: () => void }) {
  const { store } = useStudioServices();
  const { currentProjectId, setCurrentProjectId } = useProjectContext();
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const refresh = () => setProjects(listProjects());

  const openProject = (id: string) => {
    if (id === currentProjectId) {
      onClose();
      return;
    }
    const doc = loadProjectDocument(id);
    if (!doc) return;
    store.send({ type: 'document.load', document: doc });
    setCurrentProjectId(id);
    onClose();
  };

  const onNew = () => {
    const doc = createEmptyDocument();
    const id = createProject(doc);
    store.send({ type: 'document.load', document: doc });
    setCurrentProjectId(id);
    onClose();
  };

  const onDuplicate = (id: string) => {
    const result = duplicateProject(id);
    if (!result) return;
    refresh();
  };

  const onDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteProject(id);
    if (id === currentProjectId) {
      const remaining = listProjects().filter((p) => p.id !== id);
      if (remaining.length > 0) {
        const doc = loadProjectDocument(remaining[0]!.id);
        if (doc) {
          store.send({ type: 'document.load', document: doc });
          setCurrentProjectId(remaining[0]!.id);
        }
      } else {
        const doc = createEmptyDocument();
        const newId = createProject(doc);
        store.send({ type: 'document.load', document: doc });
        setCurrentProjectId(newId);
      }
    }
    refresh();
  };

  const startRename = (p: ProjectMeta) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim();
    if (name) {
      renameProject(id, name);
      if (id === currentProjectId) {
        store.send({ type: 'document.rename', name });
        store.send({ type: 'history.checkpoint' });
      }
    }
    setRenamingId(null);
    refresh();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2>Diagrams</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          {projects.length === 0 && (
            <div className="projects-empty">No saved diagrams yet.</div>
          )}
          <ul className="projects-list">
            {projects.map((p) => (
              <li
                key={p.id}
                className={`projects-list__item ${p.id === currentProjectId ? 'projects-list__item--active' : ''}`}
              >
                <button
                  type="button"
                  className="projects-list__open"
                  onClick={() => openProject(p.id)}
                  title="Open this diagram"
                >
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      className="projects-list__rename-input"
                      value={renameValue}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(p.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <span className="projects-list__name">
                        {p.name}
                        {p.id === currentProjectId && (
                          <span className="projects-list__badge">current</span>
                        )}
                      </span>
                      <span className="projects-list__updated">
                        Updated {formatUpdatedAt(p.updatedAt)}
                      </span>
                    </>
                  )}
                </button>
                <div className="projects-list__actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      startRename(p);
                    }}
                    title="Rename"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(p.id);
                    }}
                    title="Duplicate"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(p.id, p.name);
                    }}
                    title="Delete"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="modal__footer">
          <button type="button" className="btn btn--primary" onClick={onNew}>
            + New Diagram
          </button>
        </div>
      </div>
    </div>
  );
}
