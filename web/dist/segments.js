export function validateSegments(segments,duration){
  if(!Array.isArray(segments)||!segments.length)throw new Error('Keep at least one section.');
  let previous=0;
  return segments.map((s,i)=>{
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||Math.abs(s.start-previous)>.001||s.end-s.start<.05||s.end>duration+.001)throw new Error(`Section ${i+1}: times must be consecutive and at least 0.05 seconds apart.`);
    if(i===segments.length-1&&Math.abs(s.end-duration)>.001)throw new Error('The final section must end at the end of the lesson.');
    previous=s.end;return {label:String(s.label||`Section ${i+1}`).trim().slice(0,80),start:s.start,end:s.end};
  });
}
export function defaultSegments(duration){
  // Hand-set prototype boundaries, in animation seconds (source starts at 5.5055).
  const ends=[10.6,12.5,13.7,14.9,16,17.2,18.1,19.3,20.5,21.7,22.6,24.1,24.8,26,27.5,29,30.3,31.7,35.5].filter(t=>t<duration-.05);
  const boundaries=[0,...ends,duration];
  return validateSegments(boundaries.slice(0,-1).map((start,i)=>({start,end:boundaries[i+1],label:i===0?'Opening bow & ready':i===boundaries.length-2?'Finish & bow':`Move ${String(i).padStart(2,'0')}`})),duration);
}
export class SectionSequence{
  constructor(segments,duration){this.duration=duration;this.segments=validateSegments(segments,duration);this.index=-1;}
  get current(){return this.segments[this.index]??null;}
  command(command){
    if(command==='next'){if(this.index>=this.segments.length-1)return null;this.index++;}
    else if(command==='back')this.index=Math.max(0,this.index-1);
    else if(command==='again')this.index=Math.max(0,this.index);
    else throw new Error('Unknown section command');
    return this.current;
  }
  seek(time){this.index=this.segments.findIndex((s,i)=>time>=s.start&&(time<s.end||i===this.segments.length-1));return this.current;}
  split(time){
    const i=this.segments.findIndex(s=>time-s.start>=.05&&s.end-time>=.05);
    if(i<0)throw new Error('Pause inside a section, away from its edges, to add a split.');
    const s=this.segments[i];this.segments.splice(i,1,{...s,end:time},{label:`${s.label} · part 2`,start:time,end:s.end});this.seek(time);
  }
  mergeNext(i){
    if(i<0||i>=this.segments.length-1)throw new Error('There is no following section to merge.');
    this.segments.splice(i,2,{...this.segments[i],end:this.segments[i+1].end});this.index=-1;
  }
}
