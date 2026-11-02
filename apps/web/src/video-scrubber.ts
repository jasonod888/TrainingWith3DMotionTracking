/** Keep a slow decoder productive: one seek in flight, one latest target waiting. */
type SeekVideo=Pick<HTMLVideoElement,'currentTime'|'seeking'|'paused'|'pause'|'addEventListener'|'removeEventListener'>;
type FrameClock={request:(callback:()=>void)=>number;cancel:(id:number)=>void};
export function createVideoScrubber(video:SeekVideo,clock:FrameClock={request:callback=>requestAnimationFrame(callback),cancel:cancelAnimationFrame}){
 let pending:number|null=null,inFlight=false,frame:number|null=null,disposed=false;
 const schedule=()=>{if(!disposed&&pending!==null&&frame===null&&!inFlight&&!video.seeking)frame=clock.request(pump);};
 function pump(){
  frame=null;if(disposed||inFlight||video.seeking||pending===null)return;
  const target=pending;pending=null;
  if(Math.abs(video.currentTime-target)<.0001)return;
  inFlight=true;
  // Exact seeks also work between keyframes. Serializing lets the decoder finish
  // instead of repeatedly aborting it on high-frequency pointer events.
  video.currentTime=target;
  // Browsers may complete a no-op/keyframe seek synchronously without a seeked event.
  if(!video.seeking){inFlight=false;schedule();}
 }
 const settled=()=>{inFlight=false;schedule();};
 video.addEventListener('seeked',settled);
 return {
  seek(time:number){
   if(disposed||!Number.isFinite(time))return;
   if(!video.paused)video.pause();
   pending=time;schedule();
  },
  busy:()=>inFlight||pending!==null,
  cancel(){pending=null;if(frame!==null)clock.cancel(frame);frame=null;},
  dispose(){disposed=true;pending=null;if(frame!==null)clock.cancel(frame);video.removeEventListener('seeked',settled);},
 };
}
