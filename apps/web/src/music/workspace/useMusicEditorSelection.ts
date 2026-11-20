/** Selection/inspection binding over the committed WorkspaceState selection. */
import {useCallback, useMemo, useRef, useState} from 'react';
import type {
  CorrectionCommand, CorrectionSelection, NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import type {GestureEdit} from './gestures';
import type {WorkspaceAction, WorkspaceState} from './workspace-state';

export function selectedNoteFacts(document: NotationDocument, selection: CorrectionSelection) {
  const occurrence = document.performance.find(item => item.id === selection.occurrenceId);
  if (!occurrence) return null;
  const event = document.events.find(item => item.id === selection.eventId);
  const note = event?.notes.find(item => item.id === selection.logicalNoteId);
  return {
    pitch: occurrence.pitch, onset: occurrence.onset, duration: occurrence.duration,
    velocity: occurrence.velocity, spelling: note?.spelling ?? pitchName(occurrence.pitch),
    writtenTicks: event?.duration ?? 0, writtenStartTicks: event?.start ?? 0,
    notesInEvent: event?.notes.length ?? 1,
    linkedOccurrences: note?.performance_ids.length ?? 1,
  };
}

export type SelectedNoteFacts = NonNullable<ReturnType<typeof selectedNoteFacts>>;
export type AddMode = {pitch: number; seconds: number; ticks: number; durationSeconds: number};
export type ReplaceMode = {occurrenceId: string; pitch: number};

export function useMusicEditorSelection({state, document, dispatch, readOnly = false}: {
  state: WorkspaceState | null;
  document: NotationDocument | null;
  dispatch: (action: WorkspaceAction) => void;
  readOnly?: boolean;
}) {
  const selection = state?.selection ?? null;
  const selected = useMemo(() => document && selection
    ? selectedNoteFacts(document, selection) : null, [document, selection]);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [replaceMode, setReplaceMode] = useState<ReplaceMode | null>(null);
  const [pitchPickMode, setPitchPickMode] = useState<{occurrenceId: string; pitch: number} | null>(null);
  const [fretPickMode, setFretPickMode] = useState<string | null>(null);
  const [respellDraft, setRespellDraft] = useState('');
  const [inspectorDraft, setInspectorDraft] = useState('');
  const [reveal, setReveal] = useState<{occurrenceId: string; token: number} | null>(null);
  const revealToken = useRef(0);
  const modeReturnFocus = useRef<HTMLElement | null>(null);
  const selectionReference = useRef<{occurrenceId: string; element: HTMLElement} | null>(null);

  const select = useCallback((occurrenceId: string | null) => {
    dispatch({type: 'select', occurrenceId});
  }, [dispatch]);
  const command = useCallback((value: CorrectionCommand) => {
    dispatch({type: 'command', command: value});
  }, [dispatch]);
  const requestReveal = useCallback((occurrenceId: string) => {
    setReveal({occurrenceId, token: ++revealToken.current});
  }, []);
  const cancelModes = useCallback(() => {
    setAddMode(null); setReplaceMode(null); setPitchPickMode(null);
    setFretPickMode(null); setRespellDraft(''); setInspectorDraft('');
  }, []);
  const commitInspectorDraft = useCallback(() => {
    const value = inspectorDraft.trim();
    if (!value || !selection || readOnly) return false;
    command({type: 'respell', occurrenceId: selection.occurrenceId, spelling: value});
    setInspectorDraft('');
    return true;
  }, [command, inspectorDraft, readOnly, selection]);
  const commitPitch = useCallback((pitch: number) => {
    if (readOnly) return;
    if (replaceMode) command({type: 'set-occurrence-pitch',
      occurrenceId: replaceMode.occurrenceId, pitch});
    else if (selection) command({type: 'set-occurrence-pitch',
      occurrenceId: selection.occurrenceId, pitch});
    setReplaceMode(null); setPitchPickMode(null);
  }, [command, readOnly, replaceMode, selection]);
  const commitGuitarPosition = useCallback((string: number, fret: number) => {
    if (readOnly || !selection) return;
    command({type: 'set-guitar-position',
      occurrenceId: selection.occurrenceId, string, fret});
  }, [command, readOnly, selection]);
  const applyGesture = useCallback((edit: GestureEdit) => {
    if (readOnly) return;
    const value: CorrectionCommand = edit.kind === 'position'
      ? {type: 'set-guitar-position', occurrenceId: edit.occurrenceId,
          string: edit.string, fret: edit.fret}
      : edit.kind === 'pitch'
        ? {type: 'set-occurrence-pitch', occurrenceId: edit.occurrenceId, pitch: edit.pitch,
            ...(edit.spelling ? {spelling: edit.spelling} : {})}
        : edit.kind === 'time'
          ? {type: 'set-occurrence-onset', occurrenceId: edit.occurrenceId, seconds: edit.seconds, snapSeconds: null}
          : {type: 'set-occurrence-duration', occurrenceId: edit.occurrenceId,
              seconds: edit.durationSeconds};
    command(value);
  }, [command, readOnly]);

  return {selection, selected, addMode, setAddMode, replaceMode, setReplaceMode,
    pitchPickMode, setPitchPickMode, fretPickMode, setFretPickMode,
    respellDraft, setRespellDraft, inspectorDraft, setInspectorDraft,
    reveal, requestReveal, modeReturnFocus, selectionReference,
    select, command, cancelModes, commitInspectorDraft, commitPitch,
    commitGuitarPosition, applyGesture};
}
