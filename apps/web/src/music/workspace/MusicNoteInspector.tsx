/**
 * Contextual note inspector for the music review workspace.
 *
 * The panel receives the already-derived selected-note facts and typed commands; it
 * does not own document history, alignment, verification or playback. Guitar string
 * and fret fields share the same document commands as the roll and score.
 */
import {useEffect, useState} from 'react';
import {
  applyCommand,
  type CorrectionCommand, type CorrectionSelection, type GuitarFingering,
  type Hand, type HandAssignment, type NotationDocument,
} from '../../../../../packages/music-notation/index.ts';
import {pitchName} from '../music-reference';
import type {AddMode, SelectedNoteFacts} from './useMusicEditorSelection';

export const DURATION_CHOICES = [
  {label: 'Whole', ticks: 1920},
  {label: 'Half', ticks: 960},
  {label: 'Quarter', ticks: 480},
  {label: 'Eighth', ticks: 240},
  {label: '16th', ticks: 120},
];

export type NoteInspectorProps = {
  selection: CorrectionSelection | null;
  selected: SelectedNoteFacts | null;
  document: NotationDocument;
  readOnly: boolean;
  isPractice: boolean;
  guitar: boolean;
  narrowViewport: boolean;
  noteEditorExpanded: boolean;
  noteAdvancedOpen: boolean;
  onExpandEditor: () => void;
  onToggleAdvanced: () => void;
  onAudition: (pitch: number, seconds: number, velocity?: number | null) => void;
  onCommand: (command: CorrectionCommand) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  replaceMode: boolean;
  addMode: boolean;
  pitchPickOccurrenceId: string | null;
  onStartPitchPick: () => void;
  onStartReplace: () => void;
  hands: Record<string, HandAssignment>;
  onSetHand: (hand: Hand) => void;
  onResetHand: () => void;
  positionOf: (note: {pitch: number; string: number | null; fret: number | null}) => GuitarFingering | null;
  fretDraft: string;
  onFretDraftChange: (value: string) => void;
  onApplyFret: (string: number, fret: number) => void;
  onShiftGuitarString: (string: number) => void;
  fretPickMode: string | null;
  onToggleFretPick: () => void;
  writtenScope: 'note' | 'event';
  onWrittenScopeChange: (scope: 'note' | 'event') => void;
  respellDraft: string;
  onRespellDraftChange: (value: string) => void;
  onApplyRespell: () => void;
  writtenStartScope: 'note' | 'event';
  onWrittenStartScopeChange: (scope: 'note' | 'event') => void;
  writtenStartDraft: string;
  onWrittenStartDraftChange: (value: string) => void;
  onApplyWrittenStart: () => void;
  snapSeconds: number | null;
  tiedSegmentCount: number;
  onReveal: () => void;
  onNotice: (message: string) => void;
};

function NumberField({label, value, min, max, step, disabled, onCommit}: {
  label: string; value: number | null; min: number; max: number; step: number; disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? '' : String(Number(value.toFixed(4))));
  useEffect(() => { setDraft(value === null ? '' : String(Number(value.toFixed(4)))); }, [value]);
  const commit = () => {
    if (draft.trim() === '') { onCommit(null); return; }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) { setDraft(value === null ? '' : String(value)); return; }
    onCommit(Math.max(min, Math.min(max, parsed)));
  };
  return <label className="ws-field">
    <span>{label}</span>
    <input type="number" step={step} min={min} max={max} value={draft} disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } }}/>
  </label>;
}

export function MusicNoteInspector({
  selection, selected, document, readOnly, isPractice, guitar, narrowViewport,
  noteEditorExpanded, noteAdvancedOpen, onExpandEditor, onToggleAdvanced, onAudition,
  onCommand, canUndo, canRedo, onUndo, onRedo, replaceMode, addMode, pitchPickOccurrenceId,
  onStartPitchPick, onStartReplace, hands, onSetHand, onResetHand, positionOf, fretDraft, onFretDraftChange,
  onApplyFret, onShiftGuitarString, fretPickMode, onToggleFretPick,
  writtenScope, onWrittenScopeChange, respellDraft, onRespellDraftChange, onApplyRespell,
  writtenStartScope, onWrittenStartScopeChange, writtenStartDraft, onWrittenStartDraftChange,
  onApplyWrittenStart, snapSeconds, tiedSegmentCount, onReveal, onNotice,
}: NoteInspectorProps) {
  return <section className="ws-drawer-section ws-note-section" data-ws-section="note"
    data-note-expanded={noteEditorExpanded ? 'true' : 'false'}
    data-note-advanced={noteAdvancedOpen ? 'true' : 'false'} aria-label="Selected note">
    {!selection || !selected
      ? <p className="ws-hint">Select a note in the roll, the score or the keyboard to edit it.</p>
      : <>
        <header className="ws-note-head">
          <div>
            <h2>{selected.spelling}</h2>
            <p className="ws-note-location">{pitchName(selected.pitch)} · measure {selection.measureIndex + 1} · {selection.staff} voice {selection.voice}</p>
          </div>
          {narrowViewport && !noteEditorExpanded && <div className="ws-note-peek-actions">
            <button type="button" disabled={readOnly}
              onClick={() => onAudition(selected.pitch, Math.min(1.2, selected.duration ?? 0.4), selected.velocity)}>Preview</button>
            <button type="button" onClick={onExpandEditor}>Edit note</button>
          </div>}
        </header>
        {(!narrowViewport || noteEditorExpanded) && <div className="ws-note-primary">
          <div className="ws-row" role="group" aria-label="Note actions">
            <button type="button" disabled={readOnly}
              onClick={() => onAudition(selected.pitch, Math.min(1.2, selected.duration ?? 0.4), selected.velocity)}>Preview</button>
            <button type="button" data-pitch-pick aria-pressed={pitchPickOccurrenceId === selection.occurrenceId}
              disabled={readOnly}
              onClick={onStartPitchPick}>Choose on keyboard</button>
          </div>
          {!isPractice && narrowViewport && <div className="ws-row ws-note-history" role="group" aria-label="Note history">
            <button type="button" onClick={onUndo}
              disabled={readOnly || !canUndo || replaceMode || addMode}>Undo</button>
            <button type="button" onClick={onRedo}
              disabled={readOnly || !canRedo || replaceMode || addMode}>Redo</button>
          </div>}
          <div className="ws-row" role="group" aria-label="Pitch">
            <button type="button" disabled={readOnly} onClick={() => onCommand({type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch - 1})}>− semitone</button>
            <button type="button" disabled={readOnly} onClick={() => onCommand({type: 'set-occurrence-pitch', occurrenceId: selection.occurrenceId, pitch: selected.pitch + 1})}>+ semitone</button>
          </div>
          {guitar ? (() => {
            const occurrence = document.performance.find(item => item.id === selection.occurrenceId);
            if (!occurrence) return null;
            const position = positionOf(occurrence);
            if (!position) return <p className="ws-hint" data-unplayable-note="true" role="status">
              {pitchName(occurrence.pitch)} has no playable position under the current tuning and capo.
            </p>;
            return <div className="ws-guitar-note-editor" data-guitar-note-editor="true"
              data-guitar-current={`${position.string}:${position.fret}`}>
              <div className="ws-row" role="group" aria-label="Guitar string and fret">
                <label className="ws-field ws-inline"><span>String</span>
                  <select aria-label="Guitar string" value={position.string} disabled={readOnly}
                    onChange={event => {
                      const string = Number(event.target.value);
                      const fret = position.fret;
                      const outcome = applyCommand(document, {type: 'set-guitar-position',
                        occurrenceId: selection.occurrenceId, string, fret});
                      if (outcome.status === 'rejected') { onNotice(outcome.message); return; }
                      onCommand({type: 'set-guitar-position',
                        occurrenceId: selection.occurrenceId, string, fret});
                    }}>
                    {[1, 2, 3, 4, 5, 6].map(string => <option key={string} value={string}>{string}</option>)}
                  </select>
                </label>
                <label className="ws-field ws-inline"><span>Fret</span>
                  <input aria-label="Guitar fret" type="number" min={0} max={24} data-guitar-fret-input="true"
                    value={fretDraft} placeholder={String(position.fret)} disabled={readOnly}
                    onChange={event => onFretDraftChange(event.target.value)}/>
                </label>
                <button type="button" data-guitar-fret-apply="true" disabled={readOnly || !fretDraft.trim()}
                  onClick={() => {
                    const fret = Number(fretDraft);
                    if (!Number.isInteger(fret) || fret < 0 || fret > 24) { onNotice('A fret must be a whole number between 0 and 24.'); return; }
                    const outcome = applyCommand(document, {type: 'set-guitar-position',
                      occurrenceId: selection.occurrenceId, string: position.string, fret});
                    if (outcome.status === 'rejected') { onNotice(outcome.message); return; }
                    onApplyFret(position.string, fret);
                  }}>Set position</button>
              </div>
              <div className="ws-row" role="group" aria-label="Shift string keeping pitch">
                <span className="ws-hint">Shift string (keep pitch)</span>
                {[1, 2, 3, 4, 5, 6].map(string => <button key={string} type="button"
                  data-shift-string={string} disabled={readOnly || string === position.string}
                  onClick={() => {
                    const outcome = applyCommand(document, {type: 'shift-guitar-string',
                      occurrenceId: selection.occurrenceId, string});
                    if (outcome.status === 'rejected') { onNotice(outcome.message); return; }
                    onShiftGuitarString(string);
                  }}>{string}</button>)}
              </div>
              <div className="ws-row" role="group" aria-label="Choose on fretboard">
                <button type="button" data-guitar-fret-pick="true"
                  aria-pressed={fretPickMode === selection.occurrenceId}
                  disabled={readOnly}
                  onClick={onToggleFretPick}>
                  Choose on fretboard
                </button>
              </div>
            </div>;
          })() : null}
          <div className="ws-row ws-hand-picker" role="group" aria-label="Hand assignment"
            data-hand-assignment="true" data-hand-current={hands[selection.occurrenceId]?.hand ?? 'unassigned'}>
            <span className="ws-hint">Hand</span>
            {(['left', 'right', 'unassigned'] as const).map(hand =>
              <button key={hand} type="button" data-hand-choice={hand}
                aria-pressed={(hands[selection.occurrenceId]?.hand ?? 'unassigned') === hand}
                disabled={readOnly || replaceMode || addMode}
                onClick={() => onSetHand(hand)}>
                {hand === 'left' ? 'Left' : hand === 'right' ? 'Right' : 'Unknown'}
              </button>)}
            <button type="button" data-hand-reset="true"
              disabled={readOnly || !document.hand_assignments?.[selection.occurrenceId]?.manual}
              title="Remove the manual override and return to automatic estimates"
              onClick={onResetHand}>Auto</button>
            <span className="ws-hint" data-hand-provenance="true">
              {hands[selection.occurrenceId]?.manual ? 'manual override' :
                `${hands[selection.occurrenceId]?.source ?? 'baseline'} · ${hands[selection.occurrenceId]?.confidence ?? 'ambiguous'}`}
            </span>
          </div>
          <div className="ws-row" role="group" aria-label="Written duration">
            <span className="ws-hint">{writtenScope === 'event' ? 'Note value · whole event' : 'Note value'}</span>
            {DURATION_CHOICES.map(choice => <button key={choice.label} type="button" disabled={readOnly}
              onClick={() => onCommand(writtenScope === 'note'
                ? {type: 'set-written-duration', target: {logicalNoteId: selection.logicalNoteId}, ticks: choice.ticks, scope: 'note'}
                : {type: 'set-written-duration', target: {eventId: selection.eventId}, ticks: choice.ticks, scope: 'event'})}>
              {choice.label}
            </button>)}
          </div>
          <label className="ws-field">
            <span>Loudness {selected.velocity === null ? '(unknown)' : `${Math.round(selected.velocity * 100)}%`}</span>
            <input type="range" min={0} max={1} step={0.01} disabled={readOnly} value={selected.velocity ?? 0.7}
              onChange={event => onCommand({type: 'set-occurrence-velocity', occurrenceId: selection.occurrenceId, velocity: Number(event.target.value)})}/>
          </label>
          <button type="button" className="ws-note-more-toggle" aria-expanded={noteAdvancedOpen}
            onClick={onToggleAdvanced}>
            {noteAdvancedOpen ? 'Less timing' : 'Timing & more…'}
          </button>
        </div>}
        {noteAdvancedOpen && <div className="ws-note-secondary">
          <fieldset className="ws-inspector-fieldset" disabled={readOnly || replaceMode || addMode}>
            <p className="ws-facts">
              <strong>{selected.spelling}</strong> · {selection.occurrenceId} · {pitchName(selected.pitch)} (MIDI {selected.pitch})<br/>
              {selected.onset.toFixed(3)} s · recorded {selected.duration === null ? 'unknown' : `${selected.duration.toFixed(3)} s`}<br/>
              {selection.staff} voice {selection.voice} · measure {selection.measureIndex + 1} · written {selected.writtenTicks} ticks
              <br/><span data-written-segments="true">Written segments: {tiedSegmentCount} ({(selected.writtenTicks / 480).toFixed(2)} beats written)</span>
              <br/><span data-recorded-attacks="true">Recorded attacks mapped to this written note: {selected.linkedOccurrences}</span>
              {tiedSegmentCount > 1 && <>
                <br/><strong data-tie-scope="segments">This written note is tied across {tiedSegmentCount} segments; pitch replacement edits only the selected attack and splits the written note if several attacks share it.</strong>
              </>}
              {selected.linkedOccurrences > 1 && <>
                <br/><strong data-occurrence-scope="multiple">This written note owns {selected.linkedOccurrences} recorded attacks. “Delete note” removes the selected attack; “Delete logical note” removes the written note and every attack mapped to it.</strong>
              </>}
            </p>
            <div className="ws-row" role="group" aria-label="More pitch options">
              <button type="button" data-replace="start" disabled={addMode} aria-label="Replace pitch"
                onClick={onStartReplace}>Replace pitch</button>
              <button type="button" onClick={() => onCommand({type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'sharp'})}>♯</button>
              <button type="button" onClick={() => onCommand({type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'flat'})}>♭</button>
              <button type="button" onClick={() => onCommand({type: 'apply-accidental', occurrenceId: selection.occurrenceId, accidental: 'natural'})}>♮</button>
            </div>
            <div className="ws-row" role="group" aria-label="Respell">
              <label className="ws-field ws-inline">
                <span>Respell</span>
                <input value={respellDraft} placeholder={selected.spelling} size={6}
                  onChange={event => onRespellDraftChange(event.target.value)}/>
              </label>
              <button type="button" disabled={!respellDraft.trim()} onClick={onApplyRespell}>
                Apply spelling
              </button>
            </div>
            <div className="ws-row" role="group" aria-label="Written beat position">
              <span className="ws-hint">Written position for</span>
              <button type="button" aria-pressed={writtenStartScope === 'note'} data-written-scope="note"
                className={writtenStartScope === 'note' ? 'is-active' : ''}
                onClick={() => onWrittenStartScopeChange('note')}>This note</button>
              <button type="button" aria-pressed={writtenStartScope === 'event'} data-written-scope="event"
                className={writtenStartScope === 'event' ? 'is-active' : ''}
                onClick={() => onWrittenStartScopeChange('event')}>Whole written event</button>
              <label className="ws-field ws-inline"><span>Written beat position (ticks)</span>
                <input type="number" min={0} step={120} data-written-start
                  value={writtenStartDraft}
                  onChange={event => onWrittenStartDraftChange(event.target.value)}/>
              </label>
              <button type="button" data-written-start-apply disabled={!writtenStartDraft.trim()}
                onClick={onApplyWrittenStart}>Apply written position</button>
            </div>
            <div className="ws-row" role="group" aria-label="Written value scope">
              <span className="ws-hint">Written value for</span>
              <button type="button" aria-pressed={writtenScope === 'note'} className={writtenScope === 'note' ? 'is-active' : ''}
                onClick={() => onWrittenScopeChange('note')}>This note</button>
              <button type="button" aria-pressed={writtenScope === 'event'} className={writtenScope === 'event' ? 'is-active' : ''}
                onClick={() => onWrittenScopeChange('event')}>Whole event{selected.notesInEvent > 1 ? ` (${selected.notesInEvent} notes)` : ''}</button>
            </div>
            <NumberField label="Start (s)" value={selected.onset} min={0} max={document.duration} step={0.001}
              onCommit={value => { if (value !== null) onCommand({type: 'set-occurrence-onset', occurrenceId: selection.occurrenceId, seconds: value, snapSeconds}); }}/>
            <NumberField label="Recorded length (s)" value={selected.duration} min={0.001} max={document.duration} step={0.001}
              onCommit={value => { if (value !== null) onCommand({type: 'set-occurrence-duration', occurrenceId: selection.occurrenceId, seconds: value}); }}/>
            <div className="ws-row" role="group" aria-label="Remove">
              <button type="button" onClick={onReveal}>Reveal in views</button>
              <button type="button" onClick={() => onAudition(selected.pitch, Math.min(1.2, selected.duration ?? 0.4), selected.velocity)}>Audition</button>
              <button type="button" onClick={() => onCommand({type: 'delete-occurrence', occurrenceId: selection.occurrenceId})}>Delete note</button>
              <button type="button" onClick={() => onCommand({type: 'delete-logical-note', logicalNoteId: selection.logicalNoteId})}>Delete logical note</button>
            </div>
            <p className="ws-hint">
              Written value and recorded length are independent. Start uses exact seconds unless a Snap value is chosen.
            </p>
          </fieldset>
        </div>}
      </>}
  </section>;
}

/** Placement panel for add-note mode; rendered by the composition root at stage level. */
export function MusicAddNotePanel({
  addMode, stageView, duration, addProblem, ghostDuplicate, ghostDuplicateId, onDurationChange,
  onTicksChange, onCommit, onCancel, onSelectExisting,
}: {
  addMode: AddMode & {durationSeconds: number};
  stageView: string;
  duration: number;
  addProblem: string | null;
  ghostDuplicate: boolean;
  ghostDuplicateId: string | null;
  onDurationChange: (duration: number) => void;
  onTicksChange: (ticks: number) => void;
  onCommit: () => void;
  onCancel: () => void;
  onSelectExisting: (occurrenceId: string) => void;
}) {
  return <section className={`ws-add-panel ws-add-mode-panel${stageView === 'place' ? ' ws-add-place-panel' : ''}`}
    data-add="active" data-add-mode-active="true" role="group" aria-label="Add note mode">
    <p>New {pitchName(addMode.pitch)} at {addMode.seconds.toFixed(3)} s (recorded) · written {addMode.ticks} ticks ·
      click the roll to place it.</p>
    <div className="ws-row">
      <label className="ws-field ws-inline"><span>Recorded length (s)</span>
        <input type="number" step={0.01} min={0.02} max={duration} data-add="length"
          value={addMode.durationSeconds}
          onChange={event => onDurationChange(Math.max(0.02, Number(event.target.value) || 0.02))}/>
      </label>
      <label className="ws-field ws-inline"><span>Written value</span>
        <select data-add="written" value={addMode.ticks}
          onChange={event => onTicksChange(Number(event.target.value))}>
          {DURATION_CHOICES.map(choice => <option key={choice.ticks} value={choice.ticks}>{choice.label}</option>)}
        </select>
      </label>
      <button type="button" data-add="commit" aria-label="Insert" onClick={onCommit}>Insert</button>
      <button type="button" data-add="cancel" onClick={onCancel}>Cancel</button>
    </div>
    {addProblem && <p className="ws-report is-bad" data-add="invalid">{addProblem}</p>}
    {ghostDuplicate && <p className="ws-report is-bad" data-add="duplicate">
      A {pitchName(addMode.pitch)} already starts here.
      <button type="button" data-select-existing aria-label="Select existing"
        onClick={() => { if (ghostDuplicateId) onSelectExisting(ghostDuplicateId); }}>Select existing</button>
    </p>}
  </section>;
}
