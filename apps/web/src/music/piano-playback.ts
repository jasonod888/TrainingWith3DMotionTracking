/** Shared Original/Piano clock mapping. Kept pure so it can be tested without media. */
export const PIANO_DRIFT_RESYNC_SECONDS = 0.04;
export const PIANO_OFFSET_LIMIT_SECONDS = 10;

/** Source media time is the authority; positive offset means notes/piano play later. */
export function pianoTimeFor(sourceTime:number, offsetSeconds:number):number{
 return sourceTime-offsetSeconds;
}

export function needsPianoResync(currentTime:number, mappedTime:number,
                                 lastResyncSeconds=0, nowSeconds=0):boolean{
 if(!Number.isFinite(currentTime)||!Number.isFinite(mappedTime))return false;
 const drift=Math.abs(currentTime-mappedTime);
 if(drift<=PIANO_DRIFT_RESYNC_SECONDS)return false;
 // Hysteresis: a recent correction holds up to the larger threshold before seeking again.
 if(lastResyncSeconds>0&&nowSeconds-lastResyncSeconds<0.15&&drift<0.06)return false;
 return true;
}

export function clampOffsetSeconds(value:number):number{
 if(!Number.isFinite(value))return 0;
 return Math.max(-PIANO_OFFSET_LIMIT_SECONDS,Math.min(PIANO_OFFSET_LIMIT_SECONDS,value));
}

export function shiftOnset(onset:number, offsetSeconds:number):number{
 return onset+offsetSeconds;
}

/** Negative shifted starts stay visible when they are still active at source zero. */
export function isNoteActive(onset:number, duration:number|null, offsetSeconds:number,
                             sourceTime:number):boolean{
 const start=shiftOnset(onset,offsetSeconds);
 const end=start+(duration??0);
 return sourceTime>=start&&sourceTime<end;
}

export function isNoteVisible(onset:number, duration:number|null, offsetSeconds:number,
                              clipDuration:number):boolean{
 const start=shiftOnset(onset,offsetSeconds);
 return start<clipDuration&&start+(duration??0)>0;
}

export type AudibleNoteTiming = {
  onset: number;
  soundingDuration: number;
  dampedByKey: boolean;
};

type PedalSpan = {onset: number; offset: number; type?: string};

/** Resolve the audible ring separately from the visible/notated note duration. */
export function resolveAudibleNoteTiming(
  note: {id: string; pitch: number; onset: number; duration: number | null},
  pedalSpans?: readonly PedalSpan[] | null,
  nextSamePitchOnset?: number | null,
): AudibleNoteTiming {
  const rawDuration = Math.max(0.05, note.duration ?? 0.35);
  const keyRelease = note.onset + rawDuration;
  const covering = (pedalSpans ?? [])
    .filter(span => (span.type ?? 'sustain') === 'sustain'
      && Number.isFinite(span.onset) && Number.isFinite(span.offset)
      && span.onset <= keyRelease && keyRelease < span.offset)
    .sort((left, right) => right.offset - left.offset)[0];
  let soundingDuration: number;
  let dampedByKey: boolean;
  if (covering) {
    const maxRing = Math.max(1.2, Math.min(6.5, 4.5 + (60 - note.pitch) * 0.04));
    soundingDuration = Math.min(covering.offset - note.onset, maxRing);
    dampedByKey = false;
  } else {
    // A tiny unpedalled frame still needs a natural acoustic ring, not a click.
    soundingDuration = Math.max(0.22, rawDuration);
    dampedByKey = true;
  }
  if (nextSamePitchOnset !== null && nextSamePitchOnset !== undefined
    && nextSamePitchOnset > note.onset + 0.04
    && nextSamePitchOnset - note.onset < soundingDuration) {
    soundingDuration = nextSamePitchOnset - note.onset;
  }
  return {onset: note.onset, soundingDuration: Math.max(0.08, soundingDuration), dampedByKey};
}

export function resolvePerformanceAudibleTimings(
  performance: readonly {id: string; pitch: number; onset: number; duration: number | null}[],
  pedalSpans?: readonly PedalSpan[] | null,
): Map<string, AudibleNoteTiming> {
  const byPitch = new Map<number, {id: string; onset: number}[]>();
  for (const note of performance) {
    const list = byPitch.get(note.pitch) ?? [];
    list.push({id: note.id, onset: note.onset});
    byPitch.set(note.pitch, list);
  }
  for (const list of byPitch.values()) {
    list.sort((left, right) => left.onset - right.onset || left.id.localeCompare(right.id));
  }
  const sortedIndexById = new Map<string, number>();
  for (const list of byPitch.values()) {
    list.forEach((item, index) => sortedIndexById.set(item.id, index));
  }
  const result = new Map<string, AudibleNoteTiming>();
  for (const note of performance) {
    const list = byPitch.get(note.pitch)!;
    const index = sortedIndexById.get(note.id) ?? -1;
    const next = index >= 0 ? list[index + 1]?.onset ?? null : null;
    result.set(note.id, resolveAudibleNoteTiming(note, pedalSpans, next));
  }
  return result;
}
