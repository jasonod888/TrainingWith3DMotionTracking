import {useEffect, useState} from 'react';
import {ArrowLeft, Plus, Trash2} from 'lucide-react';
import type {MusicLessonManifest, Section} from '../../../../packages/lesson-schema/index';
import {parseMusicLessonManifest} from '../../../../packages/lesson-schema/parse';
import {assetUrl, request} from '../api';
import {parseMusicReference, pitchName, type GuitarChord, type MusicReferenceSpan} from './music-reference';
import './music-review.css';

type EditNote = {id: string; onset: number; duration: number | null; pitch: number; optional: boolean;
  velocity: number | null; confidence: number | null; string: number | null; fret: number | null};
const OPEN_STRING: Record<number, number> = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40};
const PAGE = 50;

/** Explicit owner editing of a reviewed lesson; saving creates a new revision but does not release it. */
export function MusicLessonEditor({lessonId, onBack, onSaved}: {
  lessonId: string; onBack: () => void; onSaved: (lesson: MusicLessonManifest) => void;
}) {
  const [manifest, setManifest] = useState<MusicLessonManifest | null>(null);
  const [notes, setNotes] = useState<EditNote[]>([]);
  const [spans, setSpans] = useState<MusicReferenceSpan[]>([]);
  const [chords, setChords] = useState<GuitarChord[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [title, setTitle] = useState('');
  const [policy, setPolicy] = useState<'none' | 'notes'>('none');
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const changed = () => { setConfirmed(false); setNotice(''); };

  useEffect(() => {
    let stopped = false;
    setError('');
    void (async () => {
      const value = await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
        {'X-Lesson-Formats': '1,2'});
      const parsed = parseMusicLessonManifest(value);
      if (!parsed.ok) throw new Error(parsed.message);
      if (parsed.value.schema_version !== 2) throw new Error('Only reviewed music lessons can be edited here.');
      const response = await fetch(assetUrl(parsed.value.reference.key), {credentials: 'same-origin'});
      if (!response.ok) throw new Error('The reviewed reference could not be loaded.');
      const bytes = await response.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map(part => part.toString(16).padStart(2, '0')).join('');
      if (digest !== parsed.value.reference.sha256) throw new Error('The reference does not match its reviewed file.');
      const reference = parseMusicReference(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)));
      if (stopped) return;
      setManifest(parsed.value);
      setTitle(parsed.value.title);
      setNotes(reference.events.map(event => ({id: event.id, onset: event.onset, pitch: event.pitch,
        duration: event.duration, optional: event.optional, velocity: event.velocity, confidence: event.confidence,
        string: event.string, fret: event.fret})));
      setChords(reference.guitarChords);
      setSpans(reference.spans);
      setSections(parsed.value.section_set.sections);
      setPolicy(parsed.value.assessment.assessment === 'notes' ? 'notes' : 'none');
    })().catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The lesson could not be opened.'); });
    return () => { stopped = true; };
  }, [lessonId]);

  const update = (index: number, patch: Partial<EditNote>) => {
    changed();
    setNotes(previous => previous.map((note, position) => position === index ? {...note, ...patch} : note));
  };

  const save = async () => {
    if (!manifest || !confirmed || busy) return;
    if (sections[0]?.start !== 0 || sections[sections.length - 1]?.end !== manifest.duration
      || sections.some((section, index) => index > 0 && section.start !== sections[index - 1].end)) {
      setError('Teaching sections must be contiguous and cover the whole clip.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-revision`, 'POST', {
        base_revision_id: manifest.revision_id,
        title,
        events: notes,
        spans,
        guitar_chords: chords,
        sections,
        assessment: policy === 'notes'
          ? {assessment: 'notes', input_modes: ['midi'], dimensions: ['pitch', 'timing'], rubric_version: 'piano-midi-v1'}
          : {assessment: 'none', input_modes: ['none'], dimensions: [], rubric_version: 'music-watch-v1'},
        confirm_reviewed: true,
      });
      const parsed = parseMusicLessonManifest(result);
      if (!parsed.ok) throw new Error(parsed.message);
      onSaved(parsed.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The new revision could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const passageGap = (() => {
    if (!manifest) return null;
    let cursor = 0;
    for (const span of [...spans].sort((left, right) => left.start - right.start)) {
      if (span.start - cursor >= 0.2) return {start: cursor, end: Math.min(span.start, cursor + 1)};
      cursor = Math.max(cursor, span.end);
    }
    if (manifest.duration - cursor >= 0.2) return {start: cursor, end: Math.min(cursor + 1, manifest.duration)};
    return null;
  })();

  return <section className="music-home music-review" aria-label="Edit reviewed music lesson">
    <button className="back-link" disabled={busy} onClick={onBack}><ArrowLeft size={16}/>Back</button>
    <h1>Edit this music lesson</h1>
    <p className="subtle">Saving creates a new private revision. People who already have access keep the current
      shared version until you choose <strong>Update shared version</strong> on the sharing screen.</p>
    {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
    {!manifest ? !error && <p role="status">Opening the reviewed lesson…</p> : <>
      <label>Lesson title<input maxLength={200} value={title} disabled={busy}
        onChange={event => { changed(); setTitle(event.target.value); }}/></label>
      <fieldset className="music-review-policy"><legend>Assessment</legend>
        <label className="review-checkbox"><input type="radio" name="assessment" checked={policy === 'none'} disabled={busy}
          onChange={() => { changed(); setPolicy('none'); }}/>Watch only — no feedback</label>
        <label className="review-checkbox"><input type="radio" name="assessment" checked={policy === 'notes'}
          disabled={busy || manifest.subject !== 'piano'} onChange={() => { changed(); setPolicy('notes'); }}/>MIDI note feedback (unscored)</label>
        <p className="small muted">Scoring stays disabled. Watch-only remains safe for this milestone.</p>
      </fieldset>
      <h2>Notes</h2>
      <div className="music-review-notes">{notes.slice(page * PAGE, (page + 1) * PAGE).map((note, offset) => {
        const index = page * PAGE + offset;
        return <fieldset key={note.id} disabled={busy}><legend>Note {index + 1}</legend>
          <label>Note<select aria-label={`Note ${index + 1} pitch`} value={note.pitch}
            onChange={event => update(index, {pitch: Number(event.target.value), string: null, fret: null})}>
            {Array.from({length: 128}, (_, pitch) => <option key={pitch} value={pitch}>{pitchName(pitch)}</option>)}
          </select></label>
          {manifest.subject === 'guitar' && <>
            <label>String<select aria-label={`Note ${index + 1} string`} value={note.string ?? ''}
              onChange={event => {
                const string = event.target.value === '' ? null : Number(event.target.value);
                update(index, string === null ? {string: null, fret: null}
                  : {string, fret: note.fret ?? 0, pitch: OPEN_STRING[string] + (note.fret ?? 0)});
              }}>
              <option value="">Not reviewed</option>
              {[6, 5, 4, 3, 2, 1].map(string => <option key={string} value={string}>{string} ({pitchName(OPEN_STRING[string])})</option>)}
            </select></label>
            <label>Fret<input aria-label={`Note ${index + 1} fret`} type="number" min={0} max={12}
              value={note.fret ?? ''} disabled={note.string === null}
              onChange={event => {
                if (note.string === null) return;
                const fret = Math.max(0, Math.min(12, Number(event.target.value) || 0));
                update(index, {fret, pitch: OPEN_STRING[note.string] + fret});
              }}/></label>
          </>}
          <label>Start (seconds)<input aria-label={`Note ${index + 1} start`} type="number" min={0} max={manifest.duration}
            step="any" value={note.onset} onChange={event => update(index, {onset: Number(event.target.value)})}/></label>
          <label>Length (seconds)<input aria-label={`Note ${index + 1} length`} type="number" min={0.001} max={manifest.duration}
            step="any" value={note.duration ?? ''} onChange={event => update(index, {duration: event.target.value === '' ? null : Number(event.target.value)})}/></label>
          <label className="review-checkbox"><input type="checkbox" checked={note.optional}
            onChange={event => update(index, {optional: event.target.checked})}/>Optional</label>
          <button type="button" onClick={() => { changed(); setNotes(previous => previous.filter((_, position) => position !== index)); }}>
            <Trash2 size={14}/>Remove note {index + 1}</button>
        </fieldset>;
      })}</div>
      <div className="music-review-actions">
        <button type="button" disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>Previous notes</button>
        <span>Page {page + 1} of {Math.max(1, Math.ceil(notes.length / PAGE))}</span>
        <button type="button" disabled={busy || (page + 1) * PAGE >= notes.length} onClick={() => setPage(value => value + 1)}>Next notes</button>
        <button type="button" disabled={busy || notes.length >= 20000}
          onClick={() => { changed(); setNotes(previous => [...previous, {id: crypto.randomUUID(), onset: 0,
            duration: Math.min(0.25, manifest.duration), pitch: 60, optional: false, velocity: null, confidence: null,
            string: null, fret: null}]); }}><Plus size={14}/>Add note</button>
      </div>
      <h2>Assessable passages</h2>
      <p className="small muted">Only <strong>playing</strong> passages produce learner corrections. Explanation passages
        are ignored by feedback and timing comparison.</p>
      <div className="music-review-notes">{spans.map((span, index) => <fieldset key={index} disabled={busy}>
        <legend>Passage {index + 1}</legend>
        <label>Start (seconds)<input aria-label={`Passage ${index + 1} start`} type="number" min={0} max={manifest.duration}
          step="any" value={span.start} onChange={event => { changed(); setSpans(previous => previous.map((item, position) => position === index ? {...item, start: Number(event.target.value)} : item)); }}/></label>
        <label>End (seconds)<input aria-label={`Passage ${index + 1} end`} type="number" min={0} max={manifest.duration}
          step="any" value={span.end} onChange={event => { changed(); setSpans(previous => previous.map((item, position) => position === index ? {...item, end: Number(event.target.value)} : item)); }}/></label>
        <label>Kind<select aria-label={`Passage ${index + 1} kind`} value={span.kind}
          onChange={event => { changed(); setSpans(previous => previous.map((item, position) => position === index ? {...item, kind: event.target.value as 'playing' | 'explanation'} : item)); }}>
          <option value="playing">Playing</option><option value="explanation">Explanation</option>
        </select></label>
        <button type="button" onClick={() => { changed(); setSpans(previous => previous.filter((_, position) => position !== index)); }}><Trash2 size={14}/>Remove passage {index + 1}</button>
      </fieldset>)}</div>
      <button type="button" disabled={busy || spans.length >= 500 || !passageGap}
        onClick={() => { if (!passageGap) return; changed(); setSpans(previous => [...previous,
          {...passageGap, kind: 'playing' as const}]); }}><Plus size={14}/>Add passage</button>
      {!passageGap && <p className="small muted">No gap available; adjust existing passage boundaries to add another.</p>}
      {manifest.subject === 'guitar' && <>
        <h2>Reviewed chord shapes</h2>
        <p className="small muted">Order strings low E to high E; use -1 for muted and 0 for open. These shapes render exactly as reviewed.</p>
        {chords.map((chord, index) => <fieldset key={chord.id} disabled={busy}><legend>Chord {index + 1}</legend>
          <label>Name<input aria-label={`Chord ${index + 1} name`} maxLength={40} value={chord.name}
            onChange={event => { changed(); setChords(previous => previous.map((item, position) => position === index ? {...item, name: event.target.value} : item)); }}/></label>
          <label>Start (seconds)<input aria-label={`Chord ${index + 1} start`} type="number" min={0} max={manifest.duration} step="any" value={chord.start}
            onChange={event => { changed(); setChords(previous => previous.map((item, position) => position === index ? {...item, start: Number(event.target.value)} : item)); }}/></label>
          <label>Base position<input aria-label={`Chord ${index + 1} position`} type="number" min={1} max={9} value={chord.position}
            onChange={event => { changed(); setChords(previous => previous.map((item, position) => position === index ? {...item, position: Math.max(1, Math.min(9, Number(event.target.value) || 1))} : item)); }}/></label>
          {chord.frets.map((fret, string) => <label key={string}>{['low E', 'A', 'D', 'G', 'B', 'high E'][string]}
            <input aria-label={`Chord ${index + 1} fret ${string + 1}`} type="number" min={-1} max={12} value={fret}
              onChange={event => { changed(); setChords(previous => previous.map((item, position) => position === index
                ? {...item, frets: item.frets.map((value, slot) => slot === string ? Math.max(-1, Math.min(12, Number(event.target.value))) : value)} : item)); }}/></label>)}
          <button type="button" onClick={() => { changed(); setChords(previous => previous.filter((_, position) => position !== index)); }}><Trash2 size={14}/>Remove chord {index + 1}</button>
        </fieldset>)}
        <button type="button" disabled={busy || chords.length >= 100} onClick={() => { changed(); setChords(previous => [...previous,
          {id: crypto.randomUUID(), name: 'C', start: 0, frets: [-1, 3, 2, 0, 1, 0], position: 1}]); }}><Plus size={14}/>Add chord</button>
      </>}
      <h2>Teaching sections</h2>
      {sections.map((section, index) => <fieldset key={section.id} disabled={busy}><legend>Section {index + 1}</legend>
        <label>Section name<input maxLength={80} value={section.label}
          onChange={event => { changed(); setSections(previous => previous.map((item, position) => position === index ? {...item, label: event.target.value} : item)); }}/></label>
        <span>{section.start.toFixed(2)}–{section.end.toFixed(2)} seconds</span>
        {index < sections.length - 1 && <label>Boundary (seconds)<input type="number" step="any" min={section.start + 0.05}
          max={sections[index + 1].end - 0.05} value={section.end}
          onChange={event => { changed(); const boundary = Number(event.target.value); setSections(previous => previous.map((item, position) => position === index ? {...item, end: boundary} : position === index + 1 ? {...item, start: boundary} : item)); }}/></label>}
      </fieldset>)}
      <button type="button" disabled={busy || sections.length >= 500} onClick={() => { changed(); setSections(previous => {
        const last = previous[previous.length - 1]; const middle = (last.start + last.end) / 2;
        return [...previous.slice(0, -1), {...last, end: middle}, {id: crypto.randomUUID(), label: `Section ${previous.length + 1}`, start: middle, end: last.end}];
      }); }}><Plus size={14}/>Add section</button>
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      <label className="review-checkbox"><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={event => setConfirmed(event.target.checked)}/>I have checked the notes, passages and sections against the instructor material.</label>
      <button className="primary" disabled={busy || !confirmed} onClick={() => void save()}>
        {busy ? 'Saving new revision…' : 'Save new revision'}
      </button>
    </>}
  </section>;
}

export default MusicLessonEditor;
