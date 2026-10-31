import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,Play,Scissors,Share2,SlidersHorizontal} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {audienceLabel,needsCheck,request,type MoveState} from './api';

export function StudioPage({lessons,states,onBack,onOpen,onCheck,onAdjust,onShare,onCreate}:{
 lessons:LessonManifest[];states:MoveState[];onBack:()=>void;onOpen:(lesson:LessonManifest)=>void;
 onCheck:(lesson:LessonManifest)=>void;onAdjust:(lesson:LessonManifest)=>void;onShare:(lesson:LessonManifest)=>void;onCreate:()=>void;
}){
 const [selected,setSelected]=useState<LessonManifest|null>(null);
 const stateOf=(lesson:LessonManifest)=>states.find(item=>item.lesson_id===lesson.lesson_id);
 return <section className="studio-screen">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>My moves</button>
  <div className="share-heading"><p className="eyebrow">STUDIO · TEACHING TOOLS</p><h1>Your library at a glance.</h1><p className="subtle">Detailed editing, access and publishing tools for people who teach. Casual users never need this screen.</p></div>
  <div className="studio-actions"><button className="primary" onClick={onCreate}>Add a video</button><button className="secondary" onClick={onBack}>Back to everyday view</button></div>
  {lessons.length?<div className="studio-table" role="table" aria-label="Your moves">
   <div className="studio-row studio-head" role="row"><span role="columnheader">Move</span><span role="columnheader">Parts</span><span role="columnheader">Audience</span><span role="columnheader">State</span><span role="columnheader">Actions</span></div>
   {lessons.map(lesson=>{
    const state=stateOf(lesson),checking=needsCheck(lesson,state);
    return <div className="studio-row" role="row" key={lesson.lesson_id}>
     <span role="cell" className="studio-title"><strong>{lesson.title}</strong><small>{lesson.duration.toFixed(1)}s</small></span>
     <span role="cell">{lesson.section_set.sections.length}</span>
     <span role="cell">{state?audienceLabel(state.audiences):'Only you'}</span>
     <span role="cell">{checking?<em className="state-check">Ready to check</em>:state?.accepted_revision_id?'Accepted':<em>Draft</em>}</span>
     <span role="cell" className="studio-buttons"><button className="secondary" onClick={()=>setSelected(lesson)}>Activity & access</button>{checking?<button className="secondary" onClick={()=>onCheck(lesson)}><Check size={14}/>Check</button>:<button className="secondary" onClick={()=>onOpen(lesson)}><Play size={14}/>Try</button>}<button className="round" aria-label={`Adjust ${lesson.title}`} onClick={()=>onAdjust(lesson)}><Scissors size={15}/></button><button className="round" aria-label={`Share ${lesson.title}`} onClick={()=>onShare(lesson)}><Share2 size={15}/></button></span>
    </div>;
   })}
  </div>:<div className="empty-library"><SlidersHorizontal size={28} strokeWidth={1.2}/><div><h3>No moves yet.</h3><p className="subtle">Add a video to use the teaching tools.</p></div><button className="secondary" onClick={onCreate}>Add a video<ArrowRight size={16}/></button></div>}
  {selected&&<StudioAccess key={selected.lesson_id} lesson={selected} onClose={()=>setSelected(null)} onManage={()=>onShare(selected)}/> }
 </section>;
}

type Activity={summary:{accepted:number;active:number;recently_practised:number};students:{id:string;email:string;active:boolean;revoked:boolean;last_active_at:string|null}[];invitations:{id:string;email:string}[];published_revision_id:string|null;draft_revision_id:string;public_listed:boolean;groups:number};
function StudioAccess({lesson,onClose,onManage}:{lesson:LessonManifest;onClose:()=>void;onManage:()=>void}){
 const [data,setData]=useState<Activity|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>request<Activity>(`/lessons/${lesson.lesson_id}/sharing`).then(setData).catch(e=>setError(e.message));
 // Read activity only for the selected move rather than requesting every participant on library load.
 useEffect(()=>{void load();},[lesson.lesson_id]);
 const remove=(id:string)=>{setBusy(true);request(`/lessons/${lesson.lesson_id}/students/${id}`,'DELETE').then(load).catch(e=>setError(e.message)).finally(()=>setBusy(false));};
 return <section className="studio-activity" aria-label={`Activity for ${lesson.title}`}><div className="group-section-head"><h2>{lesson.title} · Activity & access</h2><button className="secondary" onClick={onClose}>Close</button></div>
 {error&&<p role="alert">{error}</p>}{!data?<p role="status">Loading activity…</p>:<><p>{data.summary.accepted} joined · {data.summary.active} with access · {data.summary.recently_practised} practised in the last 30 days · {data.invitations.length} pending invitations</p><p className="small muted">These counts cover individual invitations and links. Group membership and public viewers are not attendance counts. Takes and pose scores stay private.</p>
 <p>Shared version: {data.published_revision_id===data.draft_revision_id?'Up to date':data.published_revision_id?'Newer private edits':'Not shared'} · {data.groups} groups · {data.public_listed?'Public':'Not public'}</p>
 {data.students.map(person=><div className="person-row" key={person.id}><span>{person.email}<small className="muted"> · {person.last_active_at?`Last practice ${new Date(person.last_active_at).toLocaleDateString()}`:'No recorded practice'} · {person.active&&!person.revoked?'Has access':'Access removed'}</small></span>{person.active&&!person.revoked&&<button className="back-link" disabled={busy} onClick={()=>remove(person.id)}>Remove access</button>}</div>)}
 <button className="primary" onClick={onManage}>Manage sharing and publication</button></>}
 </section>;
}
