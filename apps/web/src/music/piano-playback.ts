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
