// Shared, camera-coordinate joints. MediaPipe world output and SAM keypoints
// both use x-right/y-down/z-forward; image landmarks are only used for display.
export const MP = { nose:0, ls:11, rs:12, le:13, re:14, lw:15, rw:16, lh:23, rh:24, lk:25, rk:26, la:27, ra:28, lf:31, rf:32 };
export const SAM = { nose:0, ls:5, rs:6, le:7, re:8, lw:62, rw:41, lh:9, rh:10, lk:11, rk:12, la:13, ra:14, lf:15, rf:18 };
export const NAMES = Object.keys(MP);
export const LINKS = [['ls','rs'],['ls','le'],['le','lw'],['rs','re'],['re','rw'],['ls','lh'],['rs','rh'],['lh','rh'],['lh','lk'],['lk','la'],['rh','rk'],['rk','ra'],['la','lf'],['ra','rf']];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const len=a=>Math.hypot(...a);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const median=a=>{const b=[...a].sort((a,b)=>a-b);return b.length%2?b[b.length>>1]:(b[b.length/2-1]+b[b.length/2])/2;};
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function angle(a,b,c) { const u=sub(a,b),v=sub(c,b); return Math.acos(clamp(dot(u,v)/Math.max(len(u)*len(v),1e-9),-1,1))*180/Math.PI; }
export function fromMediaPipe(world, image) {
  return Object.fromEntries(NAMES.map(k=>[k, { p:[world[MP[k]].x,world[MP[k]].y,world[MP[k]].z], confidence:Math.min(image[MP[k]].visibility??0, image[MP[k]].presence??1) }]));
}
export function fromReference(row, mirror=false) {
  return Object.fromEntries(NAMES.map(k=>{const other=mirror && (k.startsWith('l')||k.startsWith('r'))?(k[0]==='l'?'r':'l')+k.slice(1):k; const p=[...row[SAM[other]]]; if(mirror)p[0]*=-1; return [k,{p,confidence:1}];}));
}
const ANGLES=[['ls','le','lw'],['rs','re','rw'],['le','ls','lh'],['re','rs','rh'],['ls','lh','lk'],['rs','rh','rk'],['lh','lk','la'],['rh','rk','ra']];
export function comparePoses(student,target) {
  let sum=0, weight=0; const joints={};
  for(const [a,b,c] of ANGLES) {
    const confidence=Math.min(student[a].confidence,student[b].confidence,student[c].confidence);
    if(confidence<.6)continue;
    const error=Math.abs(angle(student[a].p,student[b].p,student[c].p)-angle(target[a].p,target[b].p,target[c].p));
    const score=100*Math.exp(-.5*(error/28)**2);
    joints[b]=score;sum+=score*confidence;weight+=confidence;
  }
  if(Object.keys(joints).length<6) return null;
  let directionSum=0,directionWeight=0;
  for(const [a,b] of LINKS) {
    const conf=Math.min(student[a].confidence,student[b].confidence);if(conf<.6)continue;
    const u=sub(student[b].p,student[a].p),v=sub(target[b].p,target[a].p);
    const degrees=Math.acos(clamp(dot(u,v)/Math.max(len(u)*len(v),1e-9),-1,1))*180/Math.PI;
    directionSum+=100*Math.exp(-.5*(degrees/40)**2)*conf;directionWeight+=conf;
  }
  return {score:.75*sum/weight+.25*directionSum/Math.max(directionWeight,1e-9), joints};
}
export function bestMatch(student,reference,time,mirror=false,playing=true) {
  let best=null;
  const start=Math.max(0,time-(playing?1:0)),end=Math.min(reference.duration,time+(playing?.15:0));
  // Match one whole reference pose at a time, rather than independently picking
  // a different time for each limb. Timing tolerance is in source seconds.
  for(let t=start;t<=end+.001;t+=playing?.1:1) {
    let lo=0,hi=reference.times.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(reference.times[mid]<t)lo=mid+1;else hi=mid;}
    const result=comparePoses(student,fromReference(reference.keypoints[lo],mirror));
    if(result && (!best || result.score>best.score))best={...result,time:reference.times[lo]};
  }
  return best;
}
// Standing assessment. Returns a structured result so callers never have to
// parse messages:
//   {ok:true,  reason:'eligible', detail, message, height, floor, center, scale, edge:null}
//   {ok:false, reason, detail, message, scale, edge}
// The successful fields are unchanged from the original contract; the failure
// cases are the same rules in the same order. Malformed input (short arrays,
// missing points, non-finite coordinates or confidence) is rejected instead of
// throwing or silently becoming eligible.
export const STANDING_VISIBILITY=.65;
export const STANDING_EDGE_MARGIN=.025;
const STANDING_CORE=[0,11,12,23,24,25,26,27,28,29,30,31,32];
const STANDING_FACE=[0,1,2,3,4,5,6,7,8];
const STANDING_REQUIRED_VERTICES=[11,12,23,24,25,26,27,28];
const standingFailure=(reason,detail,message,extra={})=>({ok:false,reason,detail,message,scale:null,edge:null,...extra});
const standingEdge=(edge=null)=>({top:false,bottom:false,left:false,right:false,...edge??{}});
const standingEdgeFired=edge=>edge.top||edge.bottom||edge.left||edge.right;
const hasFiniteXY=point=>!!point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
const hasFiniteXYZ=point=>hasFiniteXY(point)&&Number.isFinite(point.z);
function standingVisible(point) {
  if(!hasFiniteXYZ(point))return false;
  const visibility=point.visibility??0,presence=point.presence??1;
  return Number.isFinite(visibility)&&Number.isFinite(presence)&&visibility>=STANDING_VISIBILITY&&presence>=STANDING_VISIBILITY;
}
export function assessStanding(image, world) {
  if(!Array.isArray(image)||!Array.isArray(world)||!image.length||!world.length)
    return standingFailure('no_person','no_landmarks','Step into view with your whole body visible.');
  if(image.length<33||world.length<33||
     !STANDING_CORE.concat(STANDING_FACE).every(index=>hasFiniteXY(image[index]))||
     !STANDING_REQUIRED_VERTICES.every(index=>hasFiniteXYZ(world[index])))
    return standingFailure('invalid','malformed_landmarks','Waiting for a clear frame…');
  if(STANDING_CORE.some(index=>!standingVisible(image[index])))
    return standingFailure('occluded','core_visibility','Keep your head, knees and both feet clearly visible.');
  const edge=standingEdge();
  for(const index of STANDING_CORE) {
    const point=image[index];
    if(point.x<STANDING_EDGE_MARGIN)edge.left=true;
    if(point.x>1-STANDING_EDGE_MARGIN)edge.right=true;
    if(point.y<STANDING_EDGE_MARGIN)edge.top=true;
    if(point.y>1-STANDING_EDGE_MARGIN)edge.bottom=true;
  }
  if(standingEdgeFired(edge))
    return standingFailure('out_of_frame','source_edge','Step back so your entire body fits in the picture.',{edge});
  const p=i=>[world[i].x,world[i].y,world[i].z];
  if(angle(p(23),p(25),p(27))<155||angle(p(24),p(26),p(28))<155||angle(p(11),p(23),p(25))<155||angle(p(12),p(24),p(26))<155)
    return standingFailure('not_standing','posture_knees','Stand upright with straight legs to match your height.');
  const shoulders=(image[11].y+image[12].y)/2,hips=(image[23].y+image[24].y)/2;
  const shoulderX=(image[11].x+image[12].x)/2,hipX=(image[23].x+image[24].x)/2;
  if(hips<=shoulders||Math.abs(shoulderX-hipX)>(hips-shoulders)*.35)
    return standingFailure('not_standing','facing','Face the camera and stand upright.');
  const face=Math.min(...STANDING_FACE.map(index=>image[index].y));
  const crown=face-Math.max(0,shoulders-face)*.35;
  const floor=Math.max(...[27,28,29,30,31,32].map(index=>image[index].y));
  const height=floor-crown;
  // The crown estimate can go negative while the face is still inside the
  // margin. That means the head is at the top of the picture, so the person
  // must step back or raise the camera — never step closer.
  if(crown<.015)
    return standingFailure('out_of_frame','crown_clipped','Step back so your head and both feet are visible.',{scale:height,edge:{top:true,bottom:false,left:false,right:false}});
  if(height<.32)
    return standingFailure('too_small','scale_small','Keep your full body in view and step a little closer if needed.',{scale:height});
  if(height>.94)
    return standingFailure('too_large','scale_large','Step back so your head and both feet are visible.',{scale:height});
  return {ok:true,reason:'eligible',detail:'eligible',message:'Hold still. Matching your standing height…',height,floor,center:(shoulderX+hipX)/2,scale:height,edge:null};
}
export class HeightCalibration {
  constructor(){this.reset();}
  reset(){this.samples=[];this.locked=null;}
  sample(image,world,now) {
    if(this.locked)return {done:true,progress:1,value:this.locked,message:'Height matched and locked.'};
    if(this.samples.length && now-this.samples.at(-1).now>600)this.samples=[];
    const result=assessStanding(image,world);
    if(!result.ok){this.samples=[];return {...result,progress:0};}
    this.samples.push({...result,now});
    this.samples=this.samples.filter(s=>now-s.now<=3000);
    const heights=this.samples.map(s=>s.height),floors=this.samples.map(s=>s.floor),centers=this.samples.map(s=>s.center);
    const h=median(heights);
    const stable=Math.max(...heights)-Math.min(...heights)<h*.04 && Math.max(...floors)-Math.min(...floors)<.025 && Math.max(...centers)-Math.min(...centers)<.035;
    if(!stable){this.samples=[{...result,now}];return {progress:0,message:'Hold still for a moment. Keep the camera steady.'};}
    const elapsed=now-this.samples[0].now,progress=Math.min(1,elapsed/2500,this.samples.length/30);
    if(progress>=1){this.locked={height:h,floor:median(floors),center:median(centers)};return {done:true,progress:1,value:this.locked,message:'Height matched and locked.'};}
    return {progress,message:result.message};
  }
}
export function videoFit(videoWidth,videoHeight,width,height) {const scale=Math.min(width/videoWidth,height/videoHeight);return {width:videoWidth*scale,height:videoHeight*scale,x:(width-videoWidth*scale)/2,y:(height-videoHeight*scale)/2};}
export function heightPlacement(calibration,videoWidth,videoHeight,width,height,frustumHeight,avatarHeight) {
  const fit=videoFit(videoWidth,videoHeight,width,height);
  return {scale:calibration.height*fit.height/height*frustumHeight/avatarHeight,
    floorY:(.5-(fit.y+calibration.floor*fit.height)/height)*frustumHeight,
    screenHeight:calibration.height*fit.height};
}
