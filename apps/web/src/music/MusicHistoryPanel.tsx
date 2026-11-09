import {useEffect,useRef,useState} from 'react';
import {request} from '../api';
import {parseMusicHistoryPage,type MusicHistoryPage} from './music-history';
import './music.css';

/** Explicit reads only. Account mode shows personal summaries, including unavailable lessons. */
export function MusicHistoryPanel({lessonId,refreshToken=0,onDelete}:{lessonId?:string;refreshToken?:number;onDelete?:(id:string)=>void}){
 const [open,setOpen]=useState(false),[page,setPage]=useState<MusicHistoryPage>({items:[],next_cursor:null});
 const [busy,setBusy]=useState<'first'|'more'|null>(null),[error,setError]=useState(''),[failedMore,setFailedMore]=useState(false),[deleting,setDeleting]=useState<string|null>(null);
 const epoch=useRef(0),alive=useRef(true),pending=useRef(false);
 const path=lessonId?`/lessons/${encodeURIComponent(lessonId)}/music-attempts/page`:'/music-attempts';
 const load=async(more=false)=>{
  if(pending.current)return;
  pending.current=true;setOpen(true);setBusy(more?'more':'first');setError('');setFailedMore(false);
  const token=++epoch.current;
  const suffix=more&&page.next_cursor?`?cursor=${encodeURIComponent(page.next_cursor)}`:'';
  try{
   const value=parseMusicHistoryPage(await request<unknown>(path+suffix));
   if(!alive.current||token!==epoch.current)return;
   setPage(previous=>({items:more?[...previous.items,...value.items.filter(row=>!previous.items.some(item=>item.id===row.id))]:value.items,next_cursor:value.next_cursor}));
  }catch(cause){if(alive.current&&token===epoch.current){setError(cause instanceof Error?cause.message:'History could not be loaded.');setFailedMore(more);}}
  finally{if(alive.current&&token===epoch.current){pending.current=false;setBusy(null);}}
 };
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>{if(open){epoch.current++;pending.current=false;void load();}},[refreshToken]);
 const remove=async(id:string,sourceLesson:string)=>{
  if(deleting)return;
  setDeleting(id);setError('');
  try{
   await request(`/lessons/${encodeURIComponent(sourceLesson)}/music-attempts/${encodeURIComponent(id)}`,'DELETE');
   if(!alive.current)return;
   epoch.current++;pending.current=false;setBusy(null);
   setPage(previous=>({...previous,items:previous.items.filter(item=>item.id!==id)}));onDelete?.(id);
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:'Summary could not be deleted.');}
  finally{if(alive.current)setDeleting(null);}
 };
 return <section className="music-history" aria-label={lessonId?'Music practice history':'Account music history'}>
  <div className="history-head"><h2>{lessonId?'Practice history':'Music practice history'}</h2><button className="secondary" disabled={busy!==null||deleting!==null} onClick={()=>void load()}>{open?'Refresh history':lessonId?'View music history':'View all music history'}</button></div>
  {open&&<>
   {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
   {busy==='first'&&<p role="status">Loading your saved summaries…</p>}
   {page.items.length?<ul className="history-list">{page.items.map(item=><li key={item.id}>
    <div>{!lessonId&&<strong>{item.title??'Lesson unavailable'}</strong>}<strong>{new Date(item.date).toLocaleString()}</strong><span>Run {item.run+1} · {item.section_id==='all'?'Whole lesson':item.section_id} · {item.start.toFixed(1)}–{item.end.toFixed(1)}s · {item.speed}× · {item.note_window.matched} matched · {item.note_window.missing} missing · {item.note_window.extra} extra · {item.note_window.eligible} of {item.note_window.total} eligible</span></div>
    <button className="back-link" disabled={deleting!==null} aria-label={`Delete summary ${item.id}`} onClick={()=>void remove(item.id,item.lesson_id)}>{deleting===item.id?'Deleting…':'Delete'}</button>
   </li>)}</ul>:!busy&&!error&&<p className="small muted">No saved summaries yet.</p>}
   {page.next_cursor&&<button className="secondary" disabled={busy!==null||deleting!==null} onClick={()=>void load(true)}>{busy==='more'?'Loading more…':failedMore?'Retry more summaries':'More summaries'}</button>}
   <p className="small muted">Private, unscored, client-reported summaries. Not a score or accuracy measure.</p>
  </>}
 </section>;
}
