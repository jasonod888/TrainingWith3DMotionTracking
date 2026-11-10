/** Runtime reader for reviewed music references and guide geometry, free of DOM APIs. */
export type MusicReferenceEvent = {
  id: string;
  onset: number;
  duration: number | null;
  pitch: number;
  velocity: number | null;
  confidence: number | null;
  optional: boolean;
  string: number | null;
  fret: number | null;
};
export type MusicReferenceSpan = {start: number; end: number; kind: 'playing' | 'explanation'};
export type GuitarChord = {id: string; name: string; start: number; frets: number[]; position: number};
export type MusicReview = {
  reviewer_id: string;
  reviewed_at: string;
  draft_id: string;
  source_reference_sha256: string;
};
export type MusicReference = {
  reference_version: 1;
  subject: 'piano' | 'guitar';
  instrument: Record<string, unknown>;
  duration: number;
  events: MusicReferenceEvent[];
  spans: MusicReferenceSpan[];
  guitarChords: GuitarChord[];
  review: MusicReview;
};

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const GUITAR_STRINGS: {label: string; pitch: number}[] = [
  {label: 'E2', pitch: 40}, {label: 'A2', pitch: 45}, {label: 'D3', pitch: 50},
  {label: 'G3', pitch: 55}, {label: 'B3', pitch: 59}, {label: 'E4', pitch: 64},
];
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function pitchName(pitch: number): string {
  return `${NOTES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The reference has an invalid ${name}.`);
  return value;
}

export function parseMusicReference(value: unknown): MusicReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The reviewed reference is not a document.');
  const document = value as Record<string, unknown>;
  if (document.reference_version !== 1) throw new Error('This reviewed reference has an unsupported version.');
  if (document.subject !== 'piano' && document.subject !== 'guitar') throw new Error('The reviewed reference has an unknown instrument.');
  const duration = finite(document.duration, 'duration');
  if (duration <= 0) throw new Error('The reviewed reference has no duration.');
  if (!Array.isArray(document.spans)) throw new Error('The reviewed reference has no passages.');
  if (document.spans.length > 500) throw new Error('The reviewed reference has too many passages.');
  const spans = document.spans.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('The reviewed reference has an invalid passage.');
    const item = raw as Record<string, unknown>;
    const start = finite(item.start, `passage ${index + 1} start`);
    const end = finite(item.end, `passage ${index + 1} end`);
    if (start < 0 || end <= start || end > duration + 1e-6) throw new Error('A reviewed passage is outside the clip.');
    const rawKind = item.kind == null ? 'playing' : item.kind;
    if (rawKind !== 'playing' && rawKind !== 'explanation') throw new Error('A reviewed passage has an unknown kind.');
    return {start, end, kind: rawKind as 'playing' | 'explanation'};
  });
  const orderedSpans = [...spans].sort((left, right) => left.start - right.start);
  for (let index = 1; index < orderedSpans.length; index += 1) {
    if (orderedSpans[index].start < orderedSpans[index - 1].end - 1e-6) {
      throw new Error('Reviewed passages must not overlap.');
    }
  }
  if (!Array.isArray(document.events)) throw new Error('The reviewed reference has no notes.');
  if (document.events.length > 20000) throw new Error('The reviewed reference has too many notes.');
  const seen = new Set<string>();
  const events = document.events.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('The reviewed reference has an invalid note.');
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id || id.length > 80) throw new Error(`Note ${index + 1} has an invalid id.`);
    if (seen.has(id)) throw new Error(`The reviewed reference repeats note id ${id}.`);
    seen.add(id);
    const onset = finite(item.onset, `note ${id} start`);
    const pitch = finite(item.pitch, `note ${id} pitch`);
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error(`Note ${id} has an invalid pitch.`);
    if (onset < 0 || onset > duration + 1e-6) throw new Error(`Note ${id} starts outside the clip.`);
    const length = item.duration == null ? null : finite(item.duration, `note ${id} length`);
    if (length !== null && (length <= 0 || onset + length > duration + 1e-6)) throw new Error(`Note ${id} ends outside the clip.`);
    const velocity = item.velocity == null ? null : finite(item.velocity, `note ${id} velocity`);
    if (velocity !== null && (velocity < 0 || velocity > 1)) throw new Error(`Note ${id} has an invalid velocity.`);
    const confidence = item.confidence == null ? null : finite(item.confidence, `note ${id} confidence`);
    if (confidence !== null && (confidence < 0 || confidence > 1)) throw new Error(`Note ${id} has an invalid confidence.`);
    if(item.optional!=null&&typeof item.optional!=='boolean')throw new Error('A note has an invalid optional flag.');
    const string = item.string == null ? null : finite(item.string, `note ${id} string`);
    const fret = item.fret == null ? null : finite(item.fret, `note ${id} fret`);
    if ((string === null) !== (fret === null)) throw new Error(`Note ${id} needs both string and fret.`);
    if (string !== null && (!Number.isInteger(string) || string < 1 || string > 6 || !Number.isInteger(fret) || fret! < 0 || fret! > 12)) {
      throw new Error(`Note ${id} has an invalid reviewed position.`);
    }
    if (string !== null && ({1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40} as Record<number, number>)[string] + fret! !== pitch) {
      throw new Error(`Note ${id} position does not match its pitch in standard tuning.`);
    }
    return {id, onset, duration: length, pitch, velocity, confidence, optional: item.optional === true, string, fret};
  }).sort((left, right) => left.onset - right.onset || left.pitch - right.pitch);
  const guitarChords: GuitarChord[] = Array.isArray(document.guitar_chords) ? document.guitar_chords.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('The reference has an invalid chord.');
    const item = raw as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || id.length > 80 || !name || name.length > 40) throw new Error('A reviewed chord has an invalid name.');
    const start = finite(item.start, `chord ${name} start`);
    if (start < 0 || start > duration + 1e-6) throw new Error('A reviewed chord starts outside the clip.');
    if (!Array.isArray(item.frets) || item.frets.length !== 6) throw new Error('A reviewed chord needs six string frets.');
    const frets = item.frets.map((value: unknown) => finite(value, `chord ${name} fret`));
    if (frets.some(value => !Number.isInteger(value) || value < -1 || value > 12) || !frets.some(value => value >= 0)) {
      throw new Error('A reviewed chord has invalid frets.');
    }
    const position = item.position == null ? 1 : finite(item.position, `chord ${name} position`);
    if (!Number.isInteger(position) || position < 1 || position > 9) throw new Error('A reviewed chord has an invalid base position.');
    if (frets.some(fret => fret > 0 && (fret < position || fret > position + 3))) throw new Error('A reviewed chord does not fit its base position.');
    return {id, name, start, frets, position};
  }) : [];
  if (new Set(guitarChords.map(chord => chord.id)).size !== guitarChords.length) throw new Error('Reviewed chord ids must be unique.');
  let review: MusicReview;
  if (document.review != null && !Array.isArray(document.review)) {
    if (typeof document.review !== 'object') throw new Error('The reviewed reference has invalid review evidence.');
    const raw = document.review as Record<string, unknown>;
    if (typeof raw.reviewer_id !== 'string' || typeof raw.reviewed_at !== 'string'
      || typeof raw.draft_id !== 'string' || typeof raw.source_reference_sha256 !== 'string') {
      throw new Error('The reviewed reference has incomplete review evidence.');
    }
    if(!raw.reviewer_id||raw.reviewer_id.length>80||!raw.draft_id||raw.draft_id.length>80||!Number.isFinite(Date.parse(raw.reviewed_at))||! /^[a-f0-9]{64}$/.test(raw.source_reference_sha256))throw new Error('The reviewed reference has invalid review evidence.');
    review = {
      reviewer_id: raw.reviewer_id, reviewed_at: raw.reviewed_at,
      draft_id: raw.draft_id, source_reference_sha256: raw.source_reference_sha256,
    };
  }
  else throw new Error('The reviewed reference has no review evidence.');
  if(!document.instrument||typeof document.instrument!=='object'||Array.isArray(document.instrument)||(document.instrument as Record<string,unknown>).instrument!==document.subject)throw new Error('The reference instrument does not match its subject.');
  return {reference_version: 1, subject: document.subject, instrument: {...document.instrument as Record<string, unknown>},
    duration, events, spans, guitarChords, review};
}

export function eventDuration(event: MusicReferenceEvent): number {
  return event.duration && event.duration > 0 ? event.duration : 0.25;
}

/** Notes sounding at a moment; the window keeps short notes visible between frames. */
export function activeEvents(reference: MusicReference, time: number, window = 0): MusicReferenceEvent[] {
  return reference.events.filter(event => time >= event.onset - window && time < event.onset + eventDuration(event) + window);
}

export function currentSpan(reference: MusicReference, time: number): MusicReferenceSpan | null {
  return reference.spans.find(span => time >= span.start && time < span.end) ?? null;
}

export type PianoKey = {pitch: number; whiteIndex: number; black: boolean; left: number};
export type PianoGeometry = {whiteKeys: PianoKey[]; blackKeys: PianoKey[]; low: number; high: number; width: number};

/** Keyboard geometry in white-key units; pitches outside the clip's range are not drawn. */
export function pianoGeometry(events: MusicReferenceEvent[], padding = 2): PianoGeometry {
  const pitches = events.map(event => event.pitch).filter(pitch=>pitch>=21&&pitch<=108);
  let low = pitches.length ? Math.min(...pitches) : 60;
  let high = pitches.length ? Math.max(...pitches) : 72;
  low = Math.max(21, low - padding);
  high = Math.min(108, high + padding);
  while (!WHITE.has(low % 12) && low > 21) low -= 1;
  while (!WHITE.has(high % 12) && high < 108) high += 1;
  const whiteKeys: PianoKey[] = [];
  const blackKeys: PianoKey[] = [];
  let whiteIndex = 0;
  for (let pitch = low; pitch <= high; pitch += 1) {
    if (WHITE.has(pitch % 12)) {
      whiteKeys.push({pitch, whiteIndex, black: false, left: whiteIndex});
      whiteIndex += 1;
    } else {
      const previousWhite = whiteIndex - 1;
      blackKeys.push({pitch, whiteIndex, black: true, left: previousWhite + 1});
    }
  }
  return {whiteKeys, blackKeys, low, high, width: whiteIndex};
}

export type GuitarPosition = {string: number; fret: number; label: string};
/** Standard tuning, lowest fret wins; positions beyond the twelfth fret are not drawn. */
export function guitarPosition(pitch: number): GuitarPosition | null {
  let best: GuitarPosition | null = null;
  GUITAR_STRINGS.forEach((string, index) => {
    const fret = pitch - string.pitch;
    if (fret < 0 || fret > 12) return;
    if (!best || fret < best.fret) best = {string: index + 1, fret, label: string.label};
  });
  return best;
}

export const GUITAR_STRING_LABELS = GUITAR_STRINGS.map(string => string.label);


export function bindMusicReference(reference:MusicReference,lesson:{subject:string;duration:number;instrument:unknown}):MusicReference{
 if(reference.subject!==lesson.subject||Math.abs(reference.duration-lesson.duration)>1e-6||
   JSON.stringify(reference.instrument)!==JSON.stringify(lesson.instrument)){
  // Compare normalized optional settings as the manifest may include null fields.
  const fields=['instrument','tuning','capo','handedness','reference_pitch_hz'];
  const actual=lesson.instrument as Record<string,unknown>;
  if(reference.subject!==lesson.subject||Math.abs(reference.duration-lesson.duration)>1e-6||fields.some(key=>(reference.instrument[key]??null)!==(actual[key]??null)))throw new Error('The reference does not match this lesson. Reopen it from your library.');
 }
 return reference;
}
export function supportsGuitarDiagram(instrument:Record<string,unknown>):boolean{
 const tuning=String(instrument.tuning??'').trim().toUpperCase().replace(/[, -]+/g,' ');
 return (!instrument.capo)&&(!tuning||tuning==='STANDARD'||tuning==='E2 A2 D3 G3 B3 E4');
}
