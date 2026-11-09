/** Phase 6D foundation only. Evaluates evidence readiness, never a grade or score. */
export type Span = {start:number;end:number};
export type ScoringPolicy = {
  version:'piano-midi-readiness-v1';
  referenceSha256:string; revisionId:string; rubricVersion:string;
  /** Explicit assessment coverage reviewed for this reference; not teaching passages. */
  assessable:Span[];
  minCoverage:number; minRequiredNotes:number; maxPolyphony:number;
  allowedSpeeds:number[];
  /** Set only after physical-device false-correction/coverage qualification. */
  qualified:boolean;
};

function merge(spans:Span[]):Span[] {
  const sorted=spans.map(span=>({...span})).sort((a,b)=>a.start-b.start);
  const result:Span[]=[];
  for(const span of sorted){const previous=result[result.length-1];if(previous&&span.start<=previous.end)previous.end=Math.max(previous.end,span.end);else result.push(span);}
  return result;
}
const validSpan=(span:Span)=>Number.isFinite(span.start)&&Number.isFinite(span.end)&&span.start>=0&&span.end>span.start;
const seconds=(spans:Span[])=>spans.reduce((total,span)=>total+span.end-span.start,0);

export function scoringReadiness(input:{
  policy:ScoringPolicy;
  referenceSha256:string;revisionId:string;rubricVersion:string;
  range:Span; observed:Span[]; interrupted:boolean;
  latencyEvidence:'none'|'visual-alignment'|'device-qualified';
  requiredNotes:number; polyphony:number; speed:number;
}):{ready:boolean;reasons:string[];coverage:number} {
  const {policy}=input,reasons:string[]=[];
  if(policy.version!=='piano-midi-readiness-v1'||!validSpan(input.range)||policy.assessable.length===0||policy.assessable.length>500||input.observed.length>20000||
     !policy.assessable.every(validSpan)||!input.observed.every(validSpan)||!Number.isFinite(policy.minCoverage)||policy.minCoverage<=0||policy.minCoverage>1||
     !Number.isInteger(policy.minRequiredNotes)||policy.minRequiredNotes<1||!Number.isInteger(policy.maxPolyphony)||policy.maxPolyphony<1||policy.maxPolyphony>128||
     !policy.allowedSpeeds.length||!policy.allowedSpeeds.every(speed=>Number.isFinite(speed)&&speed>0)||
     !Number.isInteger(input.requiredNotes)||input.requiredNotes<0||!Number.isInteger(input.polyphony)||input.polyphony<0||!Number.isFinite(input.speed))
    return {ready:false,reasons:['Invalid assessment policy or evidence.'],coverage:0};
  if(!/^[a-f0-9]{64}$/.test(policy.referenceSha256)||!policy.revisionId||!policy.rubricVersion||
     policy.referenceSha256!==input.referenceSha256||policy.revisionId!==input.revisionId||policy.rubricVersion!==input.rubricVersion)
    reasons.push('Assessment evidence does not match the reviewed reference and rubric.');
  if(!policy.qualified)reasons.push('The scoring policy has not been qualified on physical devices.');
  if(input.latencyEvidence!=='device-qualified')reasons.push('Device-qualified timing evidence is required. Visual alignment is insufficient.');
  if(input.interrupted)reasons.push('Interrupted runs cannot be scored.');
  if(!policy.allowedSpeeds.includes(input.speed))reasons.push('This speed is outside the qualified exercise limits.');
  if(input.requiredNotes<policy.minRequiredNotes)reasons.push('Too few required notes were assessable.');
  if(input.polyphony>policy.maxPolyphony)reasons.push('This exercise exceeds the qualified polyphony.');
  const target=merge(policy.assessable.map(span=>({start:Math.max(span.start,input.range.start),end:Math.min(span.end,input.range.end)})).filter(span=>span.end>span.start));
  const observed=merge(input.observed);
  let covered=0;
  for(const span of target)for(const sample of observed)covered+=Math.max(0,Math.min(span.end,sample.end)-Math.max(span.start,sample.start));
  const total=seconds(target),coverage=total>0?Math.min(1,covered/total):0;
  if(!total||coverage<policy.minCoverage)reasons.push('Insufficient observed coverage of the reviewed assessment spans.');
  return {ready:reasons.length===0,reasons,coverage};
}
