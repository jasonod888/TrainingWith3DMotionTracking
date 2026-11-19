/**
 * Versioned assessment contract for whole-performance music attempts.
 *
 * The experimental policy intentionally reports `score: null` in product use.
 * Counts, offset, coverage and timing evidence remain available so a learner gets
 * useful feedback before any physical-device or browser qualification exists.
 */
import type {FitAttack, FitExpected, FitResult, FitSpan} from './best-fit-align';

export type MusicAssessmentPolicy = {
  version:'music-assessment-v1';
  rubricVersion:string;
  scorerVersion:string;
  /** Product qualification is separate from the deterministic formula. */
  qualified:boolean;
  toleranceSeconds:number;
  onTimeSeconds:number;
  timingSigmaSeconds:number;
  minReferenceCoverage:number;
  minCaptureCoverage:number;
  weights:{pitch:number; extra:number; timing:number};
};

export const EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY:MusicAssessmentPolicy = Object.freeze({
  version:'music-assessment-v1',
  rubricVersion:'piano-midi-v1',
  scorerVersion:'piano-challenge-v1',
  qualified:false,
  toleranceSeconds:0.15,
  onTimeSeconds:0.06,
  timingSigmaSeconds:0.1,
  minReferenceCoverage:0.8,
  minCaptureCoverage:0.75,
  weights:{pitch:0.7, extra:0.15, timing:0.15},
});

export function validateMusicAssessmentPolicy(policy:MusicAssessmentPolicy):void {
  if (policy.version !== 'music-assessment-v1' || !policy.rubricVersion || !policy.scorerVersion) throw new Error('Invalid assessment policy identity.');
  if (!Number.isFinite(policy.toleranceSeconds) || policy.toleranceSeconds <= 0 || policy.toleranceSeconds > 1) throw new Error('Invalid assessment tolerance.');
  if (!Number.isFinite(policy.onTimeSeconds) || policy.onTimeSeconds <= 0 || policy.onTimeSeconds > policy.toleranceSeconds) throw new Error('Invalid assessment on-time window.');
  if (!Number.isFinite(policy.timingSigmaSeconds) || policy.timingSigmaSeconds <= 0 || policy.timingSigmaSeconds > 1) throw new Error('Invalid assessment timing scale.');
  if (!Number.isFinite(policy.minReferenceCoverage) || policy.minReferenceCoverage <= 0 || policy.minReferenceCoverage > 1) throw new Error('Invalid reference coverage threshold.');
  if (!Number.isFinite(policy.minCaptureCoverage) || policy.minCaptureCoverage <= 0 || policy.minCaptureCoverage > 1) throw new Error('Invalid capture coverage threshold.');
  const weights = Object.values(policy.weights);
  if (weights.some(value => !Number.isFinite(value) || value < 0) || Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-6) throw new Error('Assessment weights must sum to one.');
}

/** A short reference can still be assessed, but a one-note section is never a full challenge. */
export function minimumMatchedForScore(assessedRequired:number):number {
  if (assessedRequired <= 0) return 0;
  if (assessedRequired <= 8) return Math.max(1, Math.ceil(assessedRequired / 2));
  return Math.min(assessedRequired, Math.max(8, Math.ceil(assessedRequired * 0.1)));
}

/** Minimum reliable matched events before timing is summarized at all. */
export function minimumTimingMatches(assessedRequired:number):number {
  if (assessedRequired <= 0) return 0;
  if (assessedRequired <= 8) return Math.max(1, Math.ceil(assessedRequired / 2));
  return Math.max(3, Math.min(8, Math.ceil(assessedRequired * 0.1)));
}

export type TimingConfidence = 'none' | 'limited' | 'normal';
export type AssessmentNoteStatus = 'matched' | 'missing' | 'extra' | 'unassessed';
export type AssessmentNote = {
  id:string;
  pitch:number;
  status:AssessmentNoteStatus;
  time:number;
  errorSeconds:number|null;
  timing:'early' | 'late' | 'on-time' | null;
  optional:boolean;
};
export type SectionAssessment = {
  id:string;
  label:string;
  start:number;
  end:number;
  expectedRequired:number;
  assessedRequired:number;
  matchedRequired:number;
  missingRequired:number;
  extra:number;
  referenceCoverage:number;
  recall:number|null;
  timing:TimingSummary;
};
export type TimingSummary = {
  available:boolean;
  confidence:TimingConfidence;
  matches:number;
  meanAbsoluteErrorSeconds:number|null;
  score:number|null;
  onTime:number;
  early:number;
  late:number;
};
export type MusicAssessmentReport = {
  version:1;
  rubricVersion:string;
  scorerVersion:string;
  policyQualified:boolean;
  score:number|null;
  scoreReason:string|null;
  reasons:string[];
  offsetSeconds:number;
  offsetRealSeconds:number;
  speed:number;
  expectedRequired:number;
  assessedRequired:number;
  matchedRequired:number;
  matchedOptional:number;
  missingRequired:number;
  extra:number;
  extraOutsideSections:number;
  unassessedRequired:number;
  outsideAttacks:number;
  referenceCoverage:number;
  captureCoverage:number;
  support:number;
  ambiguous:boolean;
  peakSeparationSeconds:number;
  timing:TimingSummary;
  components:{
    pitchRecall:number|null;
    extraRate:number|null;
    timingScore:number|null;
    composite:number|null;
  };
  sections:SectionAssessment[];
  notes:AssessmentNote[];
  latencyMeasured:boolean;
  inputLatencyMs:number;
  modelProfile:string|null;
};

function finite(value:number):boolean { return Number.isFinite(value); }
function clamp(value:number, low:number, high:number):number { return Math.max(low, Math.min(high, value)); }
function timingDirection(error:number, policy:MusicAssessmentPolicy):'early' | 'late' | 'on-time' {
  if (Math.abs(error) <= policy.onTimeSeconds) return 'on-time';
  return error < 0 ? 'early' : 'late';
}
function timingFor(errors:number[], assessedRequired:number, policy:MusicAssessmentPolicy, matched:number):TimingSummary {
  const minimum = minimumTimingMatches(assessedRequired);
  const available = matched > 0 && matched >= minimum;
  // A tiny section can still have normal confidence when most of it was matched;
  // larger sections need a broader sample before timing is called normal.
  const normalThreshold = assessedRequired <= 8
    ? Math.max(1, Math.ceil(assessedRequired * 0.75))
    : Math.max(6, Math.min(12, Math.ceil(assessedRequired * 0.25)));
  const confidence:TimingConfidence = !available ? 'none' : matched >= normalThreshold ? 'normal' : 'limited';
  if (!available) return {available:false, confidence:'none', matches:matched, meanAbsoluteErrorSeconds:null, score:null, onTime:0, early:0, late:0};
  // Keep the signed error for direction; absolute error feeds MAE/kernel only.
  const mean = errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length;
  const score = errors.reduce((sum, value) => sum + Math.exp(-0.5 * (Math.abs(value) / policy.timingSigmaSeconds) ** 2), 0) / errors.length;
  return {
    available:true,
    confidence,
    matches:matched,
    meanAbsoluteErrorSeconds:mean,
    score,
    onTime:errors.filter(value => Math.abs(value) <= policy.onTimeSeconds).length,
    early:errors.filter(value => value < -policy.onTimeSeconds).length,
    late:errors.filter(value => value > policy.onTimeSeconds).length,
  };
}

export function assessMusicAttempt(input:{
  fit:FitResult;
  expected:FitExpected[];
  attacks:FitAttack[];
  capture:FitSpan;
  target:FitSpan;
  sections:{id:string; label:string; start:number; end:number}[];
  policy?:MusicAssessmentPolicy;
  speed:number;
  latencyMeasured?:boolean;
  inputLatencyMs?:number;
  modelProfile?:string|null;
}):MusicAssessmentReport {
  const policy = input.policy ?? EXPERIMENTAL_MUSIC_ASSESSMENT_POLICY;
  validateMusicAssessmentPolicy(policy);
  if (!finite(input.speed) || input.speed <= 0 || !finite(input.target.start) || !finite(input.target.end) || input.target.end <= input.target.start) {
    throw new Error('Invalid assessment timing.');
  }
  const {fit} = input;
  const matchedRequired = fit.matches.filter(match => !match.optional);
  const expectedById = new Map(input.expected.map(note => [note.id, note]));
  const attackById = new Map(input.attacks.map(attack => [attack.id, attack]));
  const matchedIds = new Set(fit.matches.map(match => match.expectedId));
  const extraIds = new Set(fit.extra);
  const targetNotes = input.expected.filter(note => note.onset >= input.target.start - 1e-9 && note.onset < input.target.end - 1e-9);
  // The capture span is in recording time; after a fitted delay the observed
  // reference span is capture - offset. Eligibility must use that same shift.
  const observedStart = input.capture.start - fit.offsetSeconds;
  const observedEnd = input.capture.end - fit.offsetSeconds;
  const eligible = (note:FitExpected) => note.onset - policy.toleranceSeconds >= observedStart - 1e-9
    && note.onset + policy.toleranceSeconds <= observedEnd + 1e-9;
  const requiredErrors = matchedRequired.map(match => match.errorSeconds);
  const timing = timingFor(requiredErrors, fit.assessedRequired, policy, matchedRequired.length);
  const pitchRecall = fit.assessedRequired > 0 ? fit.matchedRequired / fit.assessedRequired : null;
  const extraRate = fit.matchedRequired + fit.extra.length > 0
    ? fit.extra.length / (fit.matchedRequired + fit.extra.length) : null;
  const composite = fit.matchedRequired > 0 && pitchRecall !== null && extraRate !== null && timing.score !== null
    ? 100 * (policy.weights.pitch * pitchRecall
      + policy.weights.extra * (1 - extraRate)
      + policy.weights.timing * timing.score)
    : null;

  const reasons:string[] = [];
  if (fit.expectedRequired === 0) reasons.push('no-reference-notes');
  if (fit.assessedRequired === 0) reasons.push('no-assessed-notes');
  if (fit.matchedRequired === 0) reasons.push('no-matched-notes');
  if (fit.referenceCoverage < policy.minReferenceCoverage) reasons.push('insufficient-reference-coverage');
  if (fit.captureCoverage < policy.minCaptureCoverage) reasons.push('insufficient-capture-coverage');
  if (fit.ambiguous) reasons.push('ambiguous-alignment');
  if (!timing.available) reasons.push('insufficient-timing-evidence');
  if (fit.matchedRequired < minimumMatchedForScore(fit.assessedRequired)) reasons.push('too-few-matched-notes');
  if (!policy.qualified) reasons.push('experimental-policy');
  const score = reasons.length === 0 && composite !== null ? Math.round(clamp(composite, 0, 100)) : null;

  const sectionExtras = new Array(input.sections.length).fill(0);
  let extraOutsideSections = 0;
  for (const id of extraIds) {
    const attack = attackById.get(id);
    if (!attack) continue;
    const time = attack.time - fit.offsetSeconds;
    const index = input.sections.findIndex(section => time >= section.start - 1e-9 && time < section.end - 1e-9);
    if (index >= 0) sectionExtras[index] += 1;
    else extraOutsideSections += 1;
  }
  const sections:SectionAssessment[] = input.sections.map((section,sectionIndex) => {
    const expected = targetNotes.filter(note => !note.optional && note.onset >= section.start - 1e-9 && note.onset < section.end - 1e-9);
    const assessed = expected.filter(eligible);
    const matched = matchedRequired.filter(match => {
      const note = expectedById.get(match.expectedId);
      return Boolean(note && note.onset >= section.start - 1e-9 && note.onset < section.end - 1e-9);
    });
    const errors = matched.map(match => match.errorSeconds);
    const extra = sectionExtras[sectionIndex];
    return {
      id:section.id,
      label:section.label,
      start:section.start,
      end:section.end,
      expectedRequired:expected.length,
      assessedRequired:assessed.length,
      matchedRequired:matched.length,
      missingRequired:Math.max(0, assessed.length - matched.length),
      extra,
      referenceCoverage:expected.length ? assessed.length / expected.length : 0,
      recall:assessed.length ? matched.length / assessed.length : null,
      timing:timingFor(errors, assessed.length, policy, matched.length),
    };
  });

  const notes:AssessmentNote[] = targetNotes.map(note => {
    if (!eligible(note)) return {id:note.id, pitch:note.pitch, status:'unassessed', time:note.onset, errorSeconds:null, timing:null, optional:note.optional};
    const match = fit.matches.find(item => item.expectedId === note.id);
    if (match) return {id:note.id, pitch:note.pitch, status:'matched', time:note.onset,
      errorSeconds:match.errorSeconds, timing:timingDirection(match.errorSeconds, policy), optional:note.optional};
    // Optional notes absorb valid input and never create missing-note corrections.
    if (note.optional) return {id:note.id, pitch:note.pitch, status:'unassessed', time:note.onset, errorSeconds:null, timing:null, optional:true};
    return {id:note.id, pitch:note.pitch, status:'missing', time:note.onset, errorSeconds:null, timing:null, optional:false};
  });
  for (const id of fit.extra) {
    const attack = attackById.get(id);
    if (attack) notes.push({id:attack.id, pitch:attack.pitch, status:'extra', time:attack.time - fit.offsetSeconds,
      errorSeconds:null, timing:null, optional:false});
  }
  notes.sort((left, right) => left.time - right.time || left.pitch - right.pitch || left.id.localeCompare(right.id));

  return {
    version:1,
    rubricVersion:policy.rubricVersion,
    scorerVersion:policy.scorerVersion,
    policyQualified:policy.qualified,
    score,
    scoreReason:reasons[0] ?? null,
    reasons,
    offsetSeconds:fit.offsetSeconds,
    offsetRealSeconds:fit.offsetSeconds / input.speed,
    speed:input.speed,
    expectedRequired:fit.expectedRequired,
    assessedRequired:fit.assessedRequired,
    matchedRequired:fit.matchedRequired,
    matchedOptional:fit.matchedOptional,
    missingRequired:fit.missingRequired.length,
    extra:fit.extra.length,
    extraOutsideSections,
    unassessedRequired:fit.unassessedRequired,
    outsideAttacks:fit.outsideAttacks,
    referenceCoverage:fit.referenceCoverage,
    captureCoverage:fit.captureCoverage,
    support:fit.support,
    ambiguous:fit.ambiguous,
    peakSeparationSeconds:fit.peakSeparationSeconds,
    timing,
    components:{pitchRecall, extraRate, timingScore:timing.score, composite},
    sections,
    notes,
    latencyMeasured:input.latencyMeasured === true,
    inputLatencyMs:Number.isFinite(input.inputLatencyMs) ? Math.max(0, input.inputLatencyMs ?? 0) : 0,
    modelProfile:input.modelProfile ?? null,
  };
}
