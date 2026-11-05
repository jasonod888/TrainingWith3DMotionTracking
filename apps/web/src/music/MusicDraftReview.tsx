import {useEffect,useRef,useState} from 'react';
import type {MusicDraftEvent,MusicDraftView,MusicLessonManifest,Section} from '../../../../packages/lesson-schema/index';
import {parseMusicDraftView,parseMusicLessonManifest} from '../../../../packages/lesson-schema/parse';
import {assetUrl,request} from '../api';
import './music.css';
import './music-review.css';

const PAGE_SIZE=50;
const noteName=(pitch:number)=>`${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pitch%12]}${Math.floor(pitch/12)-1}`;

export function MusicDraftReview({lessonId,onBack,onReviewed,onDirty}:{lessonId:string;onBack:()=>void;onReviewed:(lesson:MusicLessonManifest)=>void;onDirty:(dirty:boolean)=>void}){
 const [draft,setDraft]=useState<MusicDraftView|null>(null),[events,setEvents]=useState<MusicDraftEvent[]>([]),[sections,setSections]=useState<Section[]>([]),[title,setTitle]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[page,setPage]=useState(0),[retry,setRetry]=useState(0);
 const video=useRef<HTMLVideoElement>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;let stopped=false;setError('');setDraft(null);
  request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`).then(value=>{
   const parsed=parseMusicDraftView(value);if(!parsed.ok)throw new Error(parsed.message);
   if(stopped)return;setDraft(parsed.value);setEvents(parsed.value.events);setTitle(parsed.value.title);
   setSections([{id:'whole',label:'Whole lesson',start:0,end:parsed.value.duration}]);setConfirmed(false);setPage(0);
  }).catch(e=>{if(!stopped)setError(e.message);});
  return()=>{stopped=true;alive.current=false;onDirty(false);};
 },[lessonId,retry,onDirty]);
 const changed=()=>{setConfirmed(false);onDirty(true);};
 const edit=(index:number,patch:Partial<MusicDraftEvent>)=>{changed();setEvents(previous=>previous.map((event,i)=>i===index?{...event,...patch}:event));};
 const remove=(index:number)=>{changed();setEvents(previous=>previous.filter((_,i)=>i!==index));};
 const save=async()=>{if(!draft||!confirmed||busy)return;setBusy(true);setError('');
  try{const result=await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft/review`,'POST',{
   draft_id:draft.draft_id,reference_sha256:draft.reference.sha256,title,events,spans:draft.spans,sections,confirm_reviewed:true,
  });const parsed=parseMusicLessonManifest(result);if(!parsed.ok)throw new Error(parsed.message);if(alive.current){onDirty(false);onReviewed(parsed.value);}}
  catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
 };
 return <section className="music-home music-review" aria-label="Review music reference">
  <button className="back-link" disabled={busy} onClick={onBack}>Back to lessons</button>
  <h1>Review your music reference</h1>
  {error&&<p className="inline-notice error-notice" role="alert">{error}{!draft&&<button onClick={()=>setRetry(n=>n+1)}>Try again</button>}</p>}
  {!draft?!error&&<p role="status">Opening your proposal…</p>:draft.status==='reviewed'?<p role="status">This proposal has already been reviewed. Open the lesson from your library.</p>:<>
   <p>Listen to the instructor video, check the proposed notes and organise your teaching sections. Saving creates a private, unscored reference. Sharing and live feedback are not enabled here.</p>
   {draft.provenance.engine==='fixture'&&<p className="inline-notice" role="status">Synthetic fixture proposal for testing. These notes are not a transcription of the video.</p>}
   {draft.source_video?<video ref={video} src={assetUrl(draft.source_video.key)} controls playsInline preload="metadata" aria-label="Instructor video for reference review"/>:<p className="inline-notice">Instructor video is unavailable for this older draft.</p>}
   <form onSubmit={event=>{event.preventDefault();void save();}}>
    <label>Lesson title<input required maxLength={200} value={title} disabled={busy} onChange={e=>{changed();setTitle(e.target.value);}}/></label>
    <h2>Proposed notes</h2><p>{events.length} notes. Changes reset the review confirmation.</p>
    <div className="music-review-notes">{events.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((event,i)=>{const index=page*PAGE_SIZE+i;return <fieldset key={event.id} disabled={busy}><legend>Note {index+1}</legend>
     <label>Note<select aria-label={`Note ${index+1} pitch`} value={event.pitch} onChange={e=>edit(index,{pitch:Number(e.target.value)})}>{Array.from({length:128},(_,pitch)=><option key={pitch} value={pitch}>{noteName(pitch)}</option>)}</select></label>
     <label>Start (seconds)<input aria-label={`Note ${index+1} start`} type="number" min={0} max={draft.duration} step="any" value={event.onset} onChange={e=>edit(index,{onset:Number(e.target.value)})}/></label>
     <label>Length (seconds)<input aria-label={`Note ${index+1} length`} type="number" min={.001} max={draft.duration} step="any" value={event.duration??''} onChange={e=>edit(index,{duration:e.target.value===''?null:Number(e.target.value)})}/></label>
     <label className="review-checkbox"><input type="checkbox" checked={event.optional} onChange={e=>edit(index,{optional:e.target.checked})}/>Optional</label>
     <button type="button" onClick={()=>{if(video.current){video.current.currentTime=event.onset;void video.current.play().catch(()=>{});}}} disabled={!draft.source_video}>Listen from note {index+1}</button>
     <button type="button" onClick={()=>remove(index)}>Remove note {index+1}</button>
    </fieldset>;})}</div>
    <div className="music-review-actions"><button type="button" disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>Previous notes</button><span>Page {page+1} of {Math.max(1,Math.ceil(events.length/PAGE_SIZE))}</span><button type="button" disabled={busy||(page+1)*PAGE_SIZE>=events.length} onClick={()=>setPage(n=>n+1)}>Next notes</button>
    <button type="button" disabled={busy||events.length>=20000} onClick={()=>{changed();setEvents(previous=>[...previous,{id:crypto.randomUUID(),onset:0,duration:Math.min(.25,draft.duration),pitch:60,velocity:null,confidence:null,optional:false}]);setPage(Math.floor(events.length/PAGE_SIZE));}}>Add note</button></div>
    <h2>Teaching sections</h2>{sections.map((section,index)=><fieldset key={section.id} disabled={busy}><legend>Section {index+1}</legend><label>Section name<input required maxLength={80} value={section.label} onChange={e=>{changed();setSections(previous=>previous.map((item,i)=>i===index?{...item,label:e.target.value}:item));}}/></label>
     <span>{section.start.toFixed(2)}–{section.end.toFixed(2)} seconds</span>{index<sections.length-1&&<label>Boundary (seconds)<input type="number" step="any" min={section.start+.05} max={sections[index+1].end-.05} value={section.end} onChange={e=>{changed();const boundary=Number(e.target.value);setSections(previous=>previous.map((item,i)=>i===index?{...item,end:boundary}:i===index+1?{...item,start:boundary}:item));}}/></label>}</fieldset>)}
    <button type="button" disabled={busy||sections.length>=500||sections[sections.length-1].end-sections[sections.length-1].start<.1} onClick={()=>{changed();setSections(previous=>{const last=previous[previous.length-1],mid=(last.start+last.end)/2;return [...previous.slice(0,-1),{...last,end:mid},{id:crypto.randomUUID(),label:`Section ${previous.length+1}`,start:mid,end:last.end}];});}}>Add section</button>
    {draft.spans.length>0&&<p>{draft.spans.length} proposed passages remain recorded with the reference. No scoring is enabled.</p>}
    {draft.warnings.map((warning,index)=><p className="small muted" key={index}>{warning}</p>)}
    <label className="review-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I have checked the notes and teaching sections against the instructor material.</label>
    <button className="primary" disabled={busy||!confirmed}>{busy?'Saving review…':'Save reviewed reference'}</button>
   </form>
  </>}
 </section>;
}
