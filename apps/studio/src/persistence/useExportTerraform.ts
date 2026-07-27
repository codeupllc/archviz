import { useCallback } from 'react';
import { hasErrors } from '@archviz/core';
import { generate, buildDirectoryExport } from '@archviz/codegen';
import { useDiagnostics, useDocument } from '../state/hooks';
import { useStudioServices } from '../state/StudioServices';
import { useExportSettings } from '../state/exportSettings';
import { EditorActorContext } from '../state/EditorContext';
import {
  exportTerraformFile,
  exportTerraformFiles,
  supportsFilePicker,
  supportsDirectoryPicker,
} from './storage';

/** Shared "Export .tf" behavior for the Toolbar and CodePanel buttons. */
export function useExportTerraform() {
  const document = useDocument();
  const diagnostics = useDiagnostics();
  const { registry } = useStudioServices();
  const { mode } = useExportSettings();
  const editorRef = EditorActorContext.useActorRef();
  const blocked = hasErrors(diagnostics);
  const isMultiFile = mode !== 'single-file';
  const canPickLocation = isMultiFile ? supportsDirectoryPicker() : supportsFilePicker();

  const exportTf = useCallback(
    async (opts: { forceNewLocation?: boolean } = {}) => {
      if (blocked) {
        editorRef.send({
          type: 'SET_FEEDBACK',
          message: 'Fix the validation errors listed below before exporting.',
        });
        return;
      }

      if (mode === 'directories') {
        const dirResult = buildDirectoryExport(document, registry);
        if (dirResult.blocked) {
          editorRef.send({ type: 'SET_FEEDBACK', message: 'Export blocked due to validation errors.' });
          return;
        }
        const outcome = await exportTerraformFiles(dirResult.files, opts);
        if (outcome.mode === 'saved') {
          editorRef.send({ type: 'SET_FEEDBACK', message: `Saved to ${outcome.location}/`, tone: 'info' });
        } else if (outcome.mode === 'downloaded') {
          editorRef.send({
            type: 'SET_FEEDBACK',
            message: `Downloaded ${Object.keys(dirResult.files).length} files to your Downloads folder.`,
            tone: 'info',
          });
        }
        return;
      }

      const result = generate(document, registry, {
        layout: mode === 'by-category' ? 'by-category' : 'single-file',
      });
      if (result.blocked) {
        editorRef.send({ type: 'SET_FEEDBACK', message: 'Export blocked due to validation errors.' });
        return;
      }

      if (mode === 'by-category') {
        const outcome = await exportTerraformFiles(result.files, opts);
        if (outcome.mode === 'saved') {
          editorRef.send({ type: 'SET_FEEDBACK', message: `Saved to ${outcome.location}/`, tone: 'info' });
        } else if (outcome.mode === 'downloaded') {
          editorRef.send({
            type: 'SET_FEEDBACK',
            message: `Downloaded ${Object.keys(result.files).length} files to your Downloads folder.`,
            tone: 'info',
          });
        }
        return;
      }

      const outcome = await exportTerraformFile(result.files['main.tf'] ?? '', opts);
      if (outcome.mode === 'saved') {
        editorRef.send({ type: 'SET_FEEDBACK', message: `Saved to ${outcome.location}`, tone: 'info' });
      } else if (outcome.mode === 'downloaded') {
        editorRef.send({
          type: 'SET_FEEDBACK',
          message: 'Downloaded main.tf to your browser\u2019s Downloads folder.',
          tone: 'info',
        });
      }
      // 'cancelled' (user closed the save dialog) — no feedback needed.
    },
    [blocked, document, registry, editorRef, mode],
  );

  return { exportTf, blocked, canPickLocation, mode };
}
