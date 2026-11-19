/**
 * Whole-performance pose alignment.
 *
 * This is deliberately a fixed-offset comparison: every reference frame is
 * compared with the captured frame at the same time plus one global offset. It
 * never picks a different captured frame per limb or per reference frame, which
 * would reuse a favourable pose and inflate a run. The report keeps capture and
 * visibility coverage separate from similarity.
 *
 * The product report path is off by default until a browser/device benchmark and
 * the movement validation matrix have been reviewed.
 */
export const POSE_ALIGNMENT_REPORT_ENABLED = false;

export type PoseJointName = 'nose'|'ls'|'rs'|'le'|'re'|'lw'|'rw'|'lh'|'rh'|'lk'|'rk'|'la'|'ra'|'lf'|'rf';
export type PoseJoint = {p:[number,number,number]; confidence:number};
export type PoseFrame = {time:number; joints:Partial<Record<PoseJointName,PoseJoint>>};
export type PoseSpan = {start:number; end:number};
export type PoseSection = PoseSpan & {id:string; label:string};
export type PoseAlignmentOptions = {
  search?:{min:number; max:number};
  coarseStepSeconds?:number;
  refineStepSeconds?:number;
  maxCandidates?:number;
  frameToleranceSeconds?:number;
  minConfidence?:number;
  minCoverage?:number;
  minFrames?:number;
  ambiguityRatio?:number;
  ambiguitySeparationSeconds?:number;
};
export type PoseCandidate = {offsetSeconds:number; score:number; coverage:number; jointCoverage:number; matchedFrames:number};
export type PoseSectionReport = {
  id:string; label:string; start:number; end:number; score:number|null; coverage:number;
  matchedFrames:number; expectedFrames:number;
};
export type PoseAlignmentReport = {
  offsetSeconds:number|null;
  score:number|null;
  coverage:number;
  jointCoverage:number;
  captureCoverage:number;
  matchedFrames:number;
  referenceFrames:number;
  ambiguous:boolean;
  peakSeparationSeconds:number;
  candidates:PoseCandidate[];
  sections:PoseSectionReport[];
  reasons:string[];
};

const ANGLES:[PoseJointName,PoseJointName,PoseJointName][]=[
  ['ls','le','lw'],['rs','re','rw'],['le','ls','lh'],['re','rs','rh'],
  ['ls','lh','lk'],['rs','rh','rk'],['lh','lk','la'],['rh','rk','ra'],
];
const LINKS:[PoseJointName,PoseJointName][]=[
  ['ls','rs'],['ls','le'],['le','lw'],['rs','re'],['re','rw'],['ls','lh'],['rs','rh'],
  ['lh','rh'],['lh','lk'],['lk','la'],['rh','rk'],['rk','ra'],['la','lf'],['ra','rf'],
];
const DEFAULTS = {
  coarseStepSeconds:0.2,
  refineStepSeconds:0.05,
  maxCandidates:4000,
  frameToleranceSeconds:0.12,
  minConfidence:0.6,
  minCoverage:0.55,
  minFrames:10,
  // Poses change smoothly; only a near-tie between distinct offsets is ambiguous.
  ambiguityRatio:0.99,
  ambiguitySeparationSeconds:0.25,
};
const MAX_FRAMES = 20000;
const EPSILON = 1e-9;

function finite(value:unknown):value is number { return typeof value==='number'&&Number.isFinite(value); }
function sub(a:[number,number,number],b:[number,number,number]):[number,number,number] { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function length(vector:[number,number,number]):number { return Math.hypot(...vector); }
function dot(a:[number,number,number],b:[number,number,number]):number { return a.reduce((sum,value,index)=>sum+value*b[index],0); }
function angle(a:[number,number,number],b:[number,number,number],c:[number,number,number]):number {
  const left=sub(a,b),right=sub(c,b);
  const value=dot(left,right)/Math.max(length(left)*length(right),1e-9);
  return Math.acos(Math.max(-1,Math.min(1,value)))*180/Math.PI;
}
function direction(a:[number,number,number],b:[number,number,number]):[number,number,number] {
  const vector=sub(b,a),magnitude=length(vector);
  return magnitude>1e-9?[vector[0]/magnitude,vector[1]/magnitude,vector[2]/magnitude]:[0,0,0];
}
function joint(frame:PoseFrame,name:PoseJointName,minimum:number):PoseJoint|null {
  const value=frame.joints[name];
  if(!value||!finite(value.confidence)||value.confidence<minimum||!Array.isArray(value.p)||value.p.length!==3||value.p.some(point=>!finite(point)))return null;
  return value;
}
function validFrame(frame:PoseFrame):boolean {
  return Boolean(frame&&finite(frame.time)&&frame.joints&&typeof frame.joints==='object');
}

export function poseSimilarity(student:PoseFrame,target:PoseFrame,minConfidence=DEFAULTS.minConfidence):{score:number; joints:Record<string,number>; angleCount:number; linkCount:number}|null {
  if(!validFrame(student)||!validFrame(target))return null;
  let sum=0,weight=0;const joints:Record<string,number>={};
  for(const [a,b,c] of ANGLES){
    const left=joint(student,a,minConfidence),middle=joint(student,b,minConfidence),right=joint(student,c,minConfidence);
    const expectedLeft=joint(target,a,minConfidence),expectedMiddle=joint(target,b,minConfidence),expectedRight=joint(target,c,minConfidence);
    if(!left||!middle||!right||!expectedLeft||!expectedMiddle||!expectedRight)continue;
    const confidence=Math.min(left.confidence,middle.confidence,right.confidence);
    if(confidence<minConfidence)continue;
    const error=Math.abs(angle(left.p,middle.p,right.p)-angle(expectedLeft.p,expectedMiddle.p,expectedRight.p));
    const score=100*Math.exp(-0.5*(error/28)**2);
    joints[b]=score;sum+=score*confidence;weight+=confidence;
  }
  if(Object.keys(joints).length<6)return null;
  let directionSum=0,directionWeight=0;
  for(const [a,b] of LINKS){
    const left=joint(student,a,minConfidence),right=joint(student,b,minConfidence);
    const expectedLeft=joint(target,a,minConfidence),expectedRight=joint(target,b,minConfidence);
    if(!left||!right||!expectedLeft||!expectedRight)continue;
    const confidence=Math.min(left.confidence,right.confidence);
    const current=direction(left.p,right.p),expected=direction(expectedLeft.p,expectedRight.p);
    const degrees=Math.acos(Math.max(-1,Math.min(1,dot(current,expected))))*180/Math.PI;
    directionSum+=100*Math.exp(-0.5*(degrees/40)**2)*confidence;directionWeight+=confidence;
  }
  return {score:0.75*sum/weight+0.25*directionSum/Math.max(directionWeight,1e-9),joints,
    angleCount:Object.keys(joints).length,linkCount:directionWeight>0?LINKS.length:0};
}

function nearest(frames:PoseFrame[],time:number,tolerance:number):PoseFrame|null {
  if(!frames.length)return null;
  let low=0,high=frames.length-1;
  while(low<high){const middle=(low+high)>>1;if(frames[middle].time<time)low=middle+1;else high=middle;}
  let best: PoseFrame|null=null,bestDistance=Infinity;
  for(const index of [low-1,low]){
    const frame=frames[index];
    if(!frame)continue;
    const distance=Math.abs(frame.time-time);
    if(distance<=tolerance+EPSILON&&distance<bestDistance){best=frame;bestDistance=distance;}
  }
  return best;
}
function overlap(left:PoseSpan,right:PoseSpan):number {
  return Math.max(0,Math.min(left.end,right.end)-Math.max(left.start,right.start));
}

function evaluate(reference:PoseFrame[],captured:PoseFrame[],offset:number,options:Required<Omit<PoseAlignmentOptions,'search'>>,span?:PoseSpan):PoseCandidate {
  const frames=span?reference.filter(frame=>frame.time>=span.start-EPSILON&&frame.time<span.end-EPSILON):reference;
  let total=0,matched=0,jointTotal=0;
  const start=frames.length?frames[0].time:0,end=frames.length?frames[frames.length-1].time:0;
  for(const frame of frames){
    const candidate=nearest(captured,frame.time+offset,options.frameToleranceSeconds);
    if(!candidate)continue;
    const similarity=poseSimilarity(candidate,frame,options.minConfidence);
    if(!similarity)continue;
    total+=similarity.score;matched+=1;jointTotal+=similarity.angleCount/ANGLES.length;
  }
  const score=matched?total/matched:0;
  const coverage=frames.length?matched/frames.length:0;
  const jointCoverage=matched?jointTotal/matched:0;
  return {offsetSeconds:offset,score,coverage,jointCoverage,matchedFrames:matched};
}

export function poseBestFitAlign(input:{
  captured:PoseFrame[];
  reference:PoseFrame[];
  search?:{min:number; max:number};
  sections?:PoseSection[];
  options?:PoseAlignmentOptions;
}):PoseAlignmentReport {
  const options={...DEFAULTS,...input.options};
  if(!Array.isArray(input.captured)||!Array.isArray(input.reference)||input.captured.length>MAX_FRAMES||input.reference.length>MAX_FRAMES)throw new Error('Invalid pose alignment evidence.');
  if(!input.captured.every(validFrame)||!input.reference.every(validFrame))throw new Error('Invalid pose frame.');
  const captured=[...input.captured].sort((left,right)=>left.time-right.time);
  const reference=[...input.reference].sort((left,right)=>left.time-right.time);
  const search=input.search??(reference.length?{min:-Math.max(1,reference[reference.length-1].time-reference[0].time),max:Math.max(1,reference[reference.length-1].time-reference[0].time)}:{min:-1,max:1});
  if(!finite(search.min)||!finite(search.max)||search.min>search.max||Math.abs(search.max-search.min)>3600)throw new Error('Invalid pose offset search.');
  if(!Number.isFinite(options.coarseStepSeconds)||options.coarseStepSeconds<=0||!Number.isFinite(options.refineStepSeconds)||options.refineStepSeconds<=0||
    !Number.isInteger(options.maxCandidates)||options.maxCandidates<1||options.maxCandidates>20000)throw new Error('Invalid pose alignment search options.');
  if(!reference.length)return {offsetSeconds:null,score:null,coverage:0,jointCoverage:0,captureCoverage:0,matchedFrames:0,
    referenceFrames:0,ambiguous:false,peakSeparationSeconds:0,candidates:[],sections:[],reasons:['no-reference-pose-frames']};
  const span=search.max-search.min;
  const coarse=Math.max(options.coarseStepSeconds,span/Math.max(1,options.maxCandidates-1));
  const candidates:PoseCandidate[]=[];
  for(let offset=search.min;offset<=search.max+EPSILON;offset+=coarse){
    candidates.push(evaluate(reference,captured,Math.round(offset*1000)/1000,options));
  }
  candidates.sort((left,right)=>right.score-left.score||right.coverage-left.coverage||left.offsetSeconds-right.offsetSeconds);
  const refined:PoseCandidate[]=[];
  for(const candidate of candidates.slice(0,8)){
    for(let offset=candidate.offsetSeconds-0.2;offset<=candidate.offsetSeconds+0.2+EPSILON;offset+=options.refineStepSeconds){
      const bounded=Math.max(search.min,Math.min(search.max,Math.round(offset*1000)/1000));
      refined.push(evaluate(reference,captured,bounded,options));
    }
  }
  const all=[...candidates,...refined].sort((left,right)=>right.score-left.score||right.coverage-left.coverage||left.offsetSeconds-right.offsetSeconds);
  const unique:PoseCandidate[]=[];
  for(const candidate of all){
    if(unique.some(item=>Math.abs(item.offsetSeconds-candidate.offsetSeconds)<0.025))continue;
    unique.push(candidate);
  }
  const best=unique[0];
  const competitor=unique.find(candidate=>Math.abs(candidate.offsetSeconds-best.offsetSeconds)>=options.ambiguitySeparationSeconds);
  const ambiguous=Boolean(competitor&&best.score>0&&competitor.score>=best.score*options.ambiguityRatio);
  const referenceDuration=Math.max(EPSILON,reference[reference.length-1].time-reference[0].time);
  const captureCoverage=captured.length
    ? Math.max(0,Math.min(1,overlap({start:captured[0].time,end:captured[captured.length-1].time},
      {start:reference[0].time+best.offsetSeconds,end:reference[reference.length-1].time+best.offsetSeconds})/referenceDuration)) : 0;
  const reasons:string[]=[];
  if(best.matchedFrames<Math.min(options.minFrames,reference.length))reasons.push('insufficient-pose-frames');
  if(best.coverage<options.minCoverage)reasons.push('insufficient-pose-coverage');
  if(captureCoverage<options.minCoverage)reasons.push('insufficient-capture-coverage');
  if(ambiguous)reasons.push('ambiguous-pose-alignment');
  const score=reasons.length?null:Math.round(best.score*10)/10;
  const sections=(input.sections??[]).map(section=>{
    const sectionFrames=reference.filter(frame=>frame.time>=section.start-EPSILON&&frame.time<section.end-EPSILON);
    const result=evaluate(reference,captured,best.offsetSeconds,options,{start:section.start,end:section.end});
    return {id:section.id,label:section.label,start:section.start,end:section.end,
      score:sectionFrames.length&&result.matchedFrames>=Math.min(options.minFrames,sectionFrames.length)&&result.coverage>=options.minCoverage?Math.round(result.score*10)/10:null,
      coverage:result.coverage,matchedFrames:result.matchedFrames,expectedFrames:sectionFrames.length};
  });
  return {offsetSeconds:best.offsetSeconds,score,coverage:best.coverage,jointCoverage:best.jointCoverage,
    captureCoverage,matchedFrames:best.matchedFrames,referenceFrames:reference.length,ambiguous,
    peakSeparationSeconds:competitor?Math.abs(competitor.offsetSeconds-best.offsetSeconds):Math.max(0,span),
    candidates:unique.slice(0,8),sections,reasons};
}
