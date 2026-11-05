/** Experimental local onset analysis. No rubric approval, score, browser or persistence. */
export type Attack = {id:string; pitch:number; sourceTime:number};
export type ExpectedAttack = {id:string; pitch:number; onset:number; optional:boolean};
export type RunClock = {
  wallStartMs:number; sourceStart:number; sourceEnd:number; speed:number;
  /** Measured observation delay in the same monotonic clock as the MIDI timestamp. */
  inputLatencyMs:number;
};

/** Use MIDIMessageEvent.timeStamp, not a React render time. One clock per repeat. */
export function attackSourceTime(timestampMs:number, clock:RunClock):number|null {
  const values=[timestampMs,clock.wallStartMs,clock.sourceStart,clock.sourceEnd,clock.speed,clock.inputLatencyMs];
  if(!values.every(Number.isFinite)||clock.speed<=0||clock.sourceStart<0||clock.sourceEnd<=clock.sourceStart||clock.inputLatencyMs<0||clock.inputLatencyMs>1000)
    throw new Error('Invalid measured run clock.');
  const time=clock.sourceStart+(timestampMs-clock.inputLatencyMs-clock.wallStartMs)*clock.speed/1000;
  return time>=clock.sourceStart&&time<clock.sourceEnd?time:null;
}

/**
 * Analyse a fully observed window only. Caller must discard interrupted runs and
 * separately authorize the exact reference/revision, rubric and latency evidence.
 * Tolerance is in reviewed source seconds, so speed does not change this policy.
 * Required attacks get priority; optional attacks can absorb remaining input but
 * never produce missing-note corrections. Matches are one-to-one and exact pitch.
 */
export function matchOnsets(expected:ExpectedAttack[], attacks:Attack[], window:{start:number;end:number}, tolerance:number) {
  if(![window.start,window.end,tolerance].every(Number.isFinite)||window.start<0||window.end<=window.start||tolerance<0||tolerance>1||expected.length>20000||attacks.length>20000)
    throw new Error('Invalid observed window.');
  const validate=(events:{id:string;pitch:number}[],times:number[])=>{
    if(new Set(events.map(event=>event.id)).size!==events.length||events.some(event=>!event.id||!Number.isInteger(event.pitch)||event.pitch<0||event.pitch>127)||times.some(time=>!Number.isFinite(time)||time<0))throw new Error('Invalid onset evidence.');
  };
  validate(expected,expected.map(event=>event.onset));validate(attacks,attacks.map(event=>event.sourceTime));
  if(expected.some(event=>typeof event.optional!=='boolean'))throw new Error('Invalid optional-note flag.');
  // Edge notes lack a complete tolerance window and cannot support a correction.
  const eligible=expected.filter(event=>event.onset-tolerance>=window.start&&event.onset+tolerance<window.end);
  const observed=attacks.filter(event=>event.sourceTime>=window.start&&event.sourceTime<window.end);
  const used=new Set<string>();
  const matches:{expectedId:string;attackId:string;errorSeconds:number;optional:boolean}[]=[];
  const missing:string[]=[];
  for(const optional of [false,true])for(let pitch=0;pitch<128;pitch++){
    const notes=eligible.filter(event=>event.pitch===pitch&&event.optional===optional).sort((a,b)=>a.onset-b.onset);
    const played=observed.filter(event=>event.pitch===pitch&&!used.has(event.id)).sort((a,b)=>a.sourceTime-b.sourceTime);
    let index=0;
    for(const note of notes){
      while(index<played.length&&played[index].sourceTime<note.onset-tolerance)index++;
      const attack=played[index];
      if(attack&&attack.sourceTime<=note.onset+tolerance){used.add(attack.id);index++;matches.push({expectedId:note.id,attackId:attack.id,errorSeconds:attack.sourceTime-note.onset,optional});}
      else if(!optional)missing.push(note.id);
    }
  }
  // Inputs near excluded edge notes are unassessed, rather than false extra notes.
  const eligibleIds=new Set(eligible.map(event=>event.id));
  const excluded=expected.filter(event=>!eligibleIds.has(event.id));
  const extra=observed.filter(attack=>!used.has(attack.id)&&!excluded.some(note=>note.pitch===attack.pitch&&Math.abs(note.onset-attack.sourceTime)<=tolerance)).map(event=>event.id);
  return {matches,missing,extra,unassessed:expected.length-eligible.length};
}
