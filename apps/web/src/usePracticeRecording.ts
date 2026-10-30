import {useEffect,useRef,useState} from 'react';
/** Optional, bounded, in-memory recording. No upload or automatic persistence. */
export function usePracticeRecording(){
 const [armed,setArmed]=useState(false),[url,setUrl]=useState(''),[error,setError]=useState(''),[recording,setRecording]=useState(false);
 const recorder=useRef<MediaRecorder|null>(null),timer=useRef(0),generation=useRef(0),objectUrl=useRef(''),mounted=useRef(true),startTime=useRef(0),speed=useRef(1);
 const remove=()=>{generation.current++;if(recorder.current?.state==='recording')recorder.current.stop();setRecording(false);if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';setUrl('');};
 const stop=()=>{clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();};
 const begin=(stream:MediaStream|null,time:number,rate=1)=>{
  if(!armed)return;
  stop();remove();speed.current=rate;setError('');if(!stream||typeof MediaRecorder==='undefined'){setError('Recording needs an active camera and browser recording support.');return;}
  const mime=['video/webm;codecs=vp8','video/mp4','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));
  if(!mime){setError('No supported recording format on this device.');return;}
  try{const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:1500000});recorder.current=rec;const epoch=++generation.current,chunks:Blob[]=[];let bytes=0;startTime.current=time;
   rec.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>32*1024*1024&&rec.state==='recording')rec.stop();}};
   rec.onerror=()=>{if(epoch!==generation.current)return;if(mounted.current)setError('Recording stopped. Ordinary practice still works.');stop();};
   rec.onstop=()=>{if(!mounted.current||epoch!==generation.current)return;setRecording(false);if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=URL.createObjectURL(new Blob(chunks,{type:mime}));setUrl(objectUrl.current);};
   rec.start(500);setRecording(true);timer.current=window.setTimeout(stop,120000);
  }catch{setError('Recording unavailable. You can still practise.');}
 };
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[]);
 return {armed,setArmed,url,error,recording,begin,stop,remove,startTime,speed};
}
