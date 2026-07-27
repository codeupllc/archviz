import { createContext, useContext, useState, type ReactNode } from 'react';
import { setCurrentProjectId as persistCurrentProjectId } from '../persistence/storage';

export interface ProjectContextValue {
  currentProjectId: string;
  /** Switches the "active" project pointer (does not itself load the document — callers dispatch document.load separately). */
  setCurrentProjectId: (id: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({
  initialId,
  children,
}: {
  initialId: string;
  children: ReactNode;
}) {
  const [currentProjectId, setCurrentProjectIdState] = useState(initialId);

  const setCurrentProjectId = (id: string) => {
    setCurrentProjectIdState(id);
    persistCurrentProjectId(id);
  };

  return (
    <ProjectContext.Provider value={{ currentProjectId, setCurrentProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('ProjectProvider missing');
  return ctx;
}
