import {matchesClipIdentity} from './clip-identity';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Upload,Video,X} from 'lucide-react';
import {ApiError,request,uploadChunk} from './api';
import {createVideoScrubber} from './video-scrubber';
import {VideoTimeline} from './VideoTimeline';
import {clampTime,trimBounds} from './timeline';
import {saveClip,loadClip,loadClipMeta,removeClip,pruneClips,savePoster,loadPoster} from './clipCache';

export type ConversionJob={id:string;title:string;filename:string;bytes:number;start:number;duration:number;state:string;attempts:number;frames:number;error:string|null;provider:string;processor_online:boolean;retryable:boolean;lesson_id:string|null;parts:Record<string,{sha256:string;bytes:number}>;part_size:number;subject?:string;instrument?:string|null;preparation?:Record<string,unknown>;media_findings?:Record<string,unknown>};
export type LessonSubjectOption={id:string;label:string;experience_family:'body'|'music';instrument:'piano'|'guitar'|null;movement:boolean};
type Limits={max_bytes:number;max_seconds:number;max_active:number;part_size:number;processing:{provider:string;available:boolean;external_processing:boolean};subjects?:LessonSubjectOption[];routes?:Record<string,{available:boolean}>;capabilities?:{conversion?:boolean;music_piano?:boolean;music_guitar?:boolean}};
const labels:Record<string,string>={uploading:'Upload paused',queued:'Waiting to begin',validating:'Checking your video',processing:'Preparing your 3D move',exporting:'Creating your 3D move',verifying:'Checking the result',ready_for_review:'Ready to check',failed:'Needs attention',cancelled:'Cancelled'};
const musicLabels:Record<string,string>={processing:'Transcribing music',exporting:'Preparing music reference',ready_for_review:'Ready to review'};
const conversionLabel=(job:ConversionJob)=>(job.instrument?musicLabels[job.state]:undefined)??labels[job.state]??job.state;

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

export function CreateLesson({onBack,onDone,adjust}:{onBack:()=>void;onDone:()=>void;adjust?:{lesson_id:string;title:string;subject?:string}}){
 const [limits,setLimits]=useState<Limits|null>(null),[subject,setSubject]=useState(adjust?.subject??'movement_other'),[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[duration,setDuration]=useState(0),[start,setStart]=useState(0),[end,setEnd]=useState(10),[title,setTitle]=useState(adjust?.title??''),[busy,setBusy]=useState(false),[preparing,setPreparing]=useState(false),[percent,setPercent]=useState(0),[error,setError]=useState('');
 const [offerImport,setOfferImport]=useState(false),[importPrepared,setImportPrepared]=useState(false);
 const active=useRef<AbortController|null>(null),mounted=useRef(true),video=useRef<HTMLVideoElement|null>(null);
 const scrubber=useRef<ReturnType<typeof createVideoScrubber>|null>(null);
 useEffect(()=>{const element=video.current;if(!element)return;const controller=createVideoScrubber(element);scrubber.current=controller;return()=>{controller.dispose();if(scrubber.current===controller)scrubber.current=null;};},[url]);
 const [previewTime,setPreviewTime]=useState(0),[previewing,setPreviewing]=useState(false);
 const seek=(time:number)=>{if(!video.current)return;scrubber.current?.seek(time);setPreviewTime(time);setPreviewing(false);};
 const updateRange=(from:number,to:number)=>{setStart(from);setEnd(to);};
 const editEdge=(edge:'start'|'end',value:number)=>{const bounds=trimBounds(duration,start,end,limits?.max_seconds??300,edge);const next=clampTime(value,bounds.min,bounds.max);updateRange(edge==='start'?next:start,edge==='end'?next:end);seek(next);};
 const preview=()=>{const element=video.current;if(!element)return;if(previewing){element.pause();return;}scrubber.current?.cancel();element.currentTime=start;void element.play().catch(()=>setError('Preview could not play. Try the video controls.'));};
 useEffect(()=>{if(busy)video.current?.pause();},[busy]);
 useEffect(()=>{mounted.current=true;void request<Limits>('/conversions/limits').then(setLimits).catch(e=>setError(e.message));return()=>{mounted.current=false;active.current?.abort();};},[]);
 useEffect(()=>{if(!file)return;const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
 const choose=(value:File|undefined)=>{if(!value)return;setError('');setImportPrepared(false);setFile(value);setDuration(0);setStart(0);setEnd(10);setTitle(adjust?.title??value.name.replace(/\.[^.]+$/,'').slice(0,200));};
 const trimInputBounds=(edge:'start'|'end')=>trimBounds(duration,start,end,limits?.max_seconds??300,edge);

 const selectedSubject=(limits?.subjects??[]).find(item=>item.id===subject);
 const music=(selectedSubject?.experience_family??'body')==='music';
 const musicAvailable=(id:string)=>id==='piano'?Boolean(limits?.capabilities?.music_piano):id==='guitar'?Boolean(limits?.capabilities?.music_guitar):true;
 const processingAvailable=music?Boolean(selectedSubject&&musicAvailable(selectedSubject.id)):Boolean(limits?.processing.available);
 const musicBlocked=Boolean(music&&selectedSubject&&!musicAvailable(selectedSubject.id));
 const preparationMetadata={preparation_version:importPrepared?'music-import-v1':'music-clip-v1',selection_start:start,selection_end:end};
 const submit=async()=>{if(!file||!limits||!processingAvailable)return;setBusy(true);setError('');const abort=new AbortController();active.current=abort;
  try{
   setPreparing(true);setPercent(0);
   const clip=music
     ? await (await import('./prepareAudioClip')).prepareAudioClip(file,start,end,limits.max_seconds,limits.max_bytes,abort.signal,n=>{if(mounted.current)setPercent(Math.round(n*100));},{importPrepared})
     : await (await import('./prepareClip')).prepareClip(file,start,end,limits.max_seconds,limits.max_bytes,abort.signal,n=>{if(mounted.current)setPercent(Math.round(n*100));});
   abort.signal.throwIfAborted();
   const job=await request<ConversionJob>('/conversions','POST',{title,filename:clip.file.name,bytes:clip.file.size,start:0,duration:clip.duration,...(!music?{processing_provider:limits.processing.provider}:{}),subject:selectedSubject?.id??'movement_other',...(music?{instrument:selectedSubject?.instrument,preparation:preparationMetadata}:{}),...(adjust?{lesson_id:adjust.lesson_id}:{})});
   try{await saveClip(job.id,clip.file,{subject:selectedSubject?.id??'movement_other',instrument:music?(selectedSubject?.instrument??null):null,preparationVersion:music?preparationMetadata.preparation_version:null});}catch{await request(`/conversions/${job.id}/cancel`,'POST');throw new Error('Could not save the prepared clip on this device. Free some device storage and try again.');}
   try{const element=video.current;if(element&&element.readyState>=2){const canvas=document.createElement('canvas');canvas.width=480;canvas.height=Math.round(480*element.videoHeight/element.videoWidth);canvas.getContext('2d')?.drawImage(element,0,0,canvas.width,canvas.height);await savePoster(job.id,canvas.toDataURL('image/jpeg',.75));}}catch{/* A missing thumbnail must not interrupt the upload. */}
   if(mounted.current){setPreparing(false);setPercent(0);}
   await upload(clip.file,job,abort.signal,n=>{if(mounted.current)setPercent(Math.round(n/clip.file.size*100));});if(mounted.current)onDone();
  }
  catch(e){if(mounted.current&&(e as Error).name!=='AbortError'){setError((e as Error).message);if((e as {recoverable?:boolean}).recoverable)setOfferImport(true);}}finally{if(mounted.current){setBusy(false);setPreparing(false);}}
 };
 return <section className="create-screen"><button className="back-link" onClick={()=>{active.current?.abort();onBack();}}><ArrowLeft size={17}/>My moves</button><div className="create-heading"><p className="eyebrow">{adjust?'REPLACE THE CLIP':'ADD A VIDEO'}</p><h1>{adjust?`A better clip for ${adjust.title}.`:'Turn a clip into a move.'}</h1><p className="subtle">{adjust?'Choose a new clip for this move. The current version stays until you accept the replacement.':limits?`Up to ${Math.round(limits.max_bytes/1024/1024)} MB · ${limits.max_seconds/60} minutes per move`:'Loading upload limits…'}</p></div>
 {limits&&!processingAvailable&&<p className="inline-notice" role="status">Video processing is temporarily unavailable.</p>}{!music&&limits?.processing.external_processing&&<p className="small muted">Your video will be processed by {limits.processing.provider==='replicate'?'Replicate':'fal'} to create your movement reference.</p>}{!adjust&&limits?.subjects&&<div className="subject-choice" role="group" aria-label="Lesson subject"><label>What are you teaching?<select aria-label="Lesson subject" value={subject} disabled={busy} onChange={e=>setSubject(e.target.value)}>{limits.subjects.map(item=><option key={item.id} value={item.id} disabled={!item.movement&&!musicAvailable(item.id)}>{item.label}{!item.movement&&!musicAvailable(item.id)?' (not available yet)':''}</option>)}</select></label>{musicBlocked&&<p className="small muted">Music uploads are not available yet. Choose a movement subject to continue.</p>}</div>}
 {!file?<label className="upload-drop"><Upload size={34} strokeWidth={1.3}/><h2>Choose your video</h2><span className="small muted">MP4, MOV or WebM</span><input aria-label="Choose video" type="file" accept="video/*" disabled={!limits||!processingAvailable} onChange={e=>choose(e.target.files?.[0])}/></label>:<div className="create-layout"><div className="clip-editor"><div className="upload-preview"><video ref={video} key={url} src={url} controls muted playsInline preload="auto" onPlay={e=>{if(busy){e.currentTarget.pause();return;}scrubber.current?.cancel();if(e.currentTarget.currentTime<start||e.currentTarget.currentTime>=end)e.currentTarget.currentTime=start;setPreviewing(true);}} onPause={()=>setPreviewing(false)} onTimeUpdate={e=>{const element=e.currentTarget;if(!element.paused&&element.currentTime>=end){element.pause();element.currentTime=end;}if(!scrubber.current?.busy())setPreviewTime(element.currentTime);}} onLoadedMetadata={e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)&&d>0){setDuration(d);setStart(0);setPreviewTime(0);setEnd(Math.min(d,limits?.max_seconds??300));}}} onError={()=>setError('Preview unavailable. Try another video or export your selected clip as MP4 first.')}/></div>{duration>0&&<><VideoTimeline source={url} duration={duration} time={previewTime} onSeek={seek} disabled={busy} range={{start,end,maxLength:limits?.max_seconds??300,onChange:updateRange}}/><div className="clip-preview-actions"><button className="secondary" disabled={busy} onClick={preview}>{previewing?'Pause preview':'Preview selection'}</button><span>Up to {limits?.max_seconds??300} seconds</span></div><div className="clip-time-fields"><label>Start (seconds)<input aria-label="Start time in seconds" type="number" step={.01} {...trimInputBounds('start')} value={Number(start.toFixed(2))} disabled={busy} onChange={e=>editEdge('start',Number(e.target.value))}/></label><label>End (seconds)<input aria-label="End time in seconds" type="number" step={.01} {...trimInputBounds('end')} value={Number(end.toFixed(2))} disabled={busy} onChange={e=>editEdge('end',Number(e.target.value))}/></label></div></>}</div><div className="create-options"><label>Name your move <span className="small muted">(optional)</span><input maxLength={200} placeholder={adjust?.title??'We will name it for you'} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
 {music&&offerImport&&<label className="check-line music-import-choice"><input type="checkbox" checked={importPrepared} disabled={busy} onChange={e=>{setError('');setImportPrepared(e.target.checked);if(e.target.checked){setStart(0);setEnd(duration);seek(0);}}}/>This file is already my exported clip (use the whole file)</label>}
 <span className="small muted">{Math.max(0,end-start).toFixed(1)} seconds selected. {music?'Only this portion will be uploaded; its audio is kept.':'Only this portion will be uploaded; audio is removed.'}</span><button className="primary" disabled={busy||!processingAvailable||musicBlocked||end-start<.2||end-start>(limits?.max_seconds??300)||start<0||!duration||end>duration} onClick={()=>void submit()}>{busy?`${preparing?'Preparing clip':'Uploading'} ${percent}%`:(music?'Create music lesson':'Create 3D move')}{busy?<span className="loader"/>:<ArrowRight size={18}/>}</button>{busy&&<progress value={percent} max={100} aria-label={preparing?'Clip preparation progress':'Upload progress'}/>}<button className="back-link" disabled={busy} onClick={()=>setFile(null)}>Choose another video</button></div></div>}
 {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
 </section>;
}

function ConversionPoster({id,status,pending,state}:{id:string;status:string;pending:boolean;state:string}){
 const [poster,setPoster]=useState<string>();
 useEffect(()=>{let stopped=false;void loadPoster(id).then(value=>{if(!stopped)setPoster(value);}).catch(()=>{});return()=>{stopped=true;};},[id]);
 return <div className="feed-thumbnail conversion-thumbnail" aria-disabled="true">
  {poster?<img src={poster} alt="" onError={()=>setPoster(undefined)}/>:<span className="feed-poster"><Video size={48} strokeWidth={1}/></span>}
  <div className="conversion-overlay"><span className="conversion-status">{pending&&<span className="loader" aria-hidden="true"/>}{status}</span><span>{pending?'You can leave this page. We’ll keep working.':state==='failed'?'Processing stopped. See the details below.':state==='uploading'?'Finish uploading to start processing.':'Your 3D move is ready to check.'}</span></div>
 </div>;
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
 const resume=async(job:ConversionJob,selected?:File)=>{const abort=new AbortController();active.current=abort;setUploading(job.id);setProgress(0);setError('');try{const latest=await request<ConversionJob>(`/conversions/${job.id}`);const file=selected??await loadClip(job.id);if(!file)throw new Error('The prepared clip is no longer on this device. Remove this upload and choose your video again.');if(file.size!==job.bytes||file.name!==job.filename)throw new Error('Choose the exact file used for this upload.');
   const meta=await loadClipMeta(job.id);if(!matchesClipIdentity(meta,latest))throw new Error('This upload belongs to a different lesson type. Remove it and prepare the clip again.');await upload(file,latest,abort.signal,n=>{if(alive.current)setProgress(Math.round(n/file.size*100));});}catch(e){if(alive.current&&(e as Error).name!=='AbortError')setError((e as Error).message);}finally{if(alive.current)setUploading('');}};
 const visible=jobs.filter(j=>j.state!=='cancelled'&&(j.state!=='ready_for_review'||!!j.lesson_id&&readyIds.includes(j.lesson_id)));
 if(!visible.length&&!error&&!pollError)return null;
 return <section className="conversion-list" aria-label="Your uploads and processing"><div className="conversion-heading"><h2>Your uploads and processing</h2><p>Follow your video as it becomes a practice.</p></div><div className="feed-grid">{visible.map(job=><article className="feed-card conversion-card" key={job.id}><ConversionPoster id={job.id} state={job.state} pending={['queued','validating','processing','exporting','verifying'].includes(job.state)} status={uploading===job.id?`Uploading ${progress}%`:job.state==='queued'&&!job.processor_online?'Waiting for the processor':conversionLabel(job)}/><div className="conversion-row"><div className="conversion-info"><h3>{job.title}</h3><p className="small muted" role="status">{uploading===job.id?`Uploading ${progress}%`:job.state==='queued'&&!job.processor_online?(job.provider==='local'?'Waiting for the processing computer':'Waiting for the processor'):conversionLabel(job)}</p>{job.error&&<p className="small">{job.error==='invalid_video'?'This video or selected range could not be read. Choose another video.':job.error==='invalid_audio'?'This clip has no usable audio track. Choose a clip with sound.':job.retryable?'Processing did not finish. You can try again.':'Processing needs a support review before another attempt.'}</p>}</div><div className="conversion-actions">{job.state==='ready_for_review'&&job.lesson_id&&<button className="primary" onClick={()=>onOpen(job.lesson_id!)}>{job.instrument?'Review music':'Check move'}</button>}{job.state==='uploading'&&<button className="secondary" disabled={!!uploading} onClick={()=>void resume(job)}>Resume</button>}{job.state==='uploading'&&<label className="secondary file-button">Choose file<input aria-label={`Resume ${job.title}`} type="file" accept="video/*" disabled={!!uploading} onChange={e=>{const file=e.target.files?.[0];if(file)void resume(job,file);e.target.value='';}}/></label>}{job.retryable&&<button className="secondary" onClick={()=>void action(job,'retry')}>Retry</button>}{job.state!=='ready_for_review'&&<button className="round" aria-label={`Cancel ${job.title}`} onClick={()=>{active.current?.abort();void action(job,'cancel');}}><X size={18}/></button>}</div></div></article>)}</div>{pollError&&<p className="inline-notice" role="status">{pollError}</p>}{error&&<p className="inline-notice error-notice" role="alert">{error}</p>}</section>;
}
