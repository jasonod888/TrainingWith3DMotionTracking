import {useEffect,useRef,useState} from 'react';
/** Bounded, in-memory learner take. No upload or automatic persistence. */
export const TAKE_MAX_SECONDS=120;
export const TAKE_MAX_BYTES=32*1024*1024;
export function usePracticeRecording(){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[recording,setRecording]=useState(false),[elapsed,setElapsed]=useState(0),[stopReason,setStopReason]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),timer=useRef(0),ticker=useRef(0),generation=useRef(0),objectUrl=useRef(''),blob=useRef<Blob|null>(null),mounted=useRef(true),startTime=useRef(0),speed=useRef(1),startedAt=useRef(0);
 const clean=()=>{clearTimeout(timer.current);clearInterval(ticker.current);};
 const remove=()=>{generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();setRecording(false);clean();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';blob.current=null;setUrl('');setElapsed(0);setStopReason('');};
 const stop=()=>{clean();if(recorder.current?.state==='recording')recorder.current.stop();};
 const begin=(stream:MediaStream|null,time:number,rate=1)=>{
  stop();remove();speed.current=rate;setError('');
  if(!stream||typeof MediaRecorder==='undefined'){setError('Recording needs an active camera and browser recording support.');return false;}
  const mime=['video/mp4;codecs=h264','video/webm;codecs=vp8','video/mp4','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));
  if(!mime){setError('No supported recording format on this device.');return false;}
  try{const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1500000});recorder.current=rec;const epoch=++generation.current,chunks:Blob[]=[];let bytes=0;startTime.current=time;
   rec.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>TAKE_MAX_BYTES&&rec.state==='recording'){setStopReason('File limit reached. Your take is ready to save.');rec.stop();}}};
   rec.onerror=()=>{if(epoch!==generation.current)return;if(mounted.current)setError('Recording stopped. Ordinary practice still works.');stop();};
   rec.onstop=()=>{if(!mounted.current||epoch!==generation.current)return;setRecording(false);clean();setElapsed(Math.min(TAKE_MAX_SECONDS,(Date.now()-startedAt.current)/1000));if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);if(!chunks.length){setError('No video was captured. Please try another take.');return;}blob.current=new Blob(chunks,{type:mime});objectUrl.current=URL.createObjectURL(blob.current);setUrl(objectUrl.current);};
   startedAt.current=Date.now();rec.start(500);setRecording(true);setElapsed(0);
   ticker.current=window.setInterval(()=>{if(mounted.current)setElapsed(Math.min(TAKE_MAX_SECONDS,(Date.now()-startedAt.current)/1000));},500);
   timer.current=window.setTimeout(()=>{setStopReason('Two-minute limit reached. Your take is ready to save.');stop();},TAKE_MAX_SECONDS*1000);
   return true;
  }catch{setError('Recording unavailable. You can still practise.');return false;}
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clean();if(recorder.current?.state==='recording')recorder.current.stop();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[]);
 return {url,error,recording,elapsed,stopReason,blob,startTime,speed,begin,stop,remove,maxSeconds:TAKE_MAX_SECONDS};
}
