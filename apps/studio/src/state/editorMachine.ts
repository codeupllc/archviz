import { setup, assign } from 'xstate';

export interface EditorContext {
  connectingFromId: string | null;
  connectingRelationship: string | null;
  validTargetIds: string[];
  draggingResourceId: string | null;
  candidateParentId: string | null;
  candidateParentValid: boolean;
  selectedResourceId: string | null;
  feedback: { message: string; tone: 'error' | 'info' } | null;
  /** Resource type currently being dragged out of the palette (not yet dropped). */
  paletteDraggingType: string | null;
}

export type EditorEvent =
  | {
      type: 'CONNECT_START';
      sourceId: string;
      relationship?: string;
      validTargetIds: string[];
    }
  | { type: 'CONNECT_END' }
  | { type: 'CONNECT_CANCEL' }
  | {
      type: 'DRAG_START';
      resourceId: string;
    }
  | {
      type: 'DRAG_OVER_CONTAINER';
      parentId: string | null;
      valid: boolean;
    }
  | { type: 'DRAG_END' }
  | { type: 'SELECT'; resourceId: string | null }
  | { type: 'EDIT_PROPERTIES'; resourceId: string }
  | { type: 'CLOSE_PROPERTIES' }
  | { type: 'PAN_START' }
  | { type: 'PAN_END' }
  | { type: 'CLEAR_FEEDBACK' }
  | { type: 'SET_FEEDBACK'; message: string; tone?: 'error' | 'info' }
  | { type: 'PALETTE_DRAG_START'; resourceType: string }
  | { type: 'PALETTE_DRAG_END' };

const initialContext: EditorContext = {
  connectingFromId: null,
  connectingRelationship: null,
  validTargetIds: [],
  draggingResourceId: null,
  candidateParentId: null,
  candidateParentValid: false,
  selectedResourceId: null,
  feedback: null,
  paletteDraggingType: null,
};

export const editorMachine = setup({
  types: {
    context: {} as EditorContext,
    events: {} as EditorEvent,
  },
}).createMachine({
  id: 'editor',
  initial: 'idle',
  context: initialContext,
  on: {
    PALETTE_DRAG_START: {
      actions: assign(({ event }) => ({ paletteDraggingType: event.resourceType })),
    },
    PALETTE_DRAG_END: {
      actions: assign({ paletteDraggingType: null }),
    },
  },
  states: {
    idle: {
      on: {
        CONNECT_START: {
          target: 'connecting',
          actions: assign(({ event }) => ({
            connectingFromId: event.sourceId,
            connectingRelationship: event.relationship ?? null,
            validTargetIds: event.validTargetIds,
            feedback: null,
          })),
        },
        DRAG_START: {
          target: 'draggingNode',
          actions: assign(({ event }) => ({
            draggingResourceId: event.resourceId,
            candidateParentId: null,
            candidateParentValid: false,
          })),
        },
        SELECT: {
          actions: assign(({ event }) => ({
            selectedResourceId: event.resourceId,
          })),
        },
        EDIT_PROPERTIES: {
          target: 'editingProperties',
          actions: assign(({ event }) => ({
            selectedResourceId: event.resourceId,
          })),
        },
        PAN_START: { target: 'panning' },
        SET_FEEDBACK: {
          actions: assign(({ event }) => ({
            feedback: { message: event.message, tone: event.tone ?? 'error' },
          })),
        },
        CLEAR_FEEDBACK: {
          actions: assign({ feedback: null }),
        },
      },
    },
    connecting: {
      on: {
        CONNECT_END: {
          target: 'idle',
          actions: assign({
            connectingFromId: null,
            connectingRelationship: null,
            validTargetIds: [],
          }),
        },
        CONNECT_CANCEL: {
          target: 'idle',
          actions: assign({
            connectingFromId: null,
            connectingRelationship: null,
            validTargetIds: [],
          }),
        },
        SET_FEEDBACK: {
          actions: assign(({ event }) => ({
            feedback: { message: event.message, tone: event.tone ?? 'error' },
          })),
        },
      },
    },
    draggingNode: {
      on: {
        DRAG_OVER_CONTAINER: {
          actions: assign(({ event }) => ({
            candidateParentId: event.parentId,
            candidateParentValid: event.valid,
          })),
        },
        DRAG_END: {
          target: 'idle',
          actions: assign({
            draggingResourceId: null,
            candidateParentId: null,
            candidateParentValid: false,
          }),
        },
        SET_FEEDBACK: {
          actions: assign(({ event }) => ({
            feedback: { message: event.message, tone: event.tone ?? 'error' },
          })),
        },
      },
    },
    editingProperties: {
      on: {
        CLOSE_PROPERTIES: { target: 'idle' },
        SELECT: {
          actions: assign(({ event }) => ({
            selectedResourceId: event.resourceId,
          })),
        },
        EDIT_PROPERTIES: {
          actions: assign(({ event }) => ({
            selectedResourceId: event.resourceId,
          })),
        },
        CONNECT_START: {
          target: 'connecting',
          actions: assign(({ event }) => ({
            connectingFromId: event.sourceId,
            connectingRelationship: event.relationship ?? null,
            validTargetIds: event.validTargetIds,
          })),
        },
      },
    },
    panning: {
      on: {
        PAN_END: { target: 'idle' },
      },
    },
  },
});
