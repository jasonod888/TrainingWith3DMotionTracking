/**
 * Settings drawer for the music review workspace.
 *
 * Presentation only: drawer visibility, settings tab, sidecar drafts, chord shapes,
 * alignment authoring commands and verification state stay owned by the composition
 * root and its typed controllers. The source `<video>` stays mounted in the root's
 * persistent picture-in-picture host; this drawer only shows its controls, so opening
 * or closing settings never remounts source media.
 */
import type {ReactNode} from 'react';
import type {ChunkBarsOption, PracticeChunk} from '../practice-chunks';
import type {SavedGuitarChord} from './save-payload';
import type {HandModelStatus} from './useHandAssignments';

export type ReviewSettingsTab = 'view' | 'editing' | 'lesson' | 'timing' | 'more';
type SectionDraft = {id: string; label: string; start: number; end: number};
type AnchorDraft = {seconds: number; tick: number};
type HistorySummary = {
  undoSteps: number; redoSteps: number; undoBytes: number; redoBytes: number;
  totalBytes: number; evicted: boolean;
};

const SNAP_CHOICES = [
  {label: 'Off', ticks: 0},
  {label: '1/4', ticks: 480},
  {label: '1/8', ticks: 240},
  {label: '1/16', ticks: 120},
];

export type MusicReviewSettingsProps = {
  isPractice: boolean;
  noteInspector: ReactNode;

  // Playback & view
  follow: boolean;
  onFollowChange: (value: boolean) => void;
  chunkBars: ChunkBarsOption;
  onChunkBarsChange: (value: ChunkBarsOption) => void;
  chunkPickerOpen: boolean;
  chunks: readonly PracticeChunk[];
  activeChunkIndex: number;
  onSelectChunk: (index: number) => void;
  onSeek: (seconds: number) => void;
  handStatus: HandModelStatus;
  handModelInfo: {name: string; version: string; sha256: string} | null;
  onRefreshHands: () => void;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyLocked: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onShowMore: () => void;
  narrowViewport: boolean;
  rate: number;
  onRateChange: (value: number) => void;
  onZoom: (factor: number) => void;
  zoomFactor: number;
  windowSpan: number;
  visibleSpan: number | null;
  embedded: boolean;
  playhead: number;
  duration: number;
  onSourceClockChange: (seconds: number) => void;
  alignmentMode: string | null;
  playheadTick: number | null;
  ticksPerSecond: number | null;
  explanationCount: number;
  spansCount: number;
  heldPassage: boolean;
  outsideScore: boolean;

  // Editing & timing
  snapTicks: number;
  onSnapTicksChange: (ticks: number) => void;
  offsetSeconds: number;
  onOffsetSecondsChange: (seconds: number) => void;
  diff: {changed: number; added: number; removed: number} | null;

  // Guitar
  guitar: boolean;
  guitarTone: number;
  onGuitarToneChange: (program: number) => void;
  guitarHandedness: 'right' | 'left';
  onGuitarHandednessChange: (value: 'right' | 'left') => void;
  rollMode: 'pitch' | 'strings';
  onRollModeChange: (mode: 'pitch' | 'strings') => void;
  staffMode: 'grand' | 'guitar-tab' | 'guitar-both';
  onStaffModeChange: (mode: 'grand' | 'guitar-tab' | 'guitar-both') => void;

  // Sound
  audioMode: 'original' | 'piano';
  onAudioModeChange: (mode: 'original' | 'piano') => void;
  pianoDisabled: boolean;
  pianoTitle: string;
  verifiedPreview: boolean;
  hasWebAudio: boolean;
  preferRenderedWav: boolean;
  onPreferRenderedWavChange: (value: boolean) => void;
  liveMidiBytes: Uint8Array | null;
  onExportMidi: () => void;

  // Reference video
  videoUrl: string | null;
  pipOpen: boolean;
  onTogglePip: () => void;
  verifyingPreview: boolean;
  previewAssetUnavailable: boolean;
  previewError: string | null;
  useWavPreview: boolean;
  previewStale: boolean;

  // Guitar chord shapes
  guitarChords: SavedGuitarChord[];
  onDetectChords: () => void;
  onAddChord: () => void;
  onChordNameChange: (id: string, name: string) => void;
  onChordStartChange: (id: string, start: number) => void;
  onChordFretsChange: (id: string, frets: number[], position: number) => void;
  onRemoveChord: (id: string) => void;
  onNotice: (message: string) => void;

  // Insert
  replaceMode: boolean;
  addMode: boolean;
  onInsertAtPlayhead: (addToChord: boolean) => void;
  onToggleAddMode: () => void;

  // Alignment
  anchors: AnchorDraft[];
  anchorTick: string;
  onAnchorTickChange: (value: string) => void;
  onUseCurrentTick: () => void;
  onPreviewAnchor: () => void;
  onApplyAnchor: () => void;
  canUndoAnchor: boolean;
  canRedoAnchor: boolean;
  onUndoAnchor: () => void;
  onRedoAnchor: () => void;
  onResetAnchors: () => void;
  onRemoveAnchor: (index: number) => void;
  anchorPreview: string;
  alignmentNotice: string;

  // More/history
  formatted: boolean;
  onFormattedPreview: () => void;
  onReopen: () => void;
  onDownloadMusicXml: () => void;
  onDownloadReference: () => void;
  history: HistorySummary;

  // Lesson settings
  sectionsDraft: SectionDraft[];
  onAddSection: () => void;
  onSectionLabelChange: (index: number, label: string) => void;
  onSectionStartChange: (index: number, value: number) => void;
  onSectionEndChange: (index: number, value: number) => void;
  onRemoveSection: (index: number) => void;
  feedbackEnabled: boolean;
  onFeedbackEnabledChange: (value: boolean) => void;
  verificationPanel: ReactNode;
  spans: {start: number; end: number; kind: 'playing' | 'explanation'}[];
};

export function MusicReviewSettings({
  isPractice, noteInspector, follow, onFollowChange, chunkBars,
  onChunkBarsChange, chunkPickerOpen, chunks, activeChunkIndex, onSelectChunk, onSeek,
  handStatus, handModelInfo, onRefreshHands, readOnly, canUndo, canRedo, historyLocked,
  onUndo, onRedo, onShowMore, narrowViewport, rate, onRateChange, onZoom, zoomFactor, windowSpan,
  visibleSpan, embedded, playhead, duration, onSourceClockChange, alignmentMode,
  playheadTick, ticksPerSecond, explanationCount, spansCount, heldPassage, outsideScore,
  snapTicks, onSnapTicksChange, offsetSeconds, onOffsetSecondsChange, diff, guitar,
  guitarTone, onGuitarToneChange, guitarHandedness, onGuitarHandednessChange, rollMode,
  onRollModeChange, staffMode, onStaffModeChange, audioMode, onAudioModeChange,
  pianoDisabled, pianoTitle, verifiedPreview, hasWebAudio, preferRenderedWav,
  onPreferRenderedWavChange, liveMidiBytes, onExportMidi, videoUrl, pipOpen, onTogglePip,
  verifyingPreview, previewAssetUnavailable, previewError, useWavPreview, previewStale,
  guitarChords, onDetectChords, onAddChord, onChordNameChange, onChordStartChange,
  onChordFretsChange, onRemoveChord, onNotice, replaceMode, addMode, onInsertAtPlayhead,
  onToggleAddMode, anchors, anchorTick, onAnchorTickChange, onUseCurrentTick,
  onPreviewAnchor, onApplyAnchor, canUndoAnchor, canRedoAnchor, onUndoAnchor, onRedoAnchor,
  onResetAnchors, onRemoveAnchor, anchorPreview, alignmentNotice, formatted,
  onFormattedPreview, onReopen, onDownloadMusicXml, onDownloadReference, history,
  sectionsDraft, onAddSection, onSectionLabelChange, onSectionStartChange,
  onSectionEndChange, onRemoveSection, feedbackEnabled, onFeedbackEnabledChange,
  verificationPanel, spans,
}: MusicReviewSettingsProps) {
  const shownSpan = visibleSpan ?? windowSpan;
  const spanLabel = `${shownSpan.toFixed(shownSpan < 10 ? 1 : 0)} s visible`;
  return <>
      <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="view">
        <h3>View &amp; playback</h3>
        <div className="ws-row">
          <label className="ws-field ws-inline">
            <span><input type="checkbox" aria-label="Follow playback" checked={follow}
              onChange={event => onFollowChange(event.target.checked)}/> Follow playback</span>
          </label>
        </div>
        <p className="ws-hint" data-space-hint="true">Press Space to play or pause when the workspace has focus. Typing, sliders, buttons and piano keys keep their normal Space behavior.</p>
        {isPractice && <div className="ws-row" data-practice-stops="true">
          <label className="ws-field ws-inline">
            <span>Practice stops</span>
            <select aria-label="Practice stops" value={chunkBars}
              onChange={event => onChunkBarsChange(Number(event.target.value) as ChunkBarsOption)}>
              <option value={0}>Off / Continuous</option>
              <option value={1}>Every 1 bar</option>
              <option value={2}>Every 2 bars (8 beats in 4/4)</option>
              <option value={4}>Every 4 bars</option>
            </select>
          </label>
        </div>}
        {isPractice && chunkPickerOpen && <section className="ws-practice-chunk-picker" data-practice-chunk-picker="true">
          <h3>Practice sections</h3>
          <div className="ws-row">
            {chunks.length > 0 ? chunks.map((chunk, index) => <button key={chunk.index} type="button"
              aria-pressed={activeChunkIndex === index}
              onClick={() => onSelectChunk(index)}>
              {chunk.label} <small>{chunk.start.toFixed(1)}–{chunk.end.toFixed(1)}s</small>
            </button>) : <button type="button" onClick={() => onSeek(0)}>Whole piece</button>}
          </div>
        </section>}
        <section className="ws-hand-legend" data-hands-legend="true" aria-label="Hand estimate legend">
          <h2>Hands</h2>
          <div className="ws-row">
            <span className="ws-hand-swatch hand-left">Left</span>
            <span className="ws-hand-swatch hand-right">Right</span>
            <span className="ws-hand-swatch hand-unassigned">Unknown</span>
          </div>
          <p className="ws-hint" data-hands-status={handStatus}>
            {handStatus === 'loading' ? 'Checking the piano-hand model…'
              : handStatus === 'model' ? 'Model estimate applied; manual choices stay locked.'
              : handStatus === 'too-many' ? 'Musical baseline only: this lesson exceeds the bounded model limit.'
              : handStatus === 'unavailable' ? 'Musical baseline only: the model is unavailable.'
              : 'Musical baseline estimate. Manual choices stay locked.'}
          </p>
          {handModelInfo && <p className="ws-hint" data-hands-model-identity="true">
            midi2hands · {handModelInfo.version.slice(0, 12)} · {handModelInfo.sha256.slice(0, 12)}…
          </p>}
          <p className="ws-hint" data-hands-reliability="true">
            Automatic labels are uncalibrated estimates, not verified pianist truth. Use Left/Right/Unknown in the note editor to lock an override; Auto returns to these estimates.
          </p>
          <button type="button" data-hands-refresh="true" disabled={readOnly || handStatus === 'loading'}
            onClick={onRefreshHands}>Refresh hand estimates</button>
          <p className="ws-hint">Colours are estimates, not verified truth. Blue is left, amber is right, grey-green is unknown; striped means both hands at the same pitch.</p>
        </section>
        {narrowViewport && <div className="ws-row" data-mobile-actions="true">
          <button type="button" onClick={onUndo}
            disabled={readOnly || !canUndo || historyLocked}>Undo</button>
          <button type="button" onClick={onRedo}
            disabled={readOnly || !canRedo || historyLocked}>Redo</button>
          <button type="button" onClick={onShowMore}>More actions</button>
          <label className="ws-field ws-inline"><span>Speed</span>
            <select value={rate} onChange={event => onRateChange(Number(event.target.value))}>
              {[0.5, 0.75, 1].map(value => <option key={value} value={value}>{value}×</option>)}
            </select>
          </label>
        </div>}
        <div className="ws-zoom" role="group" aria-label="Zoom">
          <button type="button" onClick={() => onZoom(1.25)} aria-label="Zoom out">−</button>
          <span className="ws-window-label" data-window-span={shownSpan.toFixed(2)}
            data-shared-zoom={zoomFactor.toFixed(3)}>
            {spanLabel}
          </span>
          <button type="button" onClick={() => onZoom(0.8)} aria-label="Zoom in">+</button>
        </div>
        <label className="ws-field">
          <span>{spansCount ? 'Source clock position' : 'Position'}</span>
          <input type="range" min={0} max={duration} step={0.01} value={playhead}
            aria-label={embedded ? 'Source clock position' : 'Fixture clock'}
            onChange={event => onSourceClockChange(Number(event.target.value))}/>
        </label>
        <span className="ws-alignment" data-alignment-mode={alignmentMode ?? 'none'} data-playhead-tick={playheadTick ?? ''}
          data-ticks-per-second={ticksPerSecond ?? ''}>
          {alignmentMode === 'anchored' ? 'Score alignment anchored' : 'Score alignment estimated'}
          {spansCount > 1 ? ` · ${explanationCount} explanation passage(s)` : ''}
        </span>
        {heldPassage ? <p className="ws-hint" data-held-passage="true">Explanation · score paused</p> : null}
        {outsideScore ? <p className="ws-hint" data-outside-score="true">
          Outside scored passage</p> : null}
      </section>
      <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="editing">
        <h3>Editing &amp; timing</h3>
        <div className="ws-row">
          <label className="ws-field ws-inline">
            <span>Snap</span>
            <select value={snapTicks} onChange={event => onSnapTicksChange(Number(event.target.value))}>
              {SNAP_CHOICES.map(choice => <option key={choice.label} value={choice.ticks}>{choice.label}</option>)}
            </select>
          </label>
          <label className="ws-field ws-inline">
            <span>Offset (s)</span>
            <input type="number" step={0.01} min={-10} max={10} value={offsetSeconds} style={{width: 72}}
              disabled={readOnly}
              aria-label="Sync offset in seconds"
              onChange={event => { if (readOnly) return; onOffsetSecondsChange(Number(event.target.value) || 0); }}/>
          </label>
        </div>
        {diff && <p className="ws-hint">Your changes: {diff.changed} changed · {diff.added} added · {diff.removed} removed</p>}
      </section>
      {guitar && <section className="ws-drawer-section" data-ws-section="settings" data-settings-section="guitar"
        aria-label="Guitar settings">
        <h3>Guitar</h3>
        <label className="ws-field">Guitar sound
          <select aria-label="Guitar sound" value={guitarTone}
            onChange={event => onGuitarToneChange(Number(event.target.value))}>
            <option value={25}>Acoustic Steel</option>
            <option value={24}>Classical Nylon</option>
            <option value={27}>Clean Electric</option>
            <option value={26}>Jazz</option>
          </select>
        </label>
        <label className="ws-field">Fretboard orientation
          <select aria-label="Fretboard orientation" value={guitarHandedness}
            onChange={event => onGuitarHandednessChange(event.target.value === 'left' ? 'left' : 'right')}>
            <option value="right">Right-handed</option>
            <option value="left">Left-handed</option>
          </select>
        </label>
        <div className="ws-row" role="group" aria-label="Guitar stage">
          <button type="button" aria-pressed={rollMode === 'strings'} data-stage-roll="strings"
            onClick={() => onRollModeChange('strings')}>Roll</button>
          <button type="button" aria-pressed={staffMode === 'guitar-tab'} data-stage-compact="tab"
            onClick={() => onStaffModeChange(staffMode === 'guitar-tab' ? 'guitar-both' : 'guitar-tab')}>
            {staffMode === 'guitar-tab' ? 'TAB + Sheet' : 'Compact TAB'}
          </button>
        </div>
        <p className="ws-hint">Guitar notes use the same score, transport and practice engine as piano.</p>
      </section>}
      <section className="ws-drawer-section" data-ws-section="sound" aria-label="Sound">
        <h3>Sound</h3>
        <div className="ws-row" role="group" aria-label="Source audio options">
          <button type="button" aria-pressed={audioMode === 'original'}
            className={audioMode === 'original' ? 'is-active' : ''}
            onClick={() => onAudioModeChange('original')}>Original</button>
          <button type="button" aria-pressed={audioMode === 'piano'}
            className={audioMode === 'piano' ? 'is-active' : ''}
            disabled={pianoDisabled}
            title={pianoTitle}
            onClick={() => onAudioModeChange('piano')}>{guitar ? 'Guitar' : 'Piano'}</button>
        </div>
        {verifiedPreview && hasWebAudio && <div className="ws-row" role="group"
          aria-label="Piano synthesis source" data-piano-source="true">
          <button type="button" aria-pressed={!preferRenderedWav}
            className={!preferRenderedWav ? 'is-active' : ''}
            onClick={() => onPreferRenderedWavChange(false)}>Live grand piano</button>
          <button type="button" aria-pressed={preferRenderedWav}
            className={preferRenderedWav ? 'is-active' : ''}
            onClick={() => onPreferRenderedWavChange(true)}>Rendered WAV</button>
        </div>}
        <div className="ws-row" role="group" aria-label="MIDI export">
          <button type="button" disabled={!liveMidiBytes} onClick={onExportMidi}>Export .mid</button>
        </div>
      </section>
      <section className="ws-drawer-section" data-ws-section="video" aria-label="Reference video">
        <h3>Video</h3>
        {videoUrl
          ? <button type="button" aria-pressed={pipOpen}
              onClick={onTogglePip}>{pipOpen ? 'Hide video' : 'Show video'}</button>
          : <p className="ws-hint">This draft has no source video.</p>}
        <span className="ws-hint" data-preview-state={verifyingPreview ? 'verifying'
          : previewAssetUnavailable ? 'unavailable' : useWavPreview ? 'verified' : 'live'}>
          {guitar
            ? 'Guitar plays live synthesized notes from the score, with the chosen guitar tone across all six strings; Original keeps the video sound.'
            : previewStale
              ? 'Piano preview is stale: the notes changed. Piano plays live synthesized grand piano notes from the edited score, with velocity dynamics and sustain pedal.'
              : verifyingPreview
                ? 'Verifying piano audio… Original plays until it is verified.'
                : previewAssetUnavailable
                  ? `Piano unavailable as a verified WAV: ${previewError ?? 'the audio could not be verified'} Original audio remains active.`
                  : useWavPreview
                    ? 'Verified piano preview follows the video clock; it never free-runs. Choose Live grand piano above for the synthesized performance.'
                    : 'Piano plays live synthesized grand piano notes from the score and performance, with velocity dynamics and sustain pedal; Original keeps the video sound.'}
        </span>
      </section>

      {noteInspector}

      {guitar && <section className="ws-drawer-section" data-ws-section="chords" aria-label="Guitar chord shapes">
        <h2>Chord shapes</h2>
        <div className="ws-row" role="group" aria-label="Chord shape actions">
          <button type="button" data-chord-detect="true" disabled={readOnly}
            onClick={onDetectChords}>Auto-detect from notes</button>
          <button type="button" data-chord-add="true" disabled={readOnly || guitarChords.length >= 100}
            onClick={onAddChord}>Add shape</button>
        </div>
        {guitarChords.length === 0
          ? <p className="ws-hint">No reviewed chord shapes yet. Detect them from the notes or add one at the playhead.</p>
          : <ul className="ws-chord-shape-list" aria-label="Reviewed chord shapes">
            {guitarChords.map(chord => <li key={chord.id} data-chord-shape={chord.id}>
              <label className="ws-field ws-inline"><span>Name</span>
                <input value={chord.name} maxLength={40} disabled={readOnly} aria-label={`Chord ${chord.id} name`}
                  onChange={event => onChordNameChange(chord.id, event.target.value)}
                  onBlur={() => onChordNameChange(chord.id, chord.name.trim() || 'Chord')}/>
              </label>
              <label className="ws-field ws-inline"><span>At (s)</span>
                <input type="number" min={0} step={0.01} value={chord.start} disabled={readOnly}
                  aria-label={`Chord ${chord.id} start`}
                  onChange={event => onChordStartChange(chord.id, Math.max(0, Number(event.target.value)))}/>
              </label>
              <span className="ws-hint" data-chord-frets="true">{chord.frets.map(fret => fret < 0 ? 'x' : fret).join(' ')}</span>
              <label className="ws-field ws-inline"><span>Frets</span>
                <input defaultValue={chord.frets.join(' ')} disabled={readOnly}
                  aria-label={`Chord ${chord.id} frets`} data-chord-frets-input="true"
                  onBlur={event => {
                    const parts = event.target.value.trim().split(/\s+/).map(Number);
                    const positive = parts.filter(fret => fret > 0);
                    if (parts.length === 6 && parts.every(fret => Number.isInteger(fret) && fret >= -1 && fret <= 24)
                      && parts.some(fret => fret >= 0)
                      && (!positive.length || Math.max(...positive) - Math.min(...positive) <= 3)) {
                      onChordFretsChange(chord.id, parts,
                        positive.length ? Math.max(1, Math.min(...positive)) : 1);
                    } else {
                      event.target.value = chord.frets.join(' ');
                      onNotice('Enter six frets (-1 muted, 0 open, 1-24) inside a four-fret span.');
                    }
                  }}/>
              </label>
              <button type="button" disabled={readOnly} aria-label={`Remove chord ${chord.name}`}
                onClick={() => onRemoveChord(chord.id)}>Remove</button>
            </li>)}
          </ul>}
        <p className="ws-hint">Chord shapes are suggestions authored in this editor; they are saved with the guitar reference.</p>
      </section>}

      <section className="ws-drawer-section" data-ws-section="insert" data-settings-section="editing" aria-label="Insert">
        <h2>Insert</h2>
        <div className="ws-row">
          <button type="button" disabled={replaceMode || addMode}
            onClick={() => onInsertAtPlayhead(false)}>Add note at playhead</button>
          <button type="button" disabled={replaceMode || addMode}
            onClick={() => onInsertAtPlayhead(true)}>Add to chord</button>
        </div>
        <div className="ws-row">
          <button type="button" data-add="toggle" aria-pressed={addMode} disabled={replaceMode}
            onClick={onToggleAddMode}>{addMode ? 'Cancel add note' : 'Add note (place)'}</button>
        </div>
        <p className="ws-hint">Insertion is rejected when it would overwrite or collide. “Add to chord” only joins an identical written position.</p>
      </section>
      <section className="ws-drawer-section" data-ws-section="timing" data-settings-section="timing" aria-label="Alignment">
        <fieldset disabled={readOnly} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
          <h2>Alignment</h2>
          <p className="ws-hint" data-aligned={anchors.length > 0 ? 'true' : 'false'}>
            {anchors.length
              ? `Anchored from ${anchors.length} authored point(s); later pitch or velocity edits keep them.`
              : 'Estimated from the tempo and passages. Author an anchor to correct it.'}
          </p>
          <div className="ws-row">
            <button type="button" onClick={onUseCurrentTick}>Use current</button>
            <label className="ws-field ws-inline">
              <span>Tick</span>
              <input value={anchorTick} size={8} aria-label="Anchor tick"
                onChange={event => onAnchorTickChange(event.target.value)}/>
            </label>
            <button type="button" onClick={onPreviewAnchor}>Preview</button>
            <button type="button" onClick={onApplyAnchor}>Apply anchor</button>
          </div>
          <div className="ws-row">
            <button type="button" onClick={onUndoAnchor} disabled={!canUndoAnchor}>Undo point</button>
            <button type="button" onClick={onRedoAnchor} disabled={!canRedoAnchor}>Redo point</button>
            <button type="button" onClick={onResetAnchors} disabled={!anchors.length}>Reset</button>
          </div>
          {anchors.map((anchor, index) => <p className="ws-hint" key={`${anchor.seconds}-${anchor.tick}-${index}`}>
            {anchor.seconds.toFixed(3)} s → tick {anchor.tick}{' '}
            <button type="button" onClick={() => onRemoveAnchor(index)}>Remove</button>
          </p>)}
          {(anchorPreview || alignmentNotice)
            && <p className="ws-report">{anchorPreview || alignmentNotice}</p>}
          <p className="ws-hint">Applied anchors shape the score map and are saved with the review.</p>
        </fieldset>
      </section>
      <section className="ws-drawer-section" data-ws-section="more" data-settings-section="more" aria-label="History and more">
        <h2>More</h2>
        <div className="ws-row">
          <button type="button" data-formatted-toggle="true"
            aria-pressed={formatted}
            onClick={onFormattedPreview} aria-label="Formatted score">Formatted preview</button>
          <button type="button" onClick={onReopen} disabled={replaceMode || addMode}>Reopen saved</button>
          <button type="button" onClick={onDownloadMusicXml}>MusicXML</button>
          <button type="button" onClick={onDownloadReference}>Download reference</button>
        </div>
        <h2>History</h2>
        <p className="ws-hint">
          {history.undoSteps} undo step(s) · {history.redoSteps} redoable ·{' '}
          {(history.totalBytes / 1024).toFixed(1)} KB retained ({history.undoBytes} B undo + {history.redoBytes} B redo){' '}
          {history.evicted ? '· oldest entries dropped' : ''}
        </p>
        <p className="ws-hint">History stores only the notes and events each edit changed; the score is rebuilt on undo.</p>
      </section>
      <section className="ws-drawer-section" data-ws-section="lesson" data-settings-section="lesson">
        <details className="ws-advanced-details" data-lesson-settings="true">
          <summary>Lesson settings, teaching sections and assessment</summary>
          <fieldset disabled={readOnly} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
            <h2>Teaching sections</h2>
            <div className="ws-row">
              <button type="button" data-section-add onClick={onAddSection}>Add section</button>
            </div>
            {sectionsDraft.map((section, index) => <fieldset key={section.id} data-section={section.id} disabled={readOnly}>
              <legend>Section {index + 1}</legend>
              <label className="ws-field"><span>Name</span>
                <input value={section.label} maxLength={80}
                  onChange={event => onSectionLabelChange(index, event.target.value)}/></label>
              <div className="ws-row">
                <label className="ws-field ws-inline"><span>Start (s)</span>
                  <input type="number" step={0.01} min={0} max={section.end - 0.05} value={section.start}
                    onChange={event => onSectionStartChange(index, Number(event.target.value))}/></label>
                <label className="ws-field ws-inline"><span>End (s)</span>
                  <input type="number" step={0.01} min={section.start + 0.05} max={duration} value={section.end}
                    onChange={event => onSectionEndChange(index, Number(event.target.value))}/></label>
                {sectionsDraft.length > 1 && <button type="button" onClick={() => onRemoveSection(index)}>Remove</button>}
              </div>
            </fieldset>)}
            <h2>Feedback</h2>
            <label className="review-checkbox ws-field ws-inline">
              <input type="checkbox" checked={feedbackEnabled} data-feedback-enabled
                disabled={readOnly}
                onChange={event => onFeedbackEnabledChange(event.target.checked)}/> Enable practice feedback
            </label>
            <p className="ws-hint" data-assessment-policy="notes">When enabled, reviewed piano and guitar references offer local pitch-and-timing feedback. Guitar uses sounding pitch only; scoring stays experimental and withheld. Turning it off never deletes notes, sections, alignment or the saved reference.</p>
            {verificationPanel}
            <h2>Passages</h2>
            <p className="ws-hint">Playing passages carry score time; explanation passages are held and reject insertion.</p>
            {spans.map((span, index) => <div className="ws-row" key={`${index}-${span.start}`} data-passage={index}>
              <select aria-label={`Passage ${index + 1} kind`} value={span.kind}
                onChange={() => onNotice('Passage changes would move the existing notation. '
                  + 'This edit was not applied; adjust the alignment instead of relabelling a passage that already carries notes.')}>
                <option value="playing">Playing</option>
                <option value="explanation">Explanation</option>
              </select>
              <label className="ws-field ws-inline"><span>Start</span>
                <input type="number" step={0.01} value={span.start}
                  onChange={() => onNotice('Passage boundary changes would move the existing notation and were not applied.')}/></label>
              <label className="ws-field ws-inline"><span>End</span>
                <input type="number" step={0.01} value={span.end}
                  onChange={() => onNotice('Passage boundary changes would move the existing notation and were not applied.')}/></label>
              {spans.length > 1 && <button type="button" onClick={() => onNotice('Passages cannot be removed while they carry scored notes.')}>Remove</button>}
            </div>)}
            <div className="ws-row"><button type="button"
              onClick={() => onNotice('Adding a passage to a scored clip is not supported yet; it would overlap existing score time.')}>
              Add passage</button></div>
            <p className="ws-hint" data-passage-rejected="true">Passage kind and boundary edits are validated against the existing map and
              currently rejected rather than silently re-timing engraved notes.</p>
            <p className="ws-hint">Verification decisions from the proposal remain server-authoritative; a changed verification state is reported as a conflict instead of being overwritten.</p>
          </fieldset>
        </details>
      </section>
    </>;
}
