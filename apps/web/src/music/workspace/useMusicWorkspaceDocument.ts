/** Document command/history owner around the existing workspace reducer. */
import {useCallback, useState} from 'react';
import type {CorrectionCommand, CorrectionSelection, NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {
  createWorkspaceState, workspaceReducer, historySummary, workspaceStatus,
  type WorkspaceAction, type WorkspaceState,
} from './workspace-state';

export function useMusicWorkspaceDocument(initial: NotationDocument | null = null) {
  const [state, setState] = useState<WorkspaceState | null>(() =>
    initial ? createWorkspaceState(initial) : null);
  const [documentEpoch, setDocumentEpoch] = useState(0);

  const dispatch = useCallback((action: WorkspaceAction) => {
    setState(previous => previous ? workspaceReducer(previous, action) : previous);
  }, []);

  const replace = useCallback((document: NotationDocument) => {
    setDocumentEpoch(value => value + 1);
    setState(createWorkspaceState(document));
  }, []);

  const command = useCallback((value: CorrectionCommand) => {
    dispatch({type: 'command', command: value});
  }, [dispatch]);
  const commands = useCallback((values: CorrectionCommand[], label?: string,
    candidate?: NotationDocument, base?: NotationDocument) => {
    dispatch({type: 'commands', commands: values, label, candidate, base});
  }, [dispatch]);
  const select = useCallback((occurrenceId: string | null) => {
    dispatch({type: 'select', occurrenceId});
  }, [dispatch]);
  const undo = useCallback(() => dispatch({type: 'undo'}), [dispatch]);
  const redo = useCallback(() => dispatch({type: 'redo'}), [dispatch]);
  const reset = useCallback((document: NotationDocument) => {
    setDocumentEpoch(value => value + 1);
    dispatch({type: 'reset', document});
  }, [dispatch]);

  return {
    state, document: state?.document ?? null,
    selection: state?.selection ?? null as CorrectionSelection | null,
    documentEpoch, dispatch, command, commands, select, undo, redo, reset, replace,
    report: state?.lastReport ?? null, dirty: state?.dirty ?? false,
    status: state ? workspaceStatus(state) : '',
    history: state ? historySummary(state) : null,
  };
}
