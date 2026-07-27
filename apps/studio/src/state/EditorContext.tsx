import { createActorContext } from '@xstate/react';
import { editorMachine } from './editorMachine';

export const EditorActorContext = createActorContext(editorMachine);
