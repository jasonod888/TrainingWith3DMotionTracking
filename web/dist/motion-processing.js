import {median} from './pose.js';
export const JOINTS={hips:null,ls:11,rs:12,le:13,re:14,lw:15,rw:16,lh:23,rh:24,lk:25,rk:26,la:27,ra:28,lf:31,rf:32,nose:0};
export const EDGES=[['hips','lh'],['hips','rh'],['lh','lk'],['lk','la'],['la','lf'],['rh','rk'],['rk','ra'],['ra','rf'],['hips','ls'],['ls','le'],['le','lw'],['hips','rs'],['rs','re'],['re','rw'],['ls','nose']];
export function extractFrame(world,image){
 if(!world||!image)return null;
 const origin=[(world[23].x+world[24].x)/2,(world[23].y+world[24].y)/2,(world[23].z+world[24].z)/2];
 const result={hips:{p:[0,0,0],confidence:Math.min(image[23].visibility??0,image[24].visibility??0)}};
 for(const [name,index] of Object.entries(JOINTS))if(index!==null){const w=world[index],v=image[index];result[name]={p:[w.x-origin[0],-(w.y-origin[1]),-(w.z-origin[2])],confidence:Math.min(v.visibility??0,v.presence??1)};}
 return result;
}
export function conditionFrames(frames,alpha=.65){
 const lengths={};
 for(const [a,b] of EDGES){const values=frames.filter(f=>f.joints&&f.joints[a].confidence>=.5&&f.joints[b].confidence>=.5).map(f=>Math.hypot(...f.joints[b].p.map((v,i)=>v-f.joints[a].p[i])));lengths[b]=values.length?median(values):null;}
 let previous=null;
 const processed=frames.map(frame=>{
  if(!frame.joints){previous=null;return {...frame,joints:null};}
  const joints=structuredClone(frame.joints);
  for(const name of Object.keys(joints))if(previous?.[name]?.confidence>=.5&&joints[name].confidence>=.5)joints[name].p=joints[name].p.map((v,i)=>alpha*v+(1-alpha)*previous[name].p[i]);
  previous=structuredClone(joints);
  for(const [a,b] of EDGES){if(joints[a].confidence<.5||joints[b].confidence<.5||!lengths[b])continue;const direction=joints[b].p.map((v,i)=>v-joints[a].p[i]);const length=Math.hypot(...direction);if(length>1e-6)joints[b].p=direction.map((v,i)=>joints[a].p[i]+v/length*lengths[b]);}
  return {...frame,joints};
 });
 return {frames:processed,lengths};
}
