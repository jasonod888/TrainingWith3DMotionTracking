import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Upload,Video,Rotate3D,X} from 'lucide-react';
import {ApiError,request,uploadChunk} from './api';
import {saveClip,loadClip,removeClip,pruneClips} from './clipCache';

export type ConversionJob={id:string;title:string;filename:string;bytes:number;start:number;duration:number;state:string;attempts:number;frames:number;error:string|null;provider:string;processor_online:boolean;retryable:boolean;lesson_id:string|null;parts:Record<string,{sha256:string;bytes:number}>;part_size:number};
type Limits={max_bytes:number;max_seconds:number;max_active:number;part_size:number;processing:{provider:string;available:boolean;external_processing:boolean}};
const labels:Record<string,string>={uploading:'Upload paused',queued:'Waiting to begin',validating:'Checking your video',processing:'Preparing your 3D move',exporting:'Creating your 3D move',verifying:'Checking the result',ready_for_review:'Ready to check',failed:'Needs attention',cancelled:'Cancelled'};

async function upload(file:File,job:ConversionJob,signal:AbortSignal,onProgress:(n:number)=>void){
 for(let offset=0,part=1;offset<file.size;offset+=job.part_size,part++){
  if(signal.aborted)throw new DOMException('Paused','AbortError');
  const chunk=file.slice(offset,Math.min(file.size,offset+job.part_size));
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await chunk.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(job.parts[String(part)]){if(job.parts[String(part)].sha256!==hash)throw new Error('Choose the original video to resume this upload.');onProgress(offset+chunk.size);continue;}
  await uploadChunk(job.id,part,chunk,signal,n=>onProgress(offset+n));
 }
 await request(`/conversions/${job.id}/complete`,'POST');
 await removeClip(job.id).catch(()=>{});
}

export function CreateLesson({onBack,onDone,adjust}:{onBack:()=>void;onDone:()=>void;adjust?:{lesson_id:string;title:string}}){
 const [limits,setLimits]=useState<Limits|null>(null),[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[duration,setDuration]=useState(0),[start,setStart]=useState(0),[end,setEnd]=useState(10),[title,setTitle]=useState(adjust?.title??''),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[percent,setPercent]=useState(0),[error,setError]=useState('');
 const active=useRef<AbortController|null>(null),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;void request<Limits>('/conversions/limits').then(setLimits).catch(e=>setError(e.message));return()=>{mounted.current=false;active.current?.abort();};},[]);
 useEffect(()=>{if(!file)return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
 const choose=(value:File|undefined)=>{if(!value)return;setError('');setFile(value);setDuration(0);setStart(0);setEnd(10);setTitle(adjust?.title??value.name.replace(/\.[^.]+$/,'').slice(0,200));};
 const submit=async()=>{if(!file||!limits)return;setBusy(true);setError('');const abort=new AbortController();active.current=abort;
  try{
   setPreparing(true);setPercent(0);
   const {prepareClip}=await import('./prepareClip');
   const clip=await prepareClip(file,start,end,limits.max_seconds,limits.max_bytes,abort.signal,n=>{if(mounted.current)setPercent(Math.round(n*100));});
   abort.signal.throwIfAborted();
   const job=await request<ConversionJob>('/conversions','POST',{title,filename:clip.file.name,bytes:clip.file.size,start:0,duration:clip.duration,processing_provider:limits.processing.provider,...(adjust?{lesson_id:adjust.lesson_id}:{})});
   try{await saveClip(job.id,clip.file);}catch{await request(`/conversions/${job.id}/cancel`,'POST');throw new Error('Could not save the prepared clip on this device. Free some device storage and try again.');}
   if(mounted.current){setPreparing(false);setPercent(0);}
   await upload(clip.file,job,abort.signal,n=>{if(mounted.current)setPercent(Math.round(n/clip.file.size*100));});if(mounted.current)onDone();
  }
  catch(e){if(mounted.current&&(e as Error).name!=='AbortError')setError((e as Error).message);}finally{if(mounted.current){setBusy(false);setPreparing(false);}}
 };
 return <section className="create-screen"><button className="back-link" onClick={()=>{active.current?.abort();onBack();}}><ArrowLeft size={17}/>My moves</button><div className="create-heading"><p className="eyebrow">{adjust?'REPLACE THE CLIP':'ADD A VIDEO'}</p><h1>{adjust?`A better clip for ${adjust.title}.`:'Turn a clip into a move.'}</h1><p className="subtle">{adjust?'Choose a new clip for this move. The current version stays until you accept the replacement.':limits?`Up to ${Math.round(limits.max_bytes/1024/1024)} MB · ${limits.max_seconds/60} minutes per move`:'Loading upload limits…'}</p></div>
 {limits&&!limits.processing.available&&<p className="inline-notice" role="status">Video processing is temporarily unavailable.</p>}{limits?.processing.external_processing&&<p className="small muted">Your video will be processed by {limits.processing.provider==='replicate'?'Replicate':'fal'} to create your movement reference.</p>}{!file?<label className="upload-drop"><Upload size={34} strokeWidth={1.3}/><h2>Choose your video</h2><span className="small muted">MP4, MOV or WebM</span><input aria-label="Choose video" type="file" accept="video/*" disabled={!limits||!limits.processing.available} onChange={e=>choose(e.target.files?.[0])}/></label>:<div className="create-layout"><div className="upload-preview"><video src={url} controls muted playsInline preload="metadata" onLoadedMetadata={e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)){setDuration(d);setEnd(Math.min(d,limits?.max_seconds??300));}}} onError={()=>setError('Preview unavailable. Try another video or export your selected clip as MP4 first.')}/></div><div className="create-options"><label>Name your move <span className="small muted">(optional)</span><input maxLength={200} placeholder={adjust?.title??'We will name it for you'} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label><details className="range-adjust"><summary>Adjust clip</summary><div className="range-values"><label>From<input aria-label="Start time in seconds" type="number" min={0} max={duration||1800} step={.1} value={start} disabled={busy} onChange={e=>setStart(Number(e.target.value))}/></label><label>To<input aria-label="End time in seconds" type="number" min={start+.2} max={duration||1800} step={.1} value={end} disabled={busy} onChange={e=>setEnd(Number(e.target.value))}/></label></div></details>{duration>0&&<><input aria-label="Video range start" type="range" min={0} max={Math.max(0,duration-.2)} step={.1} value={start} disabled={busy} onChange={e=>{const value=Number(e.target.value);setStart(value);setEnd(Math.min(duration,Math.max(value+.2,Math.min(end,value+(limits?.max_seconds??300)))));}}/><input aria-label="Video range end" type="range" min={start+.2} max={Math.min(duration,start+(limits?.max_seconds??300))} step={.1} value={end} disabled={busy} onChange={e=>setEnd(Number(e.target.value))}/></>}
 <span className="small muted">{Math.max(0,end-start).toFixed(1)} seconds selected. Only this portion will be uploaded; audio is removed.</span><button className="primary" disabled={busy||!limits?.processing.available||end-start<.2||end-start>(limits?.max_seconds??300)||start<0||!duration||end>duration} onClick={()=>void submit()}>{busy?`${preparing?'Preparing clip':'Uploading'} ${percent}%`:'Create 3D move'}{busy?<span className="loader"/>:<ArrowRight size={18}/>}</button>{busy&&<progress value={percent} max={100} aria-label={preparing?'Clip preparation progress':'Upload progress'}/>}<button className="back-link" disabled={busy} onClick={()=>setFile(null)}>Choose another video</button></div></div>}
 {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
 </section>;
}

export function ConversionList({onReady,onOpen,readyIds=[]}:{readyIds?:string[];onReady:()=>void;onOpen:(id:string)=>void}){
 const [jobs,setJobs]=useState<ConversionJob[]>([]),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[uploading,setUploading]=useState(''),[progress,setProgress]=useState(0);
 const known=useRef(new Set<string>()),active=useRef<AbortController|null>(null),alive=useRef(true),onReadyRef=useRef(onReady);
 useEffect(()=>{onReadyRef.current=onReady;},[onReady]);
 useEffect(()=>{void pruneClips().catch(()=>{});},[]);
 useEffect(()=>{
  alive.current=true;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const poll=async()=>{
   try{
    const value=await request<{jobs:ConversionJob[];worker_online:boolean}>('/conversions');
    if(stopped)return;
    setJobs(value.jobs);setPollError('');
    let refreshNeeded=false;
    for(const job of value.jobs)if(job.state==='ready_for_review'&&!known.current.has(job.id)){known.current.add(job.id);refreshNeeded=true;}
    if(refreshNeeded)onReadyRef.current();
   }catch(e){if(!stopped){const expired=e instanceof ApiError&&e.status===401;setPollError(expired?'Your session ended. Sign in again.':'Could not load your videos. Reconnecting…');if(expired)stopped=true;}}
   finally{if(!stopped)timer=setTimeout(()=>void poll(),5000);}
  };
  void poll();
  return()=>{stopped=true;alive.current=false;if(timer!==undefined)clearTimeout(timer);active.current?.abort();};
 },[]);
 const action=async(job:ConversionJob,action:string)=>{try{setError('');const next=await request<ConversionJob>(`/conversions/${job.id}/${action}`,'POST');if(action==='cancel')await removeClip(job.id).catch(()=>{});setJobs(previous=>previous.map(j=>j.id===job.id?next:j));}catch(e){setError((e as Error).message);}};
 const resume=async(job:ConversionJob,selected?:File)=>{const abort=new AbortController();active.current=abort;setUploading(job.id);setProgress(0);setError('');try{const latest=await request<ConversionJob>(`/conversions/${job.id}`);const file=selected??await loadClip(job.id);if(!file)throw new Error('The prepared clip is no longer on this device. Remove this upload and choose your video again.');if(file.size!==job.bytes||file.name!==job.filename)throw new Error('Choose the exact file used for this upload.');await upload(file,latest,abort.signal,n=>{if(alive.current)setProgress(Math.round(n/file.size*100));});}catch(e){if(alive.current&&(e as Error).name!=='AbortError')setError((e as Error).message);}finally{if(alive.current)setUploading('');}};
 const visible=jobs.filter(j=>j.state!=='cancelled'&&(j.state!=='ready_for_review'||!!j.lesson_id&&readyIds.includes(j.lesson_id)));
 if(!visible.length&&!error&&!pollError)return null;
 return <section className="conversion-list"><div className="library-filter"><h2>Your videos</h2></div>{visible.map(job=><article className="conversion-row" key={job.id}><span className="conversion-icon"><Rotate3D size={24}/></span><div className="conversion-info"><h3>{job.title}</h3><p className="small muted">{uploading===job.id?`Uploading ${progress}%`:job.state==='queued'&&!job.processor_online?(job.provider==='local'?'Waiting for the processing computer':'Waiting for the processor'):labels[job.state]??job.state}</p>{job.error&&<p className="small">{job.error==='invalid_video'?'This video or selected range could not be read. Choose another video.':job.retryable?'Processing did not finish. You can try again.':'Processing needs a support review before another attempt.'}</p>}</div><div className="conversion-actions">{job.state==='ready_for_review'&&job.lesson_id&&<button className="primary" onClick={()=>onOpen(job.lesson_id!)}>Check move</button>}{job.state==='uploading'&&<button className="secondary" disabled={!!uploading} onClick={()=>void resume(job)}>Resume</button>}{job.state==='uploading'&&<label className="secondary file-button">Choose file<input aria-label={`Resume ${job.title}`} type="file" accept="video/*" disabled={!!uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void resume(job,file);e.target.value='';}}/></label>}{job.retryable&&<button className="secondary" onClick={()=>void action(job,'retry')}>Retry</button>}{job.state!=='ready_for_review'&&<button className="round" aria-label={`Cancel ${job.title}`} onClick={()=>{active.current?.abort();void action(job,'cancel');}}><X size={18}/></button>}</div></article>)}{pollError&&<p className="inline-notice" role="status">{pollError}</p>}{error&&<p className="inline-notice error-notice" role="alert">{error}</p>}</section>;
}
