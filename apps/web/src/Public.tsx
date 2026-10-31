import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Flag,Globe,LoaderCircle,Pause,Play,Rotate3D,Search,Share2} from 'lucide-react';
import {Playback} from '../../../packages/learning-engine/playback';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {MotionStage} from './MotionStage';
import {PreviewScrubber} from './PreviewScrubber';
import {addMoveToGroup,loadGroups,loadPublicMove,loadPublicMoves,loadPublicTags,request,type Account,type PublicDetail,type PublicMove,type GroupSummary} from './api';

const stamp=(time:number)=>`${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;

export function ExplorePage({onBack,onOpen}:{onBack:()=>void;onOpen:(id:string)=>void}){
 const [query,setQuery]=useState(''),[tag,setTag]=useState(''),[moves,setMoves]=useState<PublicMove[]>([]),[tags,setTags]=useState<{tag:string;count:number}[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false),[moreBusy,setMoreBusy]=useState(false);
 useEffect(()=>{loadPublicTags().then(value=>setTags(value.tags)).catch(()=>{});},[]);
 useEffect(()=>{let stopped=false;setLoading(true);setError('');setMore(false);const timer=window.setTimeout(()=>{loadPublicMoves(query,tag).then(value=>{if(!stopped){setMoves(value.moves);setMore(value.moves.length===24);}}).catch(e=>{if(!stopped)setError(e.message);}).finally(()=>{if(!stopped)setLoading(false);});},220);return()=>{stopped=true;clearTimeout(timer);};},[query,tag]);
 return <section className="explore-screen">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>My moves</button>
  <div className="share-heading"><p className="eyebrow">EXPLORE</p><h1>Moves people shared.</h1><p className="subtle">Watch a move, then try it at your pace.</p></div>
  <div className="explore-search"><Search size={17}/><input aria-label="Search public moves" placeholder="Search moves or people" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  {tags.length>0&&<div className="tag-row">{tags.map(item=><button key={item.tag} className={tag===item.tag?'selected':''} aria-pressed={tag===item.tag} onClick={()=>setTag(tag===item.tag?'':item.tag)}>{item.tag}</button>)}</div>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
  {loading?<div className="empty-state" role="status"><span className="loader dark"/>Finding moves…</div>:moves.length?<div className="public-grid">{moves.map(move=><button key={move.lesson_id} className="public-card" onClick={()=>onOpen(move.lesson_id)}>{move.thumbnail_url?<img src={move.thumbnail_url} alt=""/>:<span className="cover-placeholder"><Rotate3D size={38}/></span>}<span className="public-card-body"><strong>{move.title}</strong><small>{move.creator_name} · {stamp(move.duration)}</small><span className="tag-row small-tags">{move.tags.slice(0,3).map(value=><em key={value}>{value}</em>)}</span></span></button>)}</div>:<div className="empty-library"><Globe size={28} strokeWidth={1.2}/><div><h3>Nothing here yet.</h3><p className="subtle">{query||tag?'No public moves match this search.':'Public moves will appear here.'}</p></div></div>}
  {more&&!loading&&<button className="secondary" disabled={moreBusy} onClick={()=>{setMoreBusy(true);setError('');loadPublicMoves(query,tag,moves.length).then(value=>{setMoves(previous=>[...previous,...value.moves.filter(item=>!previous.some(old=>old.lesson_id===item.lesson_id))]);setMore(value.moves.length===24);}).catch(e=>setError(e.message)).finally(()=>setMoreBusy(false));}}>{moreBusy?'Loading…':'Show more moves'}</button>}
 </section>;
}

export function PublicDetailPage({id,account,onBack,onTry,onSignIn}:{id:string;account:Account|null;onBack:()=>void;onTry:(lesson:PublicDetail)=>void;onSignIn:()=>void}){
 const [lesson,setLesson]=useState<PublicDetail|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[playing,setPlaying]=useState(false);
 const playerRef=useRef<Playback|null>(null);
 const [groups,setGroups]=useState<GroupSummary[]>([]),[groupId,setGroupId]=useState(''),[adding,setAdding]=useState(false);
 useEffect(()=>{if(account)loadGroups().then(value=>setGroups(value.groups)).catch(()=>{});},[account]);
 useEffect(()=>{let stopped=false;loadPublicMove(id).then(value=>{if(!stopped){setLesson(value);playerRef.current=new Playback(value.section_set.sections,value.duration);playerRef.current.mode('continuous');}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[id]);
 useEffect(()=>{if(!playerRef.current)return;let frame=0,last=performance.now();const tick=(now:number)=>{const player=playerRef.current;if(!player)return;player.tick(Math.min((now-last)/1000,.25));last=now;setPlaying(player.state.playing);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[lesson]);
 const play=()=>{playerRef.current?.command(playerRef.current.state.playing?'pause':'play');};
 const report=()=>{const reason=window.prompt('What would you like to report?');if(reason&&reason.trim().length>=3)void request(`/lessons/${id}/report`,'POST',{reason}).then(()=>setNotice('Report received. Thank you.')).catch(e=>setError(e.message));};
 if(!lesson)return <section className="explore-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={16}/>Explore</button>{error?<p className="inline-notice error-notice" role="alert">{error}</p>:<p role="status">Loading move…</p>}</section>;
 return <section className="explore-screen">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>Explore</button>
  <div className="share-heading"><p className="eyebrow">PUBLIC MOVE · {lesson.creator_name}</p><h1>{lesson.title}</h1>{lesson.description&&<p className="subtle">{lesson.description}</p>}<div className="tag-row small-tags">{lesson.tags.map(value=><em key={value}>{value}</em>)}</div></div>
  <div className="move-stage motion-stage"><MotionStage lesson={lesson as LessonManifest} player={playerRef.current!} source={false}/><button className="move-play" onClick={play} aria-label={playing?'Pause move':'Play move'}>{playing?<Pause size={20}/>:<Play size={20} fill="currentColor"/>}</button></div>
  <PreviewScrubber player={playerRef.current!}/>
  <div className="move-actions"><button className="primary" onClick={()=>account?onTry(lesson):onSignIn()}>{account?<><Play size={18} fill="currentColor"/>Try this move</>:'Sign in to try'}</button><button className="secondary" onClick={()=>{const url=new URL(`/?page=public&id=${encodeURIComponent(id)}`,location.origin).href;if(navigator.share)void navigator.share({title:lesson.title,url}).catch(e=>{if(e.name!=='AbortError')setError('Could not open sharing. Copy the address from your browser.');});else void navigator.clipboard.writeText(url).then(()=>setNotice('Public link copied.')).catch(()=>setNotice('Copy the address from your browser to share this move.'));}}><Share2 size={16}/>Share link</button>{account&&<button className="secondary" onClick={report}><Flag size={16}/>Report</button>}</div>
  {account&&groups.length>0&&<div className="invite-row"><label>Keep in a group<select value={groupId} onChange={e=>setGroupId(e.target.value)}><option value="">Choose a group</option>{groups.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label><button className="secondary" disabled={!groupId||adding} onClick={()=>{setAdding(true);addMoveToGroup(groupId,id,'collection').then(()=>setNotice('Added to the collection. It stays available only while public.')).catch(e=>setError(e.message)).finally(()=>setAdding(false));}}>Add to group</button></div>}
  {notice&&<p className="inline-notice" role="status">{notice}</p>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
  <p className="small muted check-note">Public moves are shared by their creators. Similarity feedback is approximate, not technique certification.</p>
 </section>;
}
