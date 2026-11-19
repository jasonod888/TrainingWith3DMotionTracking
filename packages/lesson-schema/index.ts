export type Section = { id: string; label: string; start: number; end: number };
export type SectionSet = { id: string; revision: number; duration: number; sections: Section[] };
export type Asset = { key: string; mime: string; bytes: number; sha256: string };
export type LessonManifest = {
  schema_version: 1; lesson_id: string; revision_id: string; title: string;
  duration: number; source_start: number; standing_time: number;
  animation_start?: number; animation_duration?: number | null; frame_rate?: number;
  engine: 'sam-3d-body' | 'mediapipe' | 'synthetic'; engine_version: string;
  units: 'metres'; landmark_axes: 'x-right/y-down/z-forward';
  root_motion: 'estimated-camera-relative' | 'hip-relative' | 'in-place' | 'floor-guided';
  confidence: 'unmeasured' | 'measured'; animation: Asset | null; landmarks: Asset | null;
  source_video: Asset | null; thumbnail: Asset | null; section_set: SectionSet; warnings: string[];
  focused_video?: Asset | null;
  focused_video_start?: number | null;
  /** Transparent VP9 companion to `focused_video`, for camera compositing only. */
  focused_video_alpha?: Asset | null;
  presentation?: Partial<Record<'male' | 'female' | 'report', Asset>>;
  /** Creator-controlled practice feedback. Missing means legacy availability. */
  feedback_enabled?: boolean | null;
};

export function validateSections(sections: Section[], duration: number): Section[] {
  if (!Number.isFinite(duration) || duration <= 0 || !sections.length) throw new Error('A lesson needs at least one section.');
  let end = 0;
  const ids = new Set<string>();
  for (const s of sections) {
    if (!s.id || ids.has(s.id) || !s.label.trim() || s.label.length > 80 || !Number.isFinite(s.start) || !Number.isFinite(s.end) || Math.abs(s.start-end)>1e-6 || s.end-s.start<.05-1e-9) throw new Error('Sections must cover the lesson without gaps or overlaps.');
    ids.add(s.id); end=s.end;
  }
  if (Math.abs(end-duration)>1e-6) throw new Error('The final section must end with the lesson.');
  return sections.map(s=>({...s}));
}

export function splitSection(sections: Section[], duration: number, time: number, id: string): Section[] {
  const draft=validateSections(sections,duration);
  const index=draft.findIndex(s=>time-s.start>=.05 && s.end-time>=.05);
  if (index<0) throw new Error('Move away from the section edge to split.');
  const current=draft[index];
  draft.splice(index,1,{...current,end:time},{id,label:`${current.label.slice(0,70)} · part 2`,start:time,end:current.end});
  return validateSections(draft,duration);
}

export function mergeNext(sections: Section[], duration: number, index: number): Section[] {
  const draft=validateSections(sections,duration);
  if(index<0 || index>=draft.length-1) throw new Error('Select a section with a following section.');
  draft.splice(index,2,{...draft[index],end:draft[index+1].end});
  return validateSections(draft,duration);
}

// Music contract v2. Deliberately separate from the body manifest: no coordinates,
// standing time, GLB animation or landmarks. Kept as a distinct type so body
// components never have to narrow a union.
export type InstrumentConfig = {
  instrument: 'piano' | 'guitar';
  tuning?: string | null;
  capo?: number | null;
  handedness?: 'right' | 'left' | null;
  reference_pitch_hz?: number | null;
};

export type AssessmentPolicy = {
  rubric_version: string;
  assessment: 'notes' | 'chords' | 'melody' | 'none';
  input_modes: ('midi' | 'microphone' | 'none')[];
  dimensions: ('pitch' | 'timing' | 'release' | 'coverage')[];
};

export type MusicDraftGuitarChord={id:string;name:string;start:number;frets:number[];position:number};
export type MusicDraftEvent={id:string;onset:number;duration:number|null;notation_duration?:number|null;pitch:number;velocity:number|null;confidence:number|null;optional:boolean;string:number|null;fret:number|null};
export type MusicDraftCorrection={finding_id:string;kind:string;applied_at:string;reverted_at?:string|null;
 policy_sha256?:string|null;report_sha256?:string|null;edits:unknown[];event_id?:string;attribute?:string;
 before?:unknown;value?:unknown};
export type MusicPlaybackSettings={sync_offset_seconds:number;revision:number};
export type MusicPedalSpan={onset:number;offset:number;type:'sustain'};
export type MusicDraftView={draft_version:1;draft_id:string;lesson_id:string;title:string;status:'draft'|'reviewed';
 subject:'piano'|'guitar';instrument:InstrumentConfig;duration:number;reference:Asset;source_video:Asset|null;
 piano_preview?:Asset|null;playback?:MusicPlaybackSettings;pedal?:MusicPedalSpan[];preview_identity?:string|null;raw_model?:boolean;correction_operations?:number;feedback_enabled?:boolean|null;
 events:MusicDraftEvent[];spans:{start:number;end:number;kind:'playing'|'explanation'}[];guitar_chords:MusicDraftGuitarChord[];analysis:{key:string;mime:string;bytes:number;sha256:string}|null;warnings:string[];
 baseline_events?:MusicDraftEvent[];working_corrected?:boolean;automatic_corrections?:MusicDraftCorrection[];verification_state_token?:string|null;
 provenance:{adapter:string;engine:string;model:string|null;model_version:string|null;code_version:string;audio_sha256:string;profile_sha256?:string|null}};

export type MusicLessonManifest = {
  schema_version: 2;
  experience_family: 'music';
  lesson_id: string;
  revision_id: string;
  title: string;
  subject: 'piano' | 'guitar';
  duration: number;
  instrument: InstrumentConfig;
  section_set: SectionSet;
  reference: Asset;
  reference_reviewed: true;
  assessment: AssessmentPolicy;
  source_video?: Asset | null;
  preview_video?: Asset | null;
  piano_preview?: Asset | null;
  playback?: MusicPlaybackSettings;
  pedal?: MusicPedalSpan[];
  preview_identity?: string | null;
  waveform?: Asset | null;
  midi_export?: Asset | null;
  public_poster?: Asset | null;
  warnings: string[];
  /** Creator-controlled practice feedback. Missing means legacy availability. */
  feedback_enabled?: boolean | null;
};

export type SummaryCapabilities = {
  preview: boolean;
  practice: boolean;
  live_input: 'camera' | 'midi' | 'microphone' | 'none';
};

export type LessonSubject = 'dance' | 'taekwondo' | 'boxing' | 'piano' | 'guitar' | 'drawing' | 'movement_other';

export type DrawingStep = {
  id: string;
  title: string;
  instruction: string;
  reference_guide?: Asset | null;
  media_role?: 'reference_guide' | 'example' | 'detail' | null;
};

/** Discriminated drawing document. Never a body or music manifest. */
export type DrawingLessonManifest = {
  schema_version: 3;
  experience_family: 'visual';
  lesson_id: string;
  revision_id: string;
  title: string;
  subject: 'drawing';
  medium: 'pencil' | 'charcoal' | 'digital';
  steps: DrawingStep[];
  assessment: 'none';
  reference_guide?: Asset | null;
  poster?: Asset | null;
  warnings: string[];
  feedback_enabled?: boolean | null;
};

export type LessonSummary = {
  summary_version: 1 | 2;
  lesson_id: string;
  revision_id: string;
  title: string;
  subject: LessonSubject;
  subject_label: string;
  experience_family: 'body' | 'music' | 'visual';
  instrument?: 'piano' | 'guitar' | null;
  duration: number;
  section_count: number;
  poster?: Asset | null;
  capabilities: SummaryCapabilities & {inputs?: string[]};
  /** v2 only: server-authoritative Act and capability ceiling. */
  act_id?: string;
  effective_capabilities?: Record<string, unknown>;
};

/** The only union in the product: a validated loading boundary. */
export type LessonDocument =
  | { kind: 'body'; value: LessonManifest }
  | { kind: 'music'; value: MusicLessonManifest }
  | { kind: 'drawing'; value: DrawingLessonManifest }
  | { kind: 'summary'; value: LessonSummary };
