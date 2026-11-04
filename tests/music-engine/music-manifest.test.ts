import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseLessonDocument, parseMusicLessonManifest} from '../../packages/lesson-schema/parse';

const read = (name: string): any =>
  JSON.parse(readFileSync(new URL(`../../packages/lesson-schema/${name}`, import.meta.url), 'utf8'));

test('the music contract and its generated schema agree on required fields', () => {
  const schema = read('music-manifest.schema.json');
  const required = new Set<string>(schema.required);
  for (const name of ['lesson_id', 'revision_id', 'title', 'subject', 'duration', 'instrument', 'section_set', 'reference', 'assessment']) {
    assert.ok(required.has(name), `${name} should be required`);
    assert.ok(name in schema.properties, `${name} should be described`);
  }
  assert.ok(!('animation' in schema.properties), 'music must not require body assets');
  assert.ok(!('landmarks' in schema.properties), 'music must not require body landmarks');
});

test('the boundary schema declares exactly three document kinds', () => {
  const schema = read('lesson-boundary.schema.json');
  assert.equal(schema.anyOf.length, 3);
});

test('music requires a reviewed reference and rejects a draft', () => {
  assert.equal(parseMusicLessonManifest(read('fixtures/music-v2.json')).ok, true);
  const draft = read('fixtures/music-v2.json');
  draft.reference_reviewed = false;
  const parsed = parseMusicLessonManifest(draft);
  assert.equal(parsed.ok, false);
});

test('sections must stay contiguous for music teaching', () => {
  const sparse = read('fixtures/invalid/music-v2-sparse-sections.json');
  assert.equal(parseLessonDocument(sparse).ok, false);
});

test('instrument must match the music subject', () => {
  const value = read('fixtures/music-v2.json');
  value.instrument = {instrument: 'guitar'};
  const parsed = parseMusicLessonManifest(value);
  assert.equal(parsed.ok, false);
});
