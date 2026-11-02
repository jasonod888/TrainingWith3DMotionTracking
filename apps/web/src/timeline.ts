export const clampTime=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,Number.isFinite(value)?value:min));
export const timeLabel=(time:number)=>`${Math.floor(Math.max(0,time)/60)}:${(Math.max(0,time)%60).toFixed(2).padStart(5,'0')}`;
export function trimBounds(duration:number,start:number,end:number,maxLength:number,edge:'start'|'end'){
 const gap=Math.min(.2,duration);
 return edge==='start'?{min:Math.max(0,end-maxLength),max:Math.max(0,end-gap)}:{min:Math.min(duration,start+gap),max:Math.min(duration,start+maxLength)};
}
