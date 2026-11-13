import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'http://localhost/', pretendToBeVisual: true});
const {window} = dom;
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', {value: window.navigator, configurable: true});
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {render, screen, fireEvent, cleanup} = await import('@testing-library/react');
const {VerificationReview} = await import('../src/music/VerificationReview.tsx');
const {parseVerificationState} = await import('../src/music/verification.ts');
const {applyFindingEdits, revertFindingEdits} = await import('../src/music/working-edits.ts');

afterEach(() => cleanup());

const event = {id: 'e1', onset: 0.7, duration: 0.4, pitch: 60, velocity: 0.7,
  confidence: null, optional: false, string: null, fret: null};
const finding = {
  id: 'vf-1', kind: 'onset_shift', status: 'suggested', time_range: [0.5, 0.9],
  event_ids: ['e1'], pitch: 60, explanation: 'This note may start slightly later.',
  evidence: {gain: 0.4, attack_sharp: 1.2}, alternatives: [],
  proposed_edits: [{op: 'set_onset', event_ids: ['e1'], before: {onset: 0.7}, after: {onset: 0.5}, reason: 'Attack.'}],
  ambiguous: false, ambiguity_reasons: [],
};
const state = {
  schema_version: 1, available: true, draft_id: 'draft-1', lesson_id: 'lesson-1',
  proposal_sha256: 'a'.repeat(64), report_proposal_sha256: 'a'.repeat(64), report_sha256: 'd'.repeat(64),
  stale: false, report_error: null, invalid_working: null, state_token: 'c'.repeat(64),
  decisions: [], events: [event], conflicts: [],
  report: {schema_version: 1, verifier_version: 'piano-verifier-1', mode: 'diagnostic', status: 'complete',
    source: {proposal_sha256: 'a'.repeat(64), audio_sha256: 'b'.repeat(64)},
    findings: [finding], summary: {finding_count: 1}},
};

test('verification state parsing accepts a report and rejects a malformed one', () => {
  const parsed = parseVerificationState(state);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.report.findings[0].kind, 'onset_shift');
  assert.equal(parseVerificationState({...state, proposal_sha256: 'short'}).ok, false);
  assert.equal(parseVerificationState({...state, report: {...state.report, findings: [{}]}}).ok, false);
  const structural = {...state, report: {...state.report, findings: [{...finding, proposed_edits: [
    {op: 'merge', event_ids: ['e1', 'e2'], before: [{id: 'e1'}, {id: 'e2'}],
     after: {onset: 0.7, duration: 0.6, pitch: 60}, reason: 'One strike.'},
    {op: 'split_note', event_ids: ['e1'], before: {id: 'e1'},
     after: [{onset: 0.7, duration: 0.2, pitch: 60}, {onset: 0.9, duration: 0.2, pitch: 60}]},
    {op: 'delete_note', event_ids: ['e1'], before: {id: 'e1'}, after: null, reason: 'Unsupported note.'},
  ]}]}};
  assert.equal(parseVerificationState(structural).ok, true);
});

test('a suggested finding can be accepted, rejected or selected', () => {
  const decisions: string[] = [];
  const selected: string[] = [];
  render(<VerificationReview state={state as never} busy={false} selected={null} eventNumbers={{e1: 3}}
    hasVideo playing={false} baselineCount={1} onSelect={value => selected.push(value.id)}
    onDecision={(_id, decision) => decisions.push(decision)} onPlay={() => {}} onStop={() => {}} onAudition={() => {}}/>);
  assert.ok(screen.getByText('This note may start slightly later.'));
  assert.ok(screen.getByText(/note 3/));
  fireEvent.click(screen.getByRole('button', {name: /accept suggestion/i}));
  fireEvent.click(screen.getByRole('button', {name: /^dismiss$/i}));
  fireEvent.click(screen.getByRole('button', {name: /timing/i}));
  assert.deepEqual(decisions, ['accepted', 'rejected']);
  assert.deepEqual(selected, ['vf-1']);
});

test('a stale report cannot apply suggestions and an accepted decision can be undone', () => {
  const accepted = {...state, decisions: [{finding_id: 'vf-1', decision: 'accepted', decided_at: '2026-11-11T10:00:00Z',
    edits: finding.proposed_edits}]};
  const decisions: string[] = [];
  const {rerender} = render(<VerificationReview state={accepted as never} busy={false} selected='vf-1'
    eventNumbers={{e1: 1}} hasVideo playing={false} baselineCount={1} onSelect={() => {}}
    onDecision={(_id, decision) => decisions.push(decision)} onPlay={() => {}} onStop={() => {}} onAudition={() => {}}/>);
  assert.ok(screen.getByText(/accepted .*2026/i));
  fireEvent.click(screen.getByRole('button', {name: /^undo$/i}));
  assert.deepEqual(decisions, ['cleared']);
  rerender(<VerificationReview state={{...state, stale: true} as never} busy={false} selected={null}
    eventNumbers={{e1: 1}} hasVideo playing={false} baselineCount={1} onSelect={() => {}} onDecision={() => {}} onPlay={() => {}}
    onStop={() => {}} onAudition={() => {}}/>);
  assert.ok(screen.getByRole('alert').textContent?.includes('The proposal changed'));
  assert.equal((screen.getByRole('button', {name: /accept suggestion/i}) as HTMLButtonElement).disabled, true);
});

test('a withheld correction is shown without an accept action', () => {
  const withheld = {...finding, status: 'unresolved', correction_status: 'withheld',
    withheld_reason: 'Only rendered evidence is available.'};
  const next = {...state, report: {...state.report, findings: [withheld]}};
  render(<VerificationReview state={next as never} busy={false} selected={null} eventNumbers={{e1: 1}}
    hasVideo playing={false} baselineCount={1} onSelect={() => {}} onDecision={() => {}} onPlay={() => {}}
    onStop={() => {}} onAudition={() => {}}/>);
  assert.ok(screen.getByText(/correction withheld/i));
  assert.ok(screen.getByText(/only rendered evidence/i));
  assert.equal(screen.queryByRole('button', {name: /accept suggestion/i}), null);
  assert.ok(screen.getByRole('button', {name: /^dismiss$/i}));
});

test('applying and undoing one suggestion preserves unrelated manual edits', () => {
  const first = {...event, id: 'e1', onset: 0.7};
  const second = {...event, id: 'e2', onset: 1.1, pitch: 64, velocity: 0.4};
  const target = {...finding, event_ids: ['e1'], proposed_edits: [
    {op: 'set_onset', event_ids: ['e1'], before: {onset: 0.7}, after: {onset: 0.5}, reason: 'Timing.'},
  ]};
  const changed = applyFindingEdits([first, second], target as never, 3);
  assert.equal(changed.find(item => item.id === 'e1')?.onset, 0.5);
  assert.deepEqual(changed.find(item => item.id === 'e2'), second);
  const restored = revertFindingEdits(changed, target as never, 3);
  assert.equal(restored.find(item => item.id === 'e1')?.onset, 0.7);
  assert.deepEqual(restored.find(item => item.id === 'e2'), second);
});

test('a draft view can expose automatic corrections and its baseline', async () => {
  const {parseMusicDraftView} = await import('../../../packages/lesson-schema/parse.ts');
  const baseline = {...event, id: 'e1', onset: 0.7};
  const working = {...event, id: 'e1', onset: 0.5};
  const draft = {
    draft_version: 1, draft_id: 'draft-1', lesson_id: 'lesson-1', title: 'Piano draft',
    status: 'draft', subject: 'piano', instrument: {instrument: 'piano'}, duration: 2,
    reference: {key: 'reference.json', mime: 'application/json', bytes: 10, sha256: 'a'.repeat(64)},
    source_video: null, events: [working], spans: [{start: 0.2, end: 1.8}], guitar_chords: [],
    analysis: null, warnings: [], working_corrected: true, baseline_events: [baseline],
    automatic_corrections: [{finding_id: 'vf-1', kind: 'onset_shift',
      applied_at: '2026-11-11T00:00:00+00:00', reverted_at: null,
      policy_sha256: 'b'.repeat(64), report_sha256: 'c'.repeat(64), edits: []},
      {finding_id: 'expr-1', event_id: 'e1', attribute: 'audible_duration',
       kind: 'audible_duration', before: 0.7, value: 1.2,
       applied_at: '2026-11-11T00:00:01+00:00', reverted_at: null,
       policy_sha256: 'b'.repeat(64), report_sha256: 'c'.repeat(64), edits: []}],
    provenance: {adapter: 'basic-pitch', engine: 'onnx', model: 'basic-pitch',
      model_version: '0.4.0', code_version: 'test', audio_sha256: 'd'.repeat(64)},
  };
  const parsed = parseMusicDraftView(draft);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.working_corrected, true);
    assert.equal(parsed.value.events[0].onset, 0.5);
    assert.equal(parsed.value.baseline_events?.[0].onset, 0.7);
    assert.equal(parsed.value.automatic_corrections?.[0].finding_id, 'vf-1');
  }
});

test('combined phase-3 and phase-4 history remains openable', async () => {
  const {parseMusicDraftView} = await import('../../../packages/lesson-schema/parse.ts');
  const history = Array.from({length: 1200}, (_, index) => ({
    finding_id: `expr-${index}`, event_id: 'e1', attribute: 'relative_dynamics',
    kind: 'relative_dynamics', before: 0.5, value: 0.6,
    applied_at: '2026-11-11T00:00:01+00:00', reverted_at: null,
    policy_sha256: 'b'.repeat(64), report_sha256: 'c'.repeat(64), edits: []}));
  const draft = {
    draft_version: 1, draft_id: 'draft-1', lesson_id: 'lesson-1', title: 'Piano draft',
    status: 'draft', subject: 'piano', instrument: {instrument: 'piano'}, duration: 2,
    reference: {key: 'reference.json', mime: 'application/json', bytes: 10, sha256: 'a'.repeat(64)},
    source_video: null, events: [event], spans: [{start: 0.2, end: 1.8}], guitar_chords: [],
    analysis: null, warnings: [], working_corrected: true, baseline_events: [event],
    automatic_corrections: history,
    provenance: {adapter: 'basic-pitch', engine: 'onnx', model: 'basic-pitch',
      model_version: '0.4.0', code_version: 'test', audio_sha256: 'd'.repeat(64)},
  };
  const parsed = parseMusicDraftView(draft);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.automatic_corrections?.length, 1200);
});
