import { useSelector } from '@xstate/store/react';
import type { ArchvizDocument, Diagnostic } from '@archviz/core';
import { useStudioServices } from './StudioServices';

export function useDocument(): ArchvizDocument {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.document);
}

export function useDiagnostics(): Diagnostic[] {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.diagnostics);
}

export function useSelectedResourceIds(): string[] {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.selectedResourceIds);
}

export function useSelectedRelationshipIds(): string[] {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.selectedRelationshipIds);
}

export function useLastError(): Diagnostic[] | null {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.lastError);
}

export function useCanUndo(): boolean {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.history.past.length > 0);
}

export function useCanRedo(): boolean {
  const { store } = useStudioServices();
  return useSelector(store, (s) => s.context.history.future.length > 0);
}
