import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  parseLessonDocument, parseLessonManifest, parseLessonSummary, parseMusicLessonManifest,
} from '../../packages/lesson-schema/parse';

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../packages/lesson-schema/${name}`, import.meta.url), 'utf8'));

const invalidMusic = [
  'fixtures/invalid/music-v2-missing-subject.json',
  'fixtures/invalid/music-v2-sparse-sections.json',
  'fixtures/invalid/music-v2-body-fields.json',
  'fixtures/invalid/music-v2-unreviewed.json',
];

test('the body fixture parses as a body document', () => {
  const parsed = parseLessonDocument(read('fixture.json'));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.kind, 'body');
    assert.equal(parsed.value.value.schema_version, 1);
  }
});

test('the music fixture parses as a music document', () => {
  const parsed = parseLessonDocument(read('fixtures/music-v2.json'));
  assert.equal(parsed.ok, true);
  if (parsed.ok && parsed.value.kind === 'music') {
    assert.equal(parsed.value.value.subject, 'piano');
    assert.equal(parsed.value.value.experience_family, 'music');
  } else {
    assert.fail('expected a music document');
  }
});

test('the summary fixture parses as a summary', () => {
  const parsed = parseLessonSummary(read('fixtures/lesson-summary.json'));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.subject_label, 'Piano');
});

test('a v2 payload is refused by the body parser rather than mishandled', () => {
  const parsed = parseLessonManifest(read('fixtures/music-v2.json'));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, 'unsupported_format');
    assert.match(parsed.message, /newer version/);
  }
});

test('a v1 payload is refused by the music parser', () => {
  const parsed = parseMusicLessonManifest(read('fixture.json'));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, 'unsupported_format');
});

test('every invalid music fixture is refused', () => {
  for (const name of invalidMusic) {
    const parsed = parseMusicLessonManifest(read(name));
    assert.equal(parsed.ok, false, name);
  }
});

test('sparse teaching sections are refused by the shared section rule', () => {
  const parsed = parseMusicLessonManifest(read('fixtures/invalid/music-v2-sparse-sections.json'));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.message, /sections/i);
});

test('an unreviewed reference is not a music manifest', () => {
  const parsed = parseMusicLessonManifest(read('fixtures/invalid/music-v2-unreviewed.json'));
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, 'unsupported_format');
});

test('malformed input never throws', () => {
  for (const value of [null, 42, 'lesson', [], {}, {schema_version: 1}, {schema_version: 2}, {summary_version: 1}]) {
    assert.doesNotThrow(() => parseLessonDocument(value));
    const parsed = parseLessonDocument(value);
    assert.equal(parsed.ok, false);
  }
});

test('a document with an unknown version is unsupported, not malformed', () => {
  const parsed = parseLessonDocument({schema_version: 3});
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, 'unsupported_format');
});

test('a body lesson missing a required field is refused', () => {
  for (const field of ['source_start', 'engine_version', 'confidence', 'animation', 'section_set']) {
    const value = read('fixture.json') as Record<string, unknown>;
    delete value[field];
    const parsed = parseLessonManifest(value);
    assert.equal(parsed.ok, false, field);
  }
});

test('a body lesson with an unknown field is refused', () => {
  const value = read('fixture.json') as Record<string, unknown>;
  value.smuggled = true;
  assert.equal(parseLessonManifest(value).ok, false);
});

test('unsafe asset keys are refused', () => {
  for (const key of ['../escape.glb', '/absolute.glb', 'a//b.glb', 'a/./b.glb', '']) {
    const value = read('fixture.json') as any;
    value.animation.key = key;
    assert.equal(parseLessonManifest(value).ok, false, key);
  }
});

test('out-of-range body values are refused', () => {
  const standing = read('fixture.json') as any;
  standing.standing_time = standing.duration + 1;
  assert.equal(parseLessonManifest(standing).ok, false);

  const frameRate = read('fixture.json') as any;
  frameRate.frame_rate = 0;
  assert.equal(parseLessonManifest(frameRate).ok, false);

  const mime = read('fixture.json') as any;
  mime.animation.mime = 'application/octet-stream';
  assert.equal(parseLessonManifest(mime).ok, false);

  const trim = read('fixture.json') as any;
  trim.animation_start = 1;
  trim.animation_duration = 2;
  assert.equal(parseLessonManifest(trim).ok, false);
});

test('a music lesson with malformed optional fields is refused', () => {
  const warnings = read('fixtures/music-v2.json') as any;
  warnings.warnings = 'none';
  assert.equal(parseMusicLessonManifest(warnings).ok, false);

  const dimensions = read('fixtures/music-v2.json') as any;
  dimensions.assessment.dimensions = [];
  assert.equal(parseMusicLessonManifest(dimensions).ok, false);

  const duplicate = read('fixtures/music-v2.json') as any;
  duplicate.assessment.dimensions = ['pitch', 'pitch'];
  assert.equal(parseMusicLessonManifest(duplicate).ok, false);

  const modes = read('fixtures/music-v2.json') as any;
  modes.assessment.input_modes = [];
  assert.equal(parseMusicLessonManifest(modes).ok, false);
});

test('a summary with an invalid poster or extra field is refused', () => {
  const poster = read('fixtures/lesson-summary.json') as any;
  poster.poster = {key: 'poster.mp4', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseLessonSummary(poster).ok, false);

  const extra = read('fixtures/lesson-summary.json') as any;
  extra.private_notes = 'leak';
  assert.equal(parseLessonSummary(extra).ok, false);
});

test('instructor video relationships are enforced', () => {
  const noSource = read('fixture.json') as any;
  noSource.focused_video = {key: 'fixture/instructor.mp4', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseLessonManifest(noSource).ok, false);

  const wrongMime = read('fixture.json') as any;
  wrongMime.source_video = {key: 'fixture/source.mp4', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  wrongMime.focused_video = {key: 'fixture/instructor.webm', mime: 'video/webm', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseLessonManifest(wrongMime).ok, false);

  const alphaWithoutFocused = read('fixture.json') as any;
  alphaWithoutFocused.focused_video_alpha = {key: 'fixture/instructor-alpha.webm', mime: 'video/webm', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseLessonManifest(alphaWithoutFocused).ok, false);

  const thumbnailVideo = read('fixture.json') as any;
  thumbnailVideo.thumbnail = {key: 'fixture/thumb.mp4', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseLessonManifest(thumbnailVideo).ok, false);
});

test('music media roles are enforced', () => {
  const previewAudio = read('fixtures/music-v2.json') as any;
  previewAudio.preview_video = {key: 'lessons/x/preview.mp4', mime: 'audio/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseMusicLessonManifest(previewAudio).ok, false);

  const waveformVideo = read('fixtures/music-v2.json') as any;
  waveformVideo.waveform = {key: 'lessons/x/waveform.json', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseMusicLessonManifest(waveformVideo).ok, false);

  const badMidi = read('fixtures/music-v2.json') as any;
  badMidi.midi_export = {key: 'lessons/x/midi.mid', mime: 'video/mp4', bytes: 10,
    sha256: 'a'.repeat(64)};
  assert.equal(parseMusicLessonManifest(badMidi).ok, false);
});

test('summary cross-field consistency is enforced', () => {
  const bodyFamilyMusicSubject = read('fixtures/lesson-summary.json') as any;
  bodyFamilyMusicSubject.experience_family = 'body';
  assert.equal(parseLessonSummary(bodyFamilyMusicSubject).ok, false);

  const musicWithoutInstrument = read('fixtures/lesson-summary.json') as any;
  musicWithoutInstrument.instrument = null;
  assert.equal(parseLessonSummary(musicWithoutInstrument).ok, false);

  const cameraForMusic = read('fixtures/lesson-summary.json') as any;
  cameraForMusic.capabilities.live_input = 'camera';
  assert.equal(parseLessonSummary(cameraForMusic).ok, false);

  const midiForBody = read('fixtures/lesson-summary.json') as any;
  midiForBody.subject = 'movement_other';
  midiForBody.subject_label = 'Full Body Movement';
  midiForBody.experience_family = 'body';
  midiForBody.instrument = null;
  midiForBody.capabilities.live_input = 'midi';
  assert.equal(parseLessonSummary(midiForBody).ok, false);
});

test('identity lengths follow the contract', () => {
  const longTitle = read('fixture.json') as any;
  longTitle.title = 'x'.repeat(201);
  assert.equal(parseLessonManifest(longTitle).ok, false);

  const longSectionLabel = read('fixture.json') as any;
  longSectionLabel.section_set.sections[0].label = 'x'.repeat(81);
  assert.equal(parseLessonManifest(longSectionLabel).ok, false);

  const longId = read('fixtures/music-v2.json') as any;
  longId.lesson_id = 'x'.repeat(81);
  assert.equal(parseMusicLessonManifest(longId).ok, false);
});

// A video-only movement: the CPU MediaPipe route has no GLB, so `animation` is null
// and the source video is what the person actually watches.
function mediapipeFixture(): any {
  const value = read('fixture.json') as any;
  value.engine = 'mediapipe';
  value.engine_version = 'mediapipe-pose-heavy-v1';
  value.root_motion = 'hip-relative';
  value.animation = null;
  value.source_video = {key: 'lessons/x/preview.mp4', mime: 'video/mp4', bytes: 10, sha256: 'a'.repeat(64)};
  return value;
}

test('a mediapipe manifest parses with a null animation and a source video', () => {
  const parsed = parseLessonManifest(mediapipeFixture());
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.animation, null);
    assert.equal(parsed.value.engine, 'mediapipe');
    assert.equal(parsed.value.source_video?.mime, 'video/mp4');
  }
});

test('engine-specific completeness is enforced on the client boundary', () => {
  const noAnimation = mediapipeFixture();
  noAnimation.engine = 'sam-3d-body';
  assert.equal(parseLessonManifest(noAnimation).ok, false);

  const noVideo = mediapipeFixture();
  noVideo.source_video = null;
  assert.equal(parseLessonManifest(noVideo).ok, false);

  const legacySam = read('fixture.json') as any;
  legacySam.engine = 'sam-3d-body';
  assert.equal(parseLessonManifest(legacySam).ok, true, 'an existing SAM lesson keeps its GLB rule');
});

test('frame_rate accepts finite fractions in 1-240 and rejects the rest', () => {
  for (const value of [29.97, 23.976, 25, 30, 1, 240]) {
    const manifest = read('fixture.json') as any;
    manifest.frame_rate = value;
    const parsed = parseLessonManifest(manifest);
    assert.equal(parsed.ok, true, `frame_rate ${value} should parse`);
    if (parsed.ok) assert.equal(parsed.value.frame_rate, value);
  }
  for (const value of [0.5, 0, 240.5, -1, Number.NaN, Number.POSITIVE_INFINITY, '30']) {
    const manifest = read('fixture.json') as any;
    manifest.frame_rate = value;
    assert.equal(parseLessonManifest(manifest).ok, false, `frame_rate ${String(value)} should be rejected`);
  }
  // A legacy manifest that omits frame_rate still parses.
  const legacy = read('fixture.json') as any;
  delete legacy.frame_rate;
  assert.equal(parseLessonManifest(legacy).ok, true);
});
