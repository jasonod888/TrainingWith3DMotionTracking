export type MarkerPoint=[number,number];
export type MarkerTrack={schema:1;video_sha256:string;order:string[];times:number[];frames:(MarkerPoint|null)[][]};
export const MARKER_NAMES=['left_hand','right_hand','left_foot','right_foot'] as const;
export function markerTrack(value:unknown,hash:string):MarkerTrack|null{
 const data=value as MarkerTrack|undefined;
 if(!data||data.schema!==1||data.video_sha256!==hash||!Array.isArray(data.times)||!Array.isArray(data.frames)||!data.times.length||data.times.length>12000||data.times.length!==data.frames.length)return null;
 if(!Array.isArray(data.order)||data.order.length!==4||MARKER_NAMES.some((name,index)=>data.order[index]!==name))return null;
 for(let i=0;i<data.times.length;i++){
  if(!Number.isFinite(data.times[i])||(i>0&&data.times[i]<=data.times[i-1])||!Array.isArray(data.frames[i])||data.frames[i].length!==4)return null;
  for(const point of data.frames[i])if(point!==null&&(!Array.isArray(point)||point.length!==2||point.some(v=>!Number.isFinite(v)||v<0||v>1)))return null;
 }
 return data;
}
export function markerPixel(point:MarkerPoint,box:{x:number;y:number;width:number;height:number;left:number;right:number;top:number;bottom:number},sourceWidth:number,sourceHeight:number,mirrored:boolean):MarkerPoint{
 const innerWidth=box.width-box.left-box.right,innerHeight=box.height-box.top-box.bottom;
 const scale=Math.min(innerWidth/sourceWidth,innerHeight/sourceHeight),w=sourceWidth*scale,h=sourceHeight*scale;
 const raw=box.left+(innerWidth-w)/2+point[0]*w;
 return [box.x+(mirrored?box.width-raw:raw),box.y+box.top+(innerHeight-h)/2+point[1]*h];
}
export function sampleMarkers(track:MarkerTrack,time:number):(MarkerPoint|null)[]{
 const {times,frames}=track;
 if(time<times[0]||time>times.at(-1)!+.1)return [null,null,null,null];
 let low=0,high=times.length-1;
 while(low<high){const mid=Math.ceil((low+high)/2);if(times[mid]<=time)low=mid;else high=mid-1;}
 const next=Math.min(low+1,times.length-1),span=times[next]-times[low],amount=span>0?Math.min(1,(time-times[low])/span):0;
 return frames[low].map((point,index)=>{
  const other=frames[next][index];
  if(!point||!other)return null;
  if(Math.hypot(point[0]-other[0],point[1]-other[1])>.3)return null;
  return [point[0]+(other[0]-point[0])*amount,point[1]+(other[1]-point[1])*amount];
 });
}
export function markerBadges(anchors:(MarkerPoint|null)[],width:number,height:number,radius=10){
 const clamp=(n:number,max:number)=>Math.max(radius+2,Math.min(max-radius-2,n));
 const badges=anchors.map((p,i)=>p?[clamp(p[0]+(p[0]<width/2?-1:1)*(radius+6),width),clamp(p[1]+(i<2?-1:1)*(radius+7),height)] as MarkerPoint:null);
 for(let pass=0;pass<6;pass++)for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){
  const p=badges[a],q=badges[b];if(!p||!q)continue;
  const dx=q[0]-p[0],dy=q[1]-p[1],distance=Math.hypot(dx,dy),target=radius*2+4;
  if(distance>=target)continue;
  const vx=distance>.01?dx/distance:1,vy=distance>.01?dy/distance:0,push=(target-distance)/2;
  p[0]=clamp(p[0]-vx*push,width);p[1]=clamp(p[1]-vy*push,height);
  q[0]=clamp(q[0]+vx*push,width);q[1]=clamp(q[1]+vy*push,height);
 }
 return badges;
}
