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
export function assessStanding(image, world) {
  if(!image?.length || !world?.length)return {ok:false,message:'Step into view with your whole body visible.'};
  const core=[0,11,12,23,24,25,26,27,28,29,30,31,32];
  if(core.some(i=>(image[i].visibility??0)<.65 || (image[i].presence??1)<.65))return {ok:false,message:'Keep your head, knees and both feet clearly visible.'};
  if(core.some(i=>image[i].x<.025||image[i].x>.975||image[i].y<.025||image[i].y>.975))return {ok:false,message:'Step back so your entire body fits in the picture.'};
  const p=i=>[world[i].x,world[i].y,world[i].z];
  if(angle(p(23),p(25),p(27))<155||angle(p(24),p(26),p(28))<155||angle(p(11),p(23),p(25))<155||angle(p(12),p(24),p(26))<155)return {ok:false,message:'Stand upright with straight legs to match your height.'};
  const shoulders=(image[11].y+image[12].y)/2,hips=(image[23].y+image[24].y)/2;
  const shoulderX=(image[11].x+image[12].x)/2,hipX=(image[23].x+image[24].x)/2;
  if(hips<=shoulders||Math.abs(shoulderX-hipX)>(hips-shoulders)*.35)return {ok:false,message:'Face the camera and stand upright.'};
  const face=Math.min(...[0,1,2,3,4,5,6,7,8].map(i=>image[i].y));
  const crown=face-Math.max(0,shoulders-face)*.35;
  const floor=Math.max(...[27,28,29,30,31,32].map(i=>image[i].y));
  const height=floor-crown;
  if(crown<.015 || height<.32 || height>.94)return {ok:false,message:'Keep your full body in view and step a little closer if needed.'};
  return {ok:true,height,floor,center:(shoulderX+hipX)/2,message:'Hold still. Matching your standing height…'};
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
