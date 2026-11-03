import type {Section} from '../../../packages/lesson-schema/index';
import {clampTime} from './timeline';

export const practiceTimeLabel=(time:number)=>`${Math.floor(Math.max(0,time)/60)}:${Math.floor(Math.max(0,time)%60).toString().padStart(2,'0')}`;

export function timelineTimeAt(clientX:number,left:number,width:number,duration:number){
 return width>0?clampTime((clientX-left)/width*duration,0,duration):0;
}

export function timelineSectionAt(sections:readonly Pick<Section,'start'|'end'>[],time:number){
 if(!sections.length)return -1;
 const index=sections.findIndex(section=>time<section.end);
 return index<0?sections.length-1:index;
}

export function timelineKeyTime(key:string,time:number,min:number,max:number,fine=false){
 const step=fine ? .1 : 1;
 if(key==='Home')return min;
 if(key==='End')return max;
 const delta=key==='ArrowRight'||key==='ArrowUp'?step:key==='ArrowLeft'||key==='ArrowDown'?-step:key==='PageUp'?10:key==='PageDown'?-10:null;
 return delta===null?null:clampTime(time+delta,min,max);
}
