/**
 * Whole-performance alignment for reviewed music references.
 *
 * One global offset is selected from evidence distributed across the attempt.
 * The target interval and its required-note denominator are fixed before offset
 * candidates are evaluated; a short correct fragment can never shrink the target.
 * Shifted attack times may be negative, so this module deliberately does not reuse
 * the nonnegative-window semantics of `matchOnsets`.
 */
export type FitExpected = {id:string; onset:number; pitch:number; optional:boolean};
export type FitAttack = {id:string; pitch:number; time:number};
export type FitSpan = {start:number; end:number};
export type FitSearch = {min:number; max:number};
export type FitOptions = {
  toleranceSeconds?:number;
  histogramSeconds?:number;
  gaussianSigmaSeconds?:number;
  maxPeaks?:number;
  nonMaximumSeconds?:number;
  refineRadiusSeconds?:number;
  refineStepSeconds?:number;
  maxEvents?:number;
  maxPairSamples?:number;
  minVotes?:number;
  ambiguityRatio?:number;
  ambiguitySeparationSeconds?:number;
};
export type FitMatch = {expectedId:string; attackId:string; errorSeconds:number; optional:boolean};
export type FitCandidate = {
  offsetSeconds:number;
  votes:number;
  matchedRequired:number;
  matchedOptional:number;
  extra:number;
  value:number;
};
export type FitResult = {
  offsetSeconds:number;
  matches:FitMatch[];
  missingRequired:string[];
  extra:string[];
  expectedRequired:number;
  assessedRequired:number;
  matchedRequired:number;
  matchedOptional:number;
  unassessedRequired:number;
  outsideAttacks:number;
  referenceCoverage:number;
  captureCoverage:number;
  support:number;
  ambiguous:boolean;
  peakSeparationSeconds:number;
  candidates:FitCandidate[];
};

const DEFAULTS = {
  toleranceSeconds:0.15,
  histogramSeconds:0.02,
  gaussianSigmaSeconds:0.02,
  maxPeaks:8,
  nonMaximumSeconds:0.2,
  refineRadiusSeconds:0.1,
  refineStepSeconds:0.005,
  maxEvents:20000,
  maxPairSamples:250000,
  minVotes:3,
  ambiguityRatio:0.9,
  ambiguitySeparationSeconds:0.25,
};
const MAX_SEARCH_SECONDS = 3600;
const MAX_DP_CELLS = 300000;
const EPSILON = 1e-9;

type ResolvedOptions = Required<FitOptions>;
type NormalizedAttack = FitAttack & {corrected:number};

function resolved(options:FitOptions):ResolvedOptions {
  const value = {...DEFAULTS, ...options};
  if (!Number.isFinite(value.toleranceSeconds) || value.toleranceSeconds < 0 || value.toleranceSeconds > 1) throw new Error('Invalid alignment tolerance.');
  if (!Number.isFinite(value.histogramSeconds) || value.histogramSeconds <= 0) throw new Error('Invalid alignment histogram.');
  if (!Number.isFinite(value.gaussianSigmaSeconds) || value.gaussianSigmaSeconds <= 0) throw new Error('Invalid alignment smoothing.');
  if (!Number.isInteger(value.maxPeaks) || value.maxPeaks < 1 || value.maxPeaks > 32) throw new Error('Invalid alignment peak count.');
  if (!Number.isFinite(value.nonMaximumSeconds) || value.nonMaximumSeconds <= 0) throw new Error('Invalid alignment peak spacing.');
  if (!Number.isFinite(value.refineRadiusSeconds) || value.refineRadiusSeconds < 0 || value.refineRadiusSeconds > 1) throw new Error('Invalid alignment refinement radius.');
  if (!Number.isFinite(value.refineStepSeconds) || value.refineStepSeconds <= 0 || value.refineStepSeconds > 0.5) throw new Error('Invalid alignment refinement step.');
  if (!Number.isInteger(value.maxEvents) || value.maxEvents < 1 || value.maxEvents > 20000) throw new Error('Invalid alignment event limit.');
  if (!Number.isInteger(value.maxPairSamples) || value.maxPairSamples < 1 || value.maxPairSamples > 1000000) throw new Error('Invalid alignment pair limit.');
  if (!Number.isInteger(value.minVotes) || value.minVotes < 1) throw new Error('Invalid alignment vote minimum.');
  if (!Number.isFinite(value.ambiguityRatio) || value.ambiguityRatio <= 0 || value.ambiguityRatio > 1) throw new Error('Invalid alignment ambiguity ratio.');
  if (!Number.isFinite(value.ambiguitySeparationSeconds) || value.ambiguitySeparationSeconds <= 0) throw new Error('Invalid alignment ambiguity spacing.');
  return value;
}

function validate(expected:FitExpected[], attacks:FitAttack[], target:FitSpan, capture:FitSpan, search:FitSearch, options:ResolvedOptions):void {
  const values = [target.start, target.end, capture.start, capture.end, search.min, search.max];
  if (!values.every(Number.isFinite)) throw new Error('Invalid alignment range.');
  if (target.start < 0 || target.end <= target.start) throw new Error('Invalid alignment target.');
  if (capture.end <= capture.start) throw new Error('Invalid alignment capture range.');
  if (search.min > search.max || Math.abs(search.max - search.min) > MAX_SEARCH_SECONDS) throw new Error('Invalid alignment offset search.');
  if (expected.length > options.maxEvents || attacks.length > options.maxEvents) throw new Error('Too many alignment events.');
  const expectedIds = new Set<string>();
  for (const event of expected) {
    if (!event.id || eventIdsInvalid(event.id) || expectedIds.has(event.id)) throw new Error('Invalid alignment note identity.');
    expectedIds.add(event.id);
    if (!Number.isFinite(event.onset) || !Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127 || typeof event.optional !== 'boolean') throw new Error('Invalid alignment note evidence.');
  }
  const attackIds = new Set<string>();
  for (const event of attacks) {
    if (!event.id || eventIdsInvalid(event.id) || attackIds.has(event.id)) throw new Error('Invalid alignment attack identity.');
    attackIds.add(event.id);
    if (!Number.isFinite(event.time) || !Number.isInteger(event.pitch) || event.pitch < 0 || event.pitch > 127) throw new Error('Invalid alignment attack evidence.');
  }
}
function eventIdsInvalid(id:string):boolean { return id.length > 80; }

function overlapSeconds(left:FitSpan, right:FitSpan):number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

/** Equal-width time bins used only to describe where matches were observed. */
function quartileSupport(expected:FitExpected[], matched:Set<string>, target:FitSpan):number {
  const width = (target.end - target.start) / 4;
  if (!(width > 0)) return 0;
  let total = 0, bins = 0;
  for (let index = 0; index < 4; index += 1) {
    const start = target.start + index * width;
    const end = index === 3 ? target.end : start + width;
    const notes = expected.filter(note => !note.optional && note.onset >= start - EPSILON && note.onset < end - EPSILON);
    if (!notes.length) continue;
    bins += 1;
    total += notes.filter(note => matched.has(note.id)).length / notes.length;
  }
  return bins ? total / bins : 0;
}

function matchPitchNotes(notes:FitExpected[], attacks:NormalizedAttack[], tolerance:number):FitMatch[] {
  if (!notes.length || !attacks.length) return [];
  const sortedNotes = [...notes].sort((a,b) => a.onset - b.onset || a.pitch - b.pitch || a.id.localeCompare(b.id));
  const sortedAttacks = [...attacks].sort((a,b) => a.corrected - b.corrected || a.id.localeCompare(b.id));
  if (sortedNotes.length * sortedAttacks.length > MAX_DP_CELLS) {
    return greedyPitchNotes(sortedNotes, sortedAttacks, tolerance);
  }
  const columns = sortedAttacks.length + 1;
  const values = new Float64Array((sortedNotes.length + 1) * columns);
  const choices = new Uint8Array((sortedNotes.length + 1) * columns);
  for (let noteIndex = 1; noteIndex <= sortedNotes.length; noteIndex += 1) {
    const note = sortedNotes[noteIndex - 1];
    for (let attackIndex = 1; attackIndex <= sortedAttacks.length; attackIndex += 1) {
      const attack = sortedAttacks[attackIndex - 1];
      const offset = noteIndex * columns + attackIndex;
      const skipNote = values[(noteIndex - 1) * columns + attackIndex];
      const skipAttack = values[noteIndex * columns + attackIndex - 1];
      let best = skipNote >= skipAttack ? skipNote : skipAttack;
      let choice = skipNote >= skipAttack ? 1 : 2;
      const error = Math.abs(attack.corrected - note.onset);
      if (error <= tolerance + EPSILON) {
        const base = note.optional ? 500000 : 1000000;
        const quality = Math.round((1 - error / Math.max(tolerance, EPSILON)) * 1000);
        const matched = values[(noteIndex - 1) * columns + attackIndex - 1] + base + quality;
        if (matched >= best) { best = matched; choice = 3; }
      }
      values[offset] = best;
      choices[offset] = choice;
    }
  }
  const matches:FitMatch[] = [];
  let noteIndex = sortedNotes.length, attackIndex = sortedAttacks.length;
  while (noteIndex > 0 && attackIndex > 0) {
    const choice = choices[noteIndex * columns + attackIndex];
    if (choice === 3) {
      const note = sortedNotes[noteIndex - 1], attack = sortedAttacks[attackIndex - 1];
      matches.push({expectedId:note.id, attackId:attack.id, errorSeconds:attack.corrected - note.onset, optional:note.optional});
      noteIndex -= 1; attackIndex -= 1;
    } else if (choice === 2) attackIndex -= 1;
    else noteIndex -= 1;
  }
  return matches.reverse();
}

function greedyPitchNotes(notes:FitExpected[], attacks:NormalizedAttack[], tolerance:number):FitMatch[] {
  const matches:FitMatch[] = [];
  const used = new Set<string>();
  for (const optional of [false,true]) {
    for (const note of notes.filter(item => item.optional === optional)) {
      let best:NormalizedAttack|null = null;
      for (const attack of attacks) {
        if (used.has(attack.id)) continue;
        const error = Math.abs(attack.corrected - note.onset);
        if (error > tolerance + EPSILON) continue;
        if (!best || error < Math.abs(best.corrected - note.onset) || error === Math.abs(best.corrected - note.onset) && attack.id.localeCompare(best.id) < 0) best = attack;
      }
      if (best) {
        used.add(best.id);
        matches.push({expectedId:note.id, attackId:best.id, errorSeconds:best.corrected - note.onset, optional:note.optional});
      }
    }
  }
  return matches;
}

function evaluate(expected:FitExpected[], attacks:FitAttack[], target:FitSpan, capture:FitSpan, offset:number, tolerance:number):{
  matches:FitMatch[]; extra:string[]; missingRequired:string[];
  assessedRequired:number; matchedRequired:number; matchedOptional:number; value:number;
} {
  const withinTarget = expected.filter(note => note.onset >= target.start - EPSILON && note.onset < target.end - EPSILON);
  // Capture is in recording time. After a fitted delay g, the observed reference
  // span is capture - g; never compare reference notes with unshifted bounds.
  const observedStart = capture.start - offset;
  const observedEnd = capture.end - offset;
  const eligible = withinTarget.filter(note => note.onset - tolerance >= observedStart - EPSILON && note.onset + tolerance <= observedEnd + EPSILON);
  const assessedAttacks:NormalizedAttack[] = attacks.map(attack => ({...attack, corrected:attack.time - offset}))
    .filter(attack => attack.corrected >= target.start - tolerance - EPSILON && attack.corrected <= target.end + tolerance + EPSILON);
  const notesByPitch = new Map<number, FitExpected[]>();
  for (const note of eligible) notesByPitch.set(note.pitch, [...(notesByPitch.get(note.pitch) ?? []), note]);
  const attacksByPitch = new Map<number, NormalizedAttack[]>();
  for (const attack of assessedAttacks) attacksByPitch.set(attack.pitch, [...(attacksByPitch.get(attack.pitch) ?? []), attack]);
  const matches:FitMatch[] = [];
  for (const pitch of [...notesByPitch.keys()].sort((a,b) => a - b)) {
    matches.push(...matchPitchNotes(notesByPitch.get(pitch)!, attacksByPitch.get(pitch) ?? [], tolerance));
  }
  const used = new Set(matches.map(match => match.attackId));
  const extra = assessedAttacks.filter(attack => !used.has(attack.id)).map(attack => attack.id);
  const matchedRequired = matches.filter(match => !match.optional).length;
  const matchedOptional = matches.length - matchedRequired;
  const assessedRequired = eligible.filter(note => !note.optional).length;
  const matchedIds = new Set(matches.map(match => match.expectedId));
  const missingRequired = eligible.filter(note => !note.optional && !matchedIds.has(note.id)).map(note => note.id);
  const timingCost = matches.reduce((sum, match) => sum + Math.min(1, Math.abs(match.errorSeconds) / Math.max(tolerance, EPSILON)), 0);
  const value = matchedRequired * 1000 + matchedOptional * 100 - extra.length * 10 - timingCost;
  return {matches, extra, missingRequired, assessedRequired, matchedRequired, matchedOptional, value};
}

function candidateOffsets(expected:FitExpected[], attacks:FitAttack[], target:FitSpan, search:FitSearch, options:ResolvedOptions):{offsets:number[]; votes:Map<number,number>} {
  const byPitch = new Map<number, number[]>();
  for (const attack of attacks) {
    if (attack.time < target.start + search.min - options.toleranceSeconds - EPSILON || attack.time > target.end + search.max + options.toleranceSeconds + EPSILON) continue;
    byPitch.set(attack.pitch, [...(byPitch.get(attack.pitch) ?? []), attack.time]);
  }
  for (const values of byPitch.values()) values.sort((a,b) => a - b);
  const differences:number[] = [];
  const notes = expected.filter(note => note.onset >= target.start - EPSILON && note.onset < target.end - EPSILON);
  for (const note of notes) {
    const times = byPitch.get(note.pitch);
    if (!times?.length) continue;
    const low = note.onset + search.min, high = note.onset + search.max;
    let left = lowerBound(times, low), right = lowerBound(times, high + EPSILON);
    if (left >= right) continue;
    // Bound dense repeated-pitch material deterministically. The nearest samples
    // around the expected onset preserve the candidate histogram shape.
    if (right - left > 64) {
      const middle = (left + right) >> 1;
      left = Math.max(left, middle - 32);
      right = Math.min(right, middle + 32);
    }
    for (let index = left; index < right; index += 1) {
      differences.push(times[index] - note.onset);
      if (differences.length >= options.maxPairSamples) break;
    }
    if (differences.length >= options.maxPairSamples) break;
  }
  if (search.min <= 0 && search.max >= 0) differences.push(0);
  const bin = options.histogramSeconds;
  const binCount = Math.max(1, Math.floor((search.max - search.min) / bin) + 1);
  const histogram = new Float64Array(binCount);
  for (const difference of differences) {
    const index = Math.floor((difference - search.min) / bin);
    if (index >= 0 && index < binCount) histogram[index] += 1;
  }
  const radius = Math.max(1, Math.ceil((options.gaussianSigmaSeconds * 3) / bin));
  const kernel:number[] = [];
  for (let index = -radius; index <= radius; index += 1) kernel.push(Math.exp(-0.5 * (index * bin / options.gaussianSigmaSeconds) ** 2));
  const smoothed = new Float64Array(binCount);
  for (let index = 0; index < binCount; index += 1) {
    let total = 0;
    for (let kernelIndex = -radius; kernelIndex <= radius; kernelIndex += 1) {
      const source = index + kernelIndex;
      if (source >= 0 && source < binCount) total += histogram[source] * kernel[kernelIndex + radius];
    }
    smoothed[index] = total;
  }
  const peaks:{offset:number; weight:number}[] = [];
  for (let index = 0; index < binCount; index += 1) {
    if (!histogram[index]) continue;
    const weight = smoothed[index];
    const left = index ? smoothed[index - 1] : -Infinity;
    const right = index + 1 < binCount ? smoothed[index + 1] : -Infinity;
    if (weight >= left && weight >= right) peaks.push({offset:search.min + index * bin, weight});
  }
  peaks.sort((a,b) => b.weight - a.weight || a.offset - b.offset);
  const offsets:number[] = [];
  for (const peak of peaks) {
    if (offsets.length >= options.maxPeaks) break;
    if (offsets.some(offset => Math.abs(offset - peak.offset) < options.nonMaximumSeconds)) continue;
    offsets.push(peak.offset);
  }
  if (search.min <= 0 && search.max >= 0 && !offsets.some(offset => Math.abs(offset) < 1e-6)) offsets.push(0);
  if (!offsets.length) offsets.push(Math.max(search.min, Math.min(search.max, 0)));
  const votes = new Map<number,number>();
  for (const offset of offsets) votes.set(offset, differences.filter(value => Math.abs(value - offset) <= options.histogramSeconds).length);
  return {offsets, votes};
}

function lowerBound(values:number[], target:number):number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1; else high = middle;
  }
  return low;
}

export function bestFitAlign(input:{
  expected:FitExpected[];
  attacks:FitAttack[];
  target:FitSpan;
  capture:FitSpan;
  search:FitSearch;
  options?:FitOptions;
}):FitResult {
  const options = resolved(input.options ?? {});
  validate(input.expected, input.attacks, input.target, input.capture, input.search, options);
  const {offsets, votes} = candidateOffsets(input.expected, input.attacks, input.target, input.search, options);
  const evaluated:FitCandidate[] = [];
  for (const candidate of offsets) {
    let best:FitCandidate|null = null;
    const start = Math.max(input.search.min, candidate - options.refineRadiusSeconds);
    const end = Math.min(input.search.max, candidate + options.refineRadiusSeconds);
    for (let offset = start; offset <= end + EPSILON; offset += options.refineStepSeconds) {
      const rounded = Math.round(offset * 1000) / 1000;
      const result = evaluate(input.expected, input.attacks, input.target, input.capture, rounded, options.toleranceSeconds);
      const value = result.value;
      if (!best || value > best.value || value === best.value && rounded < best.offsetSeconds) {
        best = {offsetSeconds:rounded, votes:votes.get(candidate) ?? 0, matchedRequired:result.matchedRequired,
          matchedOptional:result.matchedOptional, extra:result.extra.length, value};
      }
    }
    if (best) evaluated.push(best);
  }
  evaluated.sort((a,b) => b.value - a.value || a.offsetSeconds - b.offsetSeconds);
  const unique:FitCandidate[] = [];
  for (const candidate of evaluated) {
    if (unique.some(item => Math.abs(item.offsetSeconds - candidate.offsetSeconds) < 0.005)) continue;
    unique.push(candidate);
  }
  const best = unique[0] ?? {offsetSeconds:0, votes:0, matchedRequired:0, matchedOptional:0, extra:0, value:0};
  const result = evaluate(input.expected, input.attacks, input.target, input.capture, best.offsetSeconds, options.toleranceSeconds);
  const targetNotes = input.expected.filter(note => note.onset >= input.target.start - EPSILON && note.onset < input.target.end - EPSILON);
  const observedStart = input.capture.start - best.offsetSeconds;
  const observedEnd = input.capture.end - best.offsetSeconds;
  const eligibleNotes = targetNotes.filter(note => note.onset - options.toleranceSeconds >= observedStart - EPSILON && note.onset + options.toleranceSeconds <= observedEnd + EPSILON);
  const expectedRequired = targetNotes.filter(note => !note.optional).length;
  const assessedRequired = eligibleNotes.filter(note => !note.optional).length;
  const matchedIds = new Set(result.matches.map(match => match.expectedId));
  const support = quartileSupport(input.expected, matchedIds, input.target);
  const competitor = unique.find(candidate => Math.abs(candidate.offsetSeconds - best.offsetSeconds) >= options.ambiguitySeparationSeconds);
  const ambiguous = Boolean(competitor && best.value > 0 && competitor.value >= best.value * options.ambiguityRatio);
  const peakSeparationSeconds = competitor ? Math.abs(competitor.offsetSeconds - best.offsetSeconds) : Math.max(0, input.search.max - input.search.min);
  const corrected = input.attacks.map(attack => attack.time - best.offsetSeconds);
  const outsideAttacks = corrected.filter(time => time < input.target.start - options.toleranceSeconds - EPSILON || time > input.target.end + options.toleranceSeconds + EPSILON).length;
  return {
    offsetSeconds:best.offsetSeconds,
    matches:result.matches,
    missingRequired:result.missingRequired,
    extra:result.extra,
    expectedRequired,
    assessedRequired,
    matchedRequired:result.matchedRequired,
    matchedOptional:result.matchedOptional,
    unassessedRequired:expectedRequired - assessedRequired,
    outsideAttacks,
    referenceCoverage:expectedRequired ? assessedRequired / expectedRequired : 0,
    captureCoverage:overlapSeconds({start:observedStart,end:observedEnd}, input.target) / (input.target.end - input.target.start),
    support,
    ambiguous,
    peakSeparationSeconds,
    candidates:unique.slice(0, options.maxPeaks),
  };
}

/** Capture coverage helper for callers that know the intended recording range. */
export function captureCoverage(target:FitSpan, capture:FitSpan):number {
  return Math.max(0, Math.min(1, overlapSeconds(target, capture) / (target.end - target.start)));
}
