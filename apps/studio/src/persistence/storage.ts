import { createEmptyDocument, type ArchvizDocument } from '@archviz/core';

const STORAGE_KEY = 'archviz:document:v1';

export function saveToLocalStorage(document: ArchvizDocument): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // quota / private mode — ignore
  }
}

export function loadFromLocalStorage(): ArchvizDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArchvizDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.resources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Multi-project store — lets a user keep several diagrams in the browser and
// switch between them, instead of the single autosave slot above (which is
// kept only for migrating pre-existing users' data, see resolveInitialProject).
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
}

const PROJECTS_INDEX_KEY = 'archviz:projects:v1';
const PROJECT_DOC_PREFIX = 'archviz:project-doc:v1:';
const CURRENT_PROJECT_KEY = 'archviz:current-project:v1';

function newProjectId(): string {
  return `proj-${crypto.randomUUID().slice(0, 8)}`;
}

function readIndex(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(PROJECTS_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ProjectMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(index: ProjectMeta[]): void {
  try {
    localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(index));
  } catch {
    // quota / private mode — ignore
  }
}

/** All known projects, most recently updated first. */
export function listProjects(): ProjectMeta[] {
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadProjectDocument(id: string): ArchvizDocument | null {
  try {
    const raw = localStorage.getItem(PROJECT_DOC_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArchvizDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.resources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persists a project's document and keeps the index's name/updatedAt in sync. */
export function saveProjectDocument(id: string, document: ArchvizDocument): void {
  try {
    localStorage.setItem(PROJECT_DOC_PREFIX + id, JSON.stringify(document));
  } catch {
    return;
  }
  const index = readIndex();
  const existing = index.find((p) => p.id === id);
  const meta: ProjectMeta = {
    id,
    name: document.meta.name || 'Untitled',
    updatedAt: document.meta.updatedAt,
  };
  if (existing) {
    existing.name = meta.name;
    existing.updatedAt = meta.updatedAt;
  } else {
    index.push(meta);
  }
  writeIndex(index);
}

/** Creates a new project from a document (or a fresh empty one) and returns its id. */
export function createProject(document?: ArchvizDocument): string {
  const id = newProjectId();
  saveProjectDocument(id, document ?? createEmptyDocument());
  return id;
}

export function deleteProject(id: string): void {
  try {
    localStorage.removeItem(PROJECT_DOC_PREFIX + id);
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((p) => p.id !== id));
}

/** Renames a project directly in storage — works even if it isn't the open one. */
export function renameProject(id: string, name: string): void {
  const doc = loadProjectDocument(id);
  if (!doc) return;
  saveProjectDocument(id, {
    ...doc,
    meta: { ...doc.meta, name, updatedAt: new Date().toISOString() },
  });
}

/** Clones a project's document under a new id/name. Returns the new project, if source existed. */
export function duplicateProject(id: string): { id: string; document: ArchvizDocument } | null {
  const doc = loadProjectDocument(id);
  if (!doc) return null;
  const copy: ArchvizDocument = {
    ...doc,
    meta: { ...doc.meta, name: `${doc.meta.name || 'Untitled'} copy`, updatedAt: new Date().toISOString() },
  };
  const newId = createProject(copy);
  return { id: newId, document: copy };
}

export function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentProjectId(id: string): void {
  try {
    localStorage.setItem(CURRENT_PROJECT_KEY, id);
  } catch {
    // ignore
  }
}

/**
 * Figures out which project to open on startup: the last-opened one if it
 * still exists, otherwise the most recently touched project, otherwise a
 * one-time migration of the legacy single-slot autosave (from before the
 * project list existed), otherwise a fresh empty project.
 */
export function resolveInitialProject(): { id: string; document: ArchvizDocument } {
  const currentId = getCurrentProjectId();
  if (currentId) {
    const doc = loadProjectDocument(currentId);
    if (doc) return { id: currentId, document: doc };
  }

  const projects = listProjects();
  if (projects.length > 0) {
    const mostRecent = projects[0]!;
    const doc = loadProjectDocument(mostRecent.id) ?? createEmptyDocument();
    setCurrentProjectId(mostRecent.id);
    return { id: mostRecent.id, document: doc };
  }

  const legacy = loadFromLocalStorage();
  if (legacy) {
    const id = createProject(legacy);
    setCurrentProjectId(id);
    clearLocalStorage();
    return { id, document: legacy };
  }

  const doc = createEmptyDocument();
  const id = createProject(doc);
  setCurrentProjectId(id);
  return { id, document: doc };
}

export function downloadProjectFile(document: ArchvizDocument, filename?: string): void {
  const name = filename ?? `${document.meta.name || 'architecture'}.archviz.json`;
  const blob = new Blob([JSON.stringify(document, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.archviz.json') ? name : `${name}.archviz.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseProjectFile(text: string): ArchvizDocument {
  const parsed = JSON.parse(text) as ArchvizDocument;
  if (parsed?.version !== 1 || !Array.isArray(parsed.resources)) {
    throw new Error('Invalid Archviz project file');
  }
  return parsed;
}

/** Minimal shape of the File System Access API we rely on (not in all lib.dom versions). */
interface WritableFileHandle {
  name: string;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

type SaveFilePickerFn = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<WritableFileHandle>;

function getSaveFilePicker(): SaveFilePickerFn | null {
  const w = window as unknown as { showSaveFilePicker?: SaveFilePickerFn };
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker : null;
}

/** Remembered across exports in this tab so re-exporting overwrites the same chosen file. */
let cachedTfHandle: WritableFileHandle | null = null;

export type ExportResult = { mode: 'saved'; location: string } | { mode: 'downloaded' } | { mode: 'cancelled' };

/**
 * Writes `content` to disk. On browsers that support the File System Access
 * API (Chrome/Edge), the user picks a real location the first time and every
 * subsequent export silently overwrites that same file. Elsewhere (Firefox,
 * Safari), falls back to a normal browser download into the Downloads folder.
 */
export async function exportTerraformFile(
  content: string,
  opts: { forceNewLocation?: boolean } = {},
): Promise<ExportResult> {
  const picker = getSaveFilePicker();

  if (picker) {
    try {
      if (!cachedTfHandle || opts.forceNewLocation) {
        cachedTfHandle = await picker({
          suggestedName: 'main.tf',
          types: [{ description: 'Terraform file', accept: { 'text/plain': ['.tf'] } }],
        });
      }
      const writable = await cachedTfHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return { mode: 'saved', location: cachedTfHandle.name };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { mode: 'cancelled' };
      }
      cachedTfHandle = null;
      // fall through to the download fallback below
    }
  }

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = 'main.tf';
  a.click();
  URL.revokeObjectURL(url);
  return { mode: 'downloaded' };
}

export function supportsFilePicker(): boolean {
  return getSaveFilePicker() !== null;
}

/** Minimal shape of the directory-handle side of the File System Access API. */
interface WritableDirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<WritableDirectoryHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<WritableFileHandle>;
}

type DirectoryPickerFn = () => Promise<WritableDirectoryHandle>;

function getDirectoryPicker(): DirectoryPickerFn | null {
  const w = window as unknown as { showDirectoryPicker?: DirectoryPickerFn };
  return typeof w.showDirectoryPicker === 'function' ? w.showDirectoryPicker : null;
}

export function supportsDirectoryPicker(): boolean {
  return getDirectoryPicker() !== null;
}

/** Remembered across exports in this tab so re-exporting overwrites the same chosen folder. */
let cachedDirHandle: WritableDirectoryHandle | null = null;

async function writeFileAtPath(
  root: WritableDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Writes a multi-file Terraform export (by-category or multi-service
 * directories) to disk. On browsers with the File System Access API, the
 * user picks a root folder once and every file/subdirectory is written
 * underneath it. Elsewhere, falls back to downloading each file individually
 * (the browser will prompt once to allow multiple downloads).
 */
export async function exportTerraformFiles(
  files: Record<string, string>,
  opts: { forceNewLocation?: boolean } = {},
): Promise<ExportResult> {
  const picker = getDirectoryPicker();
  const paths = Object.keys(files);

  if (picker) {
    try {
      if (!cachedDirHandle || opts.forceNewLocation) {
        cachedDirHandle = await picker();
      }
      for (const path of paths) {
        await writeFileAtPath(cachedDirHandle, path, files[path] ?? '');
      }
      return { mode: 'saved', location: cachedDirHandle.name };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { mode: 'cancelled' };
      }
      cachedDirHandle = null;
      // fall through to per-file download fallback below
    }
  }

  for (const path of paths) {
    const blob = new Blob([files[path] ?? ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    // Flatten nested paths (e.g. "api/compute.tf") into safe filenames for
    // the fallback download, since browsers don't create folders for you.
    a.download = path.replace(/\//g, '__');
    a.click();
    URL.revokeObjectURL(url);
  }
  return { mode: 'downloaded' };
}

export async function openProjectFile(): Promise<ArchvizDocument | null> {
  return new Promise((resolve) => {
    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.archviz.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve(parseProjectFile(text));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}
