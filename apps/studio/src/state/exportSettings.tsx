import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type ExportMode = 'single-file' | 'by-category' | 'directories';

const STORAGE_KEY = 'archviz:export-mode:v1';

function loadInitialMode(): ExportMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'single-file' || raw === 'by-category' || raw === 'directories') return raw;
  } catch {
    // ignore
  }
  return 'by-category';
}

export interface ExportSettings {
  mode: ExportMode;
  setMode: (mode: ExportMode) => void;
}

const ExportSettingsContext = createContext<ExportSettings | null>(null);

export function ExportSettingsProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ExportMode>(loadInitialMode);

  const value = useMemo<ExportSettings>(
    () => ({
      mode,
      setMode: (next) => {
        setModeState(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // ignore
        }
      },
    }),
    [mode],
  );

  return <ExportSettingsContext.Provider value={value}>{children}</ExportSettingsContext.Provider>;
}

export function useExportSettings(): ExportSettings {
  const ctx = useContext(ExportSettingsContext);
  if (!ctx) throw new Error('ExportSettingsProvider missing');
  return ctx;
}
