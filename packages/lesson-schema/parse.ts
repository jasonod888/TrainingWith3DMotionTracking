/**
 * Runtime readers for the lesson boundary.
 *
 * The application never trusts a cast at a network boundary. These validators are
 * hand-written beside the existing section validators so the browser bundle does
 * not grow a schema-validation dependency. Each returns a typed value or a
 * structured error a caller can show a person.
 *
 * They are intentionally as strict as the server contracts: unknown fields, missing
 * required fields, unsafe asset keys and out-of-range values are refused rather than
 * passed through to a component that assumes a well-formed lesson.
 */
import {validateSections} from './index';
import type {
  AssessmentPolicy, Asset, InstrumentConfig, LessonDocument, LessonManifest, LessonSummary,
  MusicLessonManifest, MusicDraftView, MusicDraftEvent, Section, SectionSet, SummaryCapabilities,
} from './index';

export type ParseErrorCode = 'malformed' | 'unsupported_format';
export type ParseFailure = {ok: false; code: ParseErrorCode; message: string};
export type ParseSuccess<T> = {ok: true; value: T};
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

const failure = (code: ParseErrorCode, message: string): ParseFailure => ({ok: false, code, message});
const malformed = (message: string) => failure('malformed', message);
const unsupported = (message: string) => failure('unsupported_format', message);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isCount = (value: unknown): value is number => isNumber(value) && Number.isInteger(value) && value >= 0;
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

const SUBJECTS = ['dance', 'taekwondo', 'boxing', 'piano', 'guitar', 'movement_other'] as const;
const MUSIC_SUBJECTS = ['piano', 'guitar'] as const;
const BODY_ENGINES = ['sam-3d-body', 'mediapipe', 'synthetic'];
const ROOT_MOTIONS = ['estimated-camera-relative', 'hip-relative', 'in-place', 'floor-guided'];

const BODY_KEYS = new Set([
  'schema_version', 'lesson_id', 'revision_id', 'title', 'duration', 'source_start', 'standing_time',
  'animation_start', 'animation_duration', 'frame_rate', 'engine', 'engine_version', 'units',
  'landmark_axes', 'root_motion', 'confidence', 'animation', 'landmarks', 'source_video',
  'focused_video', 'focused_video_start', 'focused_video_alpha', 'thumbnail', 'section_set',
  'warnings', 'presentation',
  // The public projection adds these two keys to a body manifest.
  'public_tags', 'public_creator',
]);

const MUSIC_KEYS = new Set([
  'schema_version', 'experience_family', 'lesson_id', 'revision_id', 'title', 'subject', 'duration',
  'instrument', 'section_set', 'reference', 'reference_reviewed', 'assessment',
  'source_video', 'preview_video', 'waveform', 'midi_export', 'public_poster', 'warnings',
]);

const SUMMARY_KEYS = new Set([
  'summary_version', 'lesson_id', 'revision_id', 'title', 'subject', 'subject_label',
  'experience_family', 'instrument', 'duration', 'section_count', 'poster', 'capabilities',
]);

const ASSET_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/;
const safeKey = (key: string): boolean =>
  ASSET_KEY.test(key) && !key.split('/').some(part => part === '' || part === '.' || part === '..');

const MAX_ID = 80;
const MAX_TITLE = 200;
const MAX_LABEL = 80;
const MAX_TUNING = 40;
const isId = (value: unknown): value is string => isText(value) && value.length <= MAX_ID;
const isTitle = (value: unknown): value is string => isText(value) && value.length <= MAX_TITLE;
const isLabel = (value: unknown): value is string => isText(value) && value.length <= MAX_LABEL;
const VIDEO_MIMES = ['video/mp4', 'video/webm'];
const MIDI_MIMES = ['audio/midi', 'audio/mid', 'application/x-midi'];
const isVideo = (asset: Asset): boolean => VIDEO_MIMES.includes(asset.mime);
const isImage = (asset: Asset): boolean => asset.mime.startsWith('image/');

/** Optional assets are validated once and returned as null when absent. */
type OptionalAsset = Asset | null | undefined;

function readAsset(value: unknown): Asset | null | undefined {
  if (value === null) return null;
  if (value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const {key, mime, bytes, sha256} = value;
  if (!isText(key) || !safeKey(key) || !isText(mime) || !isNumber(bytes) || bytes < 0) return undefined;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) return undefined;
  return {key, mime, bytes, sha256};
}

function readSections(value: unknown, duration: number): Section[] | undefined {
  if (!isRecord(value)) return undefined;
  const {sections} = value;
  if (!Array.isArray(sections) || sections.length === 0) return undefined;
  const parsed: Section[] = [];
  for (const section of sections) {
    if (!isRecord(section)) return undefined;
    const {id, label, start, end} = section;
    if (!isId(id) || !isLabel(label) || !isNumber(start) || !isNumber(end)) return undefined;
    parsed.push({id, label, start, end});
  }
  try {
    return validateSections(parsed, duration);
  } catch {
    return undefined;
  }
}

function readSectionSet(value: unknown, duration: number): SectionSet | undefined {
  if (!isRecord(value)) return undefined;
  const {id, revision, duration: declared} = value;
  if (!isText(id) || !isCount(revision) || revision < 1) return undefined;
  if (declared !== undefined && (!isNumber(declared) || Math.abs(declared - duration) > 1e-6)) return undefined;
  const sections = readSections(value, duration);
  return sections ? {id, revision, duration, sections} : undefined;
}

function readInstrument(value: unknown): InstrumentConfig | undefined {
  if (!isRecord(value)) return undefined;
  const {instrument, tuning, capo, handedness, reference_pitch_hz} = value;
  if (instrument !== 'piano' && instrument !== 'guitar') return undefined;
  if (!Object.keys(value).every(key => ['instrument', 'tuning', 'capo', 'handedness', 'reference_pitch_hz'].includes(key))) return undefined;
  const config: InstrumentConfig = {instrument};
  if (tuning !== undefined && tuning !== null) {
    if (!isText(tuning) || tuning.length > MAX_TUNING) return undefined;
    config.tuning = tuning;
  }
  if (capo !== undefined && capo !== null) {
    if (!isCount(capo) || capo > 12) return undefined;
    config.capo = capo;
  }
  if (handedness !== undefined && handedness !== null) {
    if (handedness !== 'right' && handedness !== 'left') return undefined;
    config.handedness = handedness;
  }
  if (reference_pitch_hz !== undefined && reference_pitch_hz !== null) {
    if (!isNumber(reference_pitch_hz) || reference_pitch_hz <= 0) return undefined;
    config.reference_pitch_hz = reference_pitch_hz;
  }
  return config;
}

function readAssessment(value: unknown): AssessmentPolicy | undefined {
  if (!isRecord(value)) return undefined;
  if (!Object.keys(value).every(key => ['rubric_version', 'assessment', 'input_modes', 'dimensions'].includes(key))) return undefined;
  const {rubric_version, assessment, input_modes, dimensions} = value;
  if (typeof rubric_version !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*-v[0-9]+$/.test(rubric_version)) return undefined;
  if (!['notes', 'chords', 'melody', 'none'].includes(assessment as string)) return undefined;
  if (!Array.isArray(input_modes) || !Array.isArray(dimensions)) return undefined;
  if (input_modes.length === 0) return undefined;
  const modes = input_modes.filter((mode): mode is 'midi' | 'microphone' | 'none' =>
    mode === 'midi' || mode === 'microphone' || mode === 'none');
  const kinds = dimensions.filter((kind): kind is 'pitch' | 'timing' | 'release' | 'coverage' =>
    kind === 'pitch' || kind === 'timing' || kind === 'release' || kind === 'coverage');
  if (modes.length !== input_modes.length || kinds.length !== dimensions.length) return undefined;
  if (new Set(modes).size !== modes.length || new Set(kinds).size !== kinds.length) return undefined;
  if (assessment === 'none' && kinds.length) return undefined;
  if (assessment !== 'none' && !kinds.includes('pitch')) return undefined;
  return {rubric_version, assessment: assessment as AssessmentPolicy['assessment'], input_modes: modes, dimensions: kinds};
}

function readPresentations(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([name, asset]) =>
    ['male', 'female', 'report'].includes(name) && readAsset(asset) !== undefined);
}

/** Body v1. Rejects a v2 payload rather than silently treating it as a body lesson. */
export function parseLessonManifest(value: unknown): ParseResult<LessonManifest> {
  if (!isRecord(value)) return malformed('This lesson could not be read.');
  if (value.schema_version === 2) return unsupported('This lesson needs a newer version of the app.');
  if (value.schema_version !== 1) return unsupported('This lesson format is not supported.');
  if (!Object.keys(value).every(key => BODY_KEYS.has(key))) return malformed('This lesson has unexpected fields.');
  const duration = value.duration;
  if (!isNumber(duration) || duration <= 0) return malformed('This lesson has an invalid duration.');
  if (!isId(value.lesson_id) || !isId(value.revision_id) || !isTitle(value.title)) return malformed('This lesson is missing a valid identity.');
  if (!isNumber(value.source_start) || value.source_start < 0) return malformed('This lesson has an invalid source start.');
  if (!isNumber(value.standing_time) || value.standing_time < 0 || value.standing_time > duration + 1e-6) {
    return malformed('This lesson has an invalid standing time.');
  }
  if (!BODY_ENGINES.includes(value.engine as string)) return malformed('This lesson has an unknown engine.');
  if (!isText(value.engine_version)) return malformed('This lesson is missing its engine version.');
  if (value.units !== 'metres' || value.landmark_axes !== 'x-right/y-down/z-forward') return malformed('This lesson uses unsupported coordinates.');
  if (!ROOT_MOTIONS.includes(value.root_motion as string)) return malformed('This lesson has an unknown root motion.');
  if (value.confidence !== 'unmeasured' && value.confidence !== 'measured') return malformed('This lesson has an unknown confidence value.');
  if (value.frame_rate !== undefined && (!isCount(value.frame_rate) || value.frame_rate < 1 || value.frame_rate > 240)) {
    return malformed('This lesson has an invalid frame rate.');
  }
  const animationStart = value.animation_start ?? 0;
  if (!isNumber(animationStart) || animationStart < 0) return malformed('This lesson has an invalid animation start.');
  if (value.animation_duration !== undefined && value.animation_duration !== null) {
    if (!isNumber(value.animation_duration) || value.animation_duration <= 0) return malformed('This lesson has an invalid animation duration.');
    if (animationStart + duration > value.animation_duration + 1e-6) return malformed('This lesson trim is outside its animation.');
  }
  if (value.focused_video_start !== undefined && value.focused_video_start !== null
      && (!isNumber(value.focused_video_start) || value.focused_video_start < 0)) {
    return malformed('This lesson has an invalid instructor video start.');
  }
  const animation = readAsset(value.animation);
  const landmarks = readAsset(value.landmarks);
  if (!animation || !landmarks) return malformed('This lesson is missing its movement assets.');
  if (animation.mime !== 'model/gltf-binary') return malformed('This lesson animation is not a GLB.');
  if (landmarks.mime !== 'application/json') return malformed('This lesson landmarks are not JSON.');
  const sourceVideo: OptionalAsset = readAsset(value.source_video);
  const thumbnail: OptionalAsset = readAsset(value.thumbnail);
  const focused: OptionalAsset = readAsset(value.focused_video);
  const alpha: OptionalAsset = readAsset(value.focused_video_alpha);
  if (sourceVideo === undefined || thumbnail === undefined || focused === undefined || alpha === undefined) {
    return malformed('This lesson has an invalid media asset.');
  }
  if (sourceVideo && !isVideo(sourceVideo)) return malformed('This lesson source is not a video.');
  if (thumbnail && !isImage(thumbnail)) return malformed('This lesson thumbnail is not an image.');
  // Model rules: a focused instructor video needs its source and MP4; a transparent
  // companion needs the focused video and WebM.
  if (focused && (!sourceVideo || focused.mime !== 'video/mp4')) {
    return malformed('This lesson instructor video does not match its source.');
  }
  if (alpha && (!focused || alpha.mime !== 'video/webm')) {
    return malformed('This lesson instructor alpha does not match its video.');
  }
  if (value.warnings !== undefined && !isStringArray(value.warnings)) return malformed('This lesson has invalid warnings.');
  if (!readPresentations(value.presentation)) return malformed('This lesson has invalid presentation assets.');
  if (value.public_tags !== undefined && !isStringArray(value.public_tags)) return malformed('This lesson has invalid public tags.');
  if (value.public_creator !== undefined && !isText(value.public_creator)) return malformed('This lesson has an invalid public creator.');
  const sectionSet = readSectionSet(value.section_set, duration);
  if (!sectionSet) return malformed('This lesson has inconsistent sections.');
  return {
    ok: true,
    value: {
      ...(value as unknown as LessonManifest),
      animation,
      landmarks,
      source_video: sourceVideo ?? null,
      thumbnail: thumbnail ?? null,
      focused_video: focused ?? null,
      focused_video_alpha: alpha ?? null,
      section_set: sectionSet,
      warnings: value.warnings ?? [],
      presentation: (value.presentation ?? {}) as LessonManifest['presentation'],
    },
  };
}

/** Music v2. Requires a reviewed reference; an unreviewed draft is not a manifest. */
export function parseMusicLessonManifest(value: unknown): ParseResult<MusicLessonManifest> {
  if (!isRecord(value)) return malformed('This music lesson could not be read.');
  if (value.schema_version === 1) return unsupported('This lesson is not a music lesson.');
  if (value.schema_version !== 2) return unsupported('This music lesson format is not supported.');
  // The contract forbids extras; a music manifest must not smuggle body fields.
  if (!Object.keys(value).every(key => MUSIC_KEYS.has(key))) return malformed('This music lesson has unexpected fields.');
  if (value.experience_family !== 'music') return malformed('This lesson is not a music lesson.');
  if (!MUSIC_SUBJECTS.includes(value.subject as (typeof MUSIC_SUBJECTS)[number])) return malformed('This music lesson has an unknown instrument.');
  if (!isId(value.lesson_id) || !isId(value.revision_id) || !isTitle(value.title)) return malformed('This music lesson is missing a valid identity.');
  const duration = value.duration;
  if (!isNumber(duration) || duration <= 0) return malformed('This music lesson has an invalid duration.');
  const instrument = readInstrument(value.instrument);
  if (!instrument) return malformed('This music lesson is missing its instrument configuration.');
  if (instrument.instrument !== value.subject) return malformed('This music lesson disagrees about its instrument.');
  const sectionSet = readSectionSet(value.section_set, duration);
  if (!sectionSet) return malformed('This music lesson has inconsistent teaching sections.');
  const reference = readAsset(value.reference);
  if (!reference || reference.mime !== 'application/json') return malformed('This music lesson has no reviewed reference.');
  if (value.reference_reviewed !== true) return unsupported('This music lesson has not been reviewed yet.');
  const assessment = readAssessment(value.assessment);
  if (!assessment) return malformed('This music lesson has an invalid assessment policy.');
  const sourceVideo: OptionalAsset = readAsset(value.source_video);
  const preview: OptionalAsset = readAsset(value.preview_video);
  const waveform: OptionalAsset = readAsset(value.waveform);
  const midi: OptionalAsset = readAsset(value.midi_export);
  const poster: OptionalAsset = readAsset(value.public_poster);
  if (sourceVideo === undefined || preview === undefined || waveform === undefined
      || midi === undefined || poster === undefined) {
    return malformed('This music lesson has an invalid media asset.');
  }
  if (sourceVideo && !isVideo(sourceVideo)) return malformed('This music lesson source is not a video.');
  if (preview && !isVideo(preview)) return malformed('This music lesson preview is not a video.');
  if (waveform && waveform.mime !== 'application/json') return malformed('This music lesson waveform is not JSON.');
  if (midi && !MIDI_MIMES.includes(midi.mime)) return malformed('This music lesson has an invalid MIDI export.');
  if (poster && !isImage(poster)) return malformed('This music lesson has an invalid public poster.');
  if (value.warnings !== undefined && !isStringArray(value.warnings)) return malformed('This music lesson has invalid warnings.');
  return {
    ok: true,
    value: {
      ...(value as unknown as MusicLessonManifest),
      instrument,
      section_set: sectionSet,
      reference,
      assessment,
      source_video: sourceVideo ?? null,
      preview_video: preview ?? null,
      waveform: waveform ?? null,
      midi_export: midi ?? null,
      public_poster: poster ?? null,
      warnings: value.warnings ?? [],
    },
  };
}

export function parseLessonSummary(value: unknown): ParseResult<LessonSummary> {
  if (!isRecord(value)) return malformed('This lesson summary could not be read.');
  if (value.summary_version !== 1) return unsupported('This lesson summary format is not supported.');
  if (!Object.keys(value).every(key => SUMMARY_KEYS.has(key))) return malformed('This lesson summary has unexpected fields.');
  if (!isId(value.lesson_id) || !isId(value.revision_id) || !isTitle(value.title)) return malformed('This summary is missing a valid identity.');
  if (!SUBJECTS.includes(value.subject as (typeof SUBJECTS)[number])) return malformed('This summary has an unknown subject.');
  if (!isText(value.subject_label)) return malformed('This summary has no subject label.');
  if (value.experience_family !== 'body' && value.experience_family !== 'music') return malformed('This summary has an unknown family.');
  const instrument = value.instrument === undefined || value.instrument === null ? null : value.instrument;
  if (instrument !== null && instrument !== 'piano' && instrument !== 'guitar') return malformed('This summary has an unknown instrument.');
  if (!isNumber(value.duration) || value.duration <= 0) return malformed('This summary has an invalid duration.');
  if (!isCount(value.section_count) || value.section_count < 1) return malformed('This summary has an invalid section count.');
  const poster = readAsset(value.poster);
  if (poster === undefined) return malformed('This summary has an invalid poster.');
  if (poster && !poster.mime.startsWith('image/')) return malformed('This summary poster is not an image.');
  const capabilities = value.capabilities;
  if (!isRecord(capabilities) || !Object.keys(capabilities).every(key => ['preview', 'practice', 'live_input'].includes(key))) {
    return malformed('This summary has no capabilities.');
  }
  if (typeof capabilities.preview !== 'boolean' || typeof capabilities.practice !== 'boolean') return malformed('This summary has invalid capabilities.');
  const live = capabilities.live_input as string;
  if (!['camera', 'midi', 'microphone', 'none'].includes(live)) return malformed('This summary has an unknown input mode.');
  // Cross-field rules: the catalogue and the family must tell the same story.
  const musicSubject = value.subject === 'piano' || value.subject === 'guitar';
  if (musicSubject !== (value.experience_family === 'music')) {
    return malformed('This summary disagrees about its subject and experience family.');
  }
  if ((instrument !== null) !== (value.experience_family === 'music')) {
    return malformed('This summary disagrees about its instrument.');
  }
  if (value.experience_family === 'music' && live === 'camera') {
    return malformed('This summary offers camera input for a music lesson.');
  }
  if (value.experience_family === 'body' && (live === 'midi' || live === 'microphone')) {
    return malformed('This summary offers music input for a movement lesson.');
  }
  return {
    ok: true,
    value: {
      ...(value as unknown as LessonSummary),
      poster: poster ?? null,
      capabilities: {
        preview: capabilities.preview,
        practice: capabilities.practice,
        live_input: live as SummaryCapabilities['live_input'],
      },
    },
  };
}

/** Dispatch for a mixed response. This is the only place a lesson union exists. */
export function parseLessonDocument(value: unknown): ParseResult<LessonDocument> {
  if (!isRecord(value)) return malformed('This lesson could not be read.');
  if (value.schema_version === 2) {
    const parsed = parseMusicLessonManifest(value);
    return parsed.ok ? {ok: true, value: {kind: 'music', value: parsed.value}} : parsed;
  }
  if (value.summary_version === 1) {
    const parsed = parseLessonSummary(value);
    return parsed.ok ? {ok: true, value: {kind: 'summary', value: parsed.value}} : parsed;
  }
  if (value.schema_version === 1) {
    const parsed = parseLessonManifest(value);
    return parsed.ok ? {ok: true, value: {kind: 'body', value: parsed.value}} : parsed;
  }
  return unsupported('This lesson format is not supported.');
}

export type {SummaryCapabilities};


/** Separate owner review boundary: an unreviewed proposal never becomes a LessonDocument. */
export function parseMusicDraftView(value:unknown):ParseResult<MusicDraftView>{
 const bad=()=>malformed('This music draft could not be read. Reopen the review.');
 if(!isRecord(value)||value.draft_version!==1||!isId(value.draft_id)||!isId(value.lesson_id)||!isTitle(value.title)||
   !['draft','reviewed'].includes(String(value.status))||!isNumber(value.duration)||value.duration<=0||
   (value.subject!=='piano'&&value.subject!=='guitar'))return bad();
 const keys=['draft_version','draft_id','lesson_id','revision_id','title','status','subject','instrument','duration','reference','source_video','events','spans','guitar_chords','analysis','provenance','warnings'];
 if(Object.keys(value).some(key=>!keys.includes(key)))return bad();
 const instrument=readInstrument(value.instrument),reference=readAsset(value.reference),source=readAsset(value.source_video??null);
 if(!instrument||instrument.instrument!==value.subject||!reference||reference.mime!=='application/json'||source===undefined||source&&!isVideo(source))return bad();
 if(!Array.isArray(value.events)||value.events.length>20000||!Array.isArray(value.spans)||value.spans.length>500)return bad();
 const events:MusicDraftEvent[]=[],seen=new Set<string>();
 for(const event of value.events){
  if(!isRecord(event)||!isId(event.id)||seen.has(event.id)||!isNumber(event.onset)||event.onset<0||event.onset>value.duration||
   !isCount(event.pitch)||event.pitch>127||Object.keys(event).some(key=>!['id','onset','duration','pitch','velocity','confidence','optional','string','fret'].includes(key)))return bad();
  const duration=event.duration??null,velocity=event.velocity??null,confidence=event.confidence??null,optional=event.optional??false;
  if(duration!==null&&(!isNumber(duration)||duration<=0||event.onset+duration>value.duration+1e-6)||
    velocity!==null&&(!isNumber(velocity)||velocity<0||velocity>1)||confidence!==null&&(!isNumber(confidence)||confidence<0||confidence>1)||typeof optional!=='boolean')return bad();
  const string=event.string??null,fret=event.fret??null;
  if((string===null)!==(fret===null)||string!==null&&(!isCount(string)||string<1||string>6)||fret!==null&&(!isCount(fret)||fret>24)||
    string!==null&&({1:64,2:59,3:55,4:50,5:45,6:40} as Record<number,number>)[string]+(fret as number)!==event.pitch)return bad();
  seen.add(event.id);events.push({id:event.id,onset:event.onset,pitch:event.pitch,duration,velocity,confidence,optional,string,fret});
 }
 const spans:{start:number;end:number;kind:'playing'|'explanation'}[]=[];
 for(const span of value.spans){
  if(!isRecord(span)||Object.keys(span).some(key=>!['start','end','kind'].includes(key))||!isNumber(span.start)||!isNumber(span.end)||span.start<0||span.end<=span.start||span.end>value.duration+1e-6||
    span.kind!=null&&span.kind!=='playing'&&span.kind!=='explanation')return bad();
  spans.push({start:span.start,end:span.end,kind:(span.kind as 'playing'|'explanation')??'playing'});
 }
 const analysis=readAsset(value.analysis??null);
 if(analysis===undefined)return bad();
 const chords:MusicDraftView['guitar_chords']=[];
 const chordValues=value.guitar_chords??[];
 if(!Array.isArray(chordValues)||chordValues.length>100)return bad();
 for(const chord of chordValues){
  if(!isRecord(chord)||Object.keys(chord).some(key=>!['id','name','start','frets','position'].includes(key))||!isId(chord.id)||
    !isText(chord.name)||chord.name.length>40||!isNumber(chord.start)||chord.start<0||chord.start>value.duration||
    !Array.isArray(chord.frets)||chord.frets.length!==6||chord.frets.some(fret=>!isCount(fret)||fret<-1||fret>24)||
    !chord.frets.some(fret=>fret>=0))return bad();
  const position=chord.position??1;
  if(!isCount(position)||position<1||position>24)return bad();
  chords.push({id:chord.id,name:chord.name,start:chord.start,frets:[...chord.frets],position});
 }
 if(new Set(chords.map(chord=>chord.id)).size!==chords.length)return bad();
 const provenance=value.provenance;
 if(!isRecord(provenance)||Object.keys(provenance).some(key=>!['adapter','engine','model','model_version','code_version','audio_sha256','profile_sha256'].includes(key)))return bad();
 for(const key of ['adapter','engine','code_version'])if(!isText(provenance[key])||(provenance[key] as string).length>80)return bad();
 for(const [key,max] of [['model',120],['model_version',80]] as const)if(provenance[key]!=null&&(!isText(provenance[key])||provenance[key].length>max))return bad();
 if(typeof provenance.audio_sha256!=='string'||! /^[a-f0-9]{64}$/.test(provenance.audio_sha256)||!isStringArray(value.warnings)||value.warnings.length>100)return bad();
 return {ok:true,value:{draft_version:1,draft_id:value.draft_id,lesson_id:value.lesson_id,title:value.title,status:value.status as 'draft'|'reviewed',
  subject:value.subject,instrument,duration:value.duration,reference,source_video:source,events,spans,guitar_chords:chords,analysis:analysis??null,warnings:[...value.warnings],
  provenance:{adapter:String(provenance.adapter),engine:String(provenance.engine),code_version:String(provenance.code_version),model:provenance.model as string|null??null,model_version:provenance.model_version as string|null??null,audio_sha256:provenance.audio_sha256,profile_sha256:provenance.profile_sha256 as string|null??null}}};
}
