/** Gated, local, unscored feedback for explicitly MIDI-enabled piano rubrics. */
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import {attackSourceTime, matchOnsets, type Attack, type ExpectedAttack, type RunClock} from '../../../../packages/music-engine/onsets';
import {pitchName, type MusicReference} from './music-reference';

export type FeedbackEligibility = {eligible: boolean; reasons: string[]; warnings: string[]};

export function feedbackEligibility(input: {
  assessment: MusicLessonManifest['assessment'];
  subject: string;
  referenceReviewed: boolean;
  inputSelected: boolean;
  latencyMeasured: boolean;
}): FeedbackEligibility {
  const reasons: string[] = [];
  if (input.assessment.assessment !== 'notes') reasons.push('This lesson has no MIDI note rubric.');
  if (!(input.assessment.input_modes ?? []).includes('midi')) reasons.push('This lesson does not accept MIDI input.');
  if (input.assessment.rubric_version !== 'piano-midi-v1' ||
      !input.assessment.dimensions.includes('pitch') || !input.assessment.dimensions.includes('timing') ||
      input.assessment.dimensions.some(dimension => dimension !== 'pitch' && dimension !== 'timing'))
    reasons.push('This rubric version or its dimensions are not supported by local note feedback.');
  if (input.subject !== 'piano') reasons.push('MIDI feedback is only available for piano lessons.');
  if (!input.referenceReviewed) reasons.push('The reference is not reviewed.');
  if (!input.inputSelected) reasons.push('Choose a connected keyboard input.');
  return {
    eligible: reasons.length === 0,
    reasons,
    warnings: ['Timing feedback is approximate. Visual tapping estimates personal alignment, not hardware latency.'],
  };
}

/** Median personal alignment estimate. Visual taps include human anticipation/reaction. */
export function calibrateLatency(samples: number[]): number {
  const valid = samples.filter(value => Number.isFinite(value) && value >= 0 && value <= 300);
  if (valid.length < 4) throw new Error('Play at least four notes with the pulses to measure delay.');
  const sorted = [...valid].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(median);
}

export type FeedbackNote = {
  status: 'matched' | 'missing' | 'extra';
  pitch: number;
  name: string;
  optional: boolean;
  errorSeconds: number | null;
  timing: 'early' | 'late' | 'on-time' | null;
};
export type MusicFeedback = {
  version: 1;
  status: 'complete' | 'invalid';
  reason: string | null;
  run: number;
  sectionId: string;
  window: {start: number; end: number};
  matched: number;
  missing: number;
  extra: number;
  unassessed: number;
  total: number;
  assessed: number;
  /** Reference-note window eligibility, not observed-input coverage or accuracy. */
  coverage: number;
  latencyMeasured: boolean;
  speed: number;
  notes: FeedbackNote[];
};

export function invalidFeedback(reason: string, run: number, sectionId: string): MusicFeedback {
  return {version: 1, status: 'invalid', reason, run, sectionId, window: {start: 0, end: 0},
    matched: 0, missing: 0, extra: 0, unassessed: 0, total: 0, assessed: 0, coverage: 0, latencyMeasured: false, speed: 1, notes: []};
}

/**
 * Build local corrections for one fully observed repeat. The caller authorises the exact
 * reviewed reference, rubric and MIDI input; this function only analyses the window.
 */
export function buildRunFeedback(input: {
  reference: MusicReference;
  sectionId: string;
  start: number;
  end: number;
  speed: number;
  run: number;
  attacks: Attack[];
  latencyMs: number;
  latencyMeasured: boolean;
  tolerance?: number;
}): MusicFeedback {
  if (!Number.isFinite(input.speed) || input.speed <= 0 || !Number.isFinite(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 300 ||
      !Number.isInteger(input.run) || input.run < 0 || input.start < 0 || input.end > input.reference.duration)
    return invalidFeedback('Invalid run evidence.', input.run, input.sectionId);
  const tolerance = input.tolerance ?? 0.15;
  const window = {start: input.start, end: input.end};
  const hasSpans = input.reference.spans.length > 0;
  const playing = input.reference.spans.filter(span => span.kind !== 'explanation');
  const assessable = (time: number) => !hasSpans || playing.some(span => time >= span.start - 1e-6 && time < span.end);
  const expected: ExpectedAttack[] = input.reference.events
    .filter(event => event.onset >= window.start - 1e-6 && event.onset < window.end && assessable(event.onset))
    .map(event => ({id: event.id, pitch: event.pitch, onset: event.onset, optional: event.optional}));
  const attacks = input.attacks.filter(attack => assessable(attack.sourceTime));
  let result;
  try {
    result = matchOnsets(expected, attacks, window, tolerance);
  } catch (error) {
    return invalidFeedback(error instanceof Error ? error.message : 'The run could not be analysed.', input.run, input.sectionId);
  }
  const notes: FeedbackNote[] = [];
  for (const match of result.matches) {
    const note = expected.find(item => item.id === match.expectedId);
    if (!note) continue;
    const errorSeconds = Number(match.errorSeconds.toFixed(3));
    notes.push({status: 'matched', pitch: note.pitch, name: pitchName(note.pitch), optional: match.optional,
      errorSeconds, timing: Math.abs(errorSeconds) <= 0.06 ? 'on-time' : errorSeconds < 0 ? 'early' : 'late'});
  }
  for (const id of result.missing) {
    const note = expected.find(item => item.id === id);
    if (note) notes.push({status: 'missing', pitch: note.pitch, name: pitchName(note.pitch), optional: false, errorSeconds: null, timing: null});
  }
  for (const id of result.extra) {
    const attack = input.attacks.find(item => item.id === id);
    if (attack) notes.push({status: 'extra', pitch: attack.pitch, name: pitchName(attack.pitch), optional: false, errorSeconds: null, timing: null});
  }
  notes.sort((left, right) => (left.errorSeconds ?? 0) - (right.errorSeconds ?? 0) || left.pitch - right.pitch);
  const total = expected.length, assessed = total - result.unassessed;
  return {version: 1, status: 'complete', reason: null, run: input.run, sectionId: input.sectionId,
    window, matched: result.matches.length, missing: result.missing.length, extra: result.extra.length,
    unassessed: result.unassessed, total, assessed, coverage: total ? assessed / total : 0,
    latencyMeasured: input.latencyMeasured, speed: input.speed, notes};
}

export type {Attack, RunClock};
