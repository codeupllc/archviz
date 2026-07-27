import { createContext, useContext, type ReactNode } from 'react';
import type { ResourceRegistry } from '@archviz/schema';
import type { ConstraintEngine } from '@archviz/core';
import type { DocumentStore } from './documentStore';

export interface StudioServices {
  registry: ResourceRegistry;
  engine: ConstraintEngine;
  store: DocumentStore;
}

const StudioServicesContext = createContext<StudioServices | null>(null);

export function StudioServicesProvider({
  value,
  children,
}: {
  value: StudioServices;
  children: ReactNode;
}) {
  return (
    <StudioServicesContext.Provider value={value}>
      {children}
    </StudioServicesContext.Provider>
  );
}

export function useStudioServices(): StudioServices {
  const ctx = useContext(StudioServicesContext);
  if (!ctx) throw new Error('StudioServicesProvider missing');
  return ctx;
}
