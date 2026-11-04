import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ChevronRight,Flag,Globe,LoaderCircle,Pause,Play,Share2} from 'lucide-react';
import {Playback} from '../../../packages/learning-engine/playback';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {MotionStage} from './MotionStage';
import {PreviewScrubber} from './PreviewScrubber';
import {addMoveToGroup,loadGroups,loadPublicMove,loadPublicMoves,loadPublicTags,request,type Account,type PublicDetail,type PublicMove,type GroupSummary} from './api';

import {PublicFeedCard} from './FeedCard';
import {FeedEmpty,FeedSkeleton} from './FeedStates';

export function ExplorePage({query,onQuery,onOpen}:{query:string;onQuery:(value:string)=>void;onOpen:(id:string)=>void}){
 const [tag,setTag]=useState(''),[moves,setMoves]=useState<PublicMove[]>([]),[tags,setTags]=useState<{tag:string;count:number}[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false),[moreBusy,setMoreBusy]=useState(false),[retry,setRetry]=useState(0);
 const generation=useRef(0);
 useEffect(()=>{loadPublicTags().then(value=>setTags(value.tags)).catch(()=>{});},[]);
 useEffect(()=>{
  const current=++generation.current;
  setLoading(true);setError('');setMore(false);setMoreBusy(false);setMoves([]);
  const timer=window.setTimeout(()=>{loadPublicMoves(query.trim(),tag).then(value=>{if(current===generation.current){setMoves(value.moves);setMore(value.moves.length===24);}}).catch(e=>{if(current===generation.current)setError(e.message);}).finally(()=>{if(current===generation.current)setLoading(false);});},200);
  return()=>{clearTimeout(timer);generation.current++;};
 },[query,tag,retry]);
 const loadMore=async()=>{
  const current=generation.current;
  setMoreBusy(true);setError('');
  try{const value=await loadPublicMoves(query.trim(),tag,moves.length);if(current===generation.current){setMoves(previous=>[...previous,...value.moves]);setMore(value.moves.length===24);}}
  catch(e){if(current===generation.current)setError((e as Error).message);}
  finally{if(current===generation.current)setMoreBusy(false);}
 };
 const filtered=!!(query.trim()||tag);
 return <section className="explore-screen browse-page" aria-labelledby="explore-title">
  <h1 className="feed-sr-only" id="explore-title">Explore public moves</h1>
  {tags.length>0&&<div className="feed-filters" role="group" aria-label="Move topics"><button aria-pressed={!tag} onClick={()=>setTag('')}>All</button>{tags.map(item=><button key={item.tag} aria-pressed={tag===item.tag} onClick={()=>setTag(tag===item.tag?'':item.tag)}>{item.tag}</button>)}</div>}
  {error&&<div className="feed-load-error" role="alert"><span>{error}</span>{!moves.length&&<button onClick={()=>setRetry(n=>n+1)}>Try again</button>}</div>}
  {loading?<FeedSkeleton label="Loading public moves"/>:moves.length?<div className="feed-grid">{moves.map(move=><PublicFeedCard key={move.lesson_id} move={move} onOpen={()=>onOpen(move.lesson_id)}/>)}</div>:!error&&<FeedEmpty icon={<Globe size={28}/>} title={filtered?'No matching moves':'No public moves yet'} description={filtered?'Try a different search or topic.':'Moves shared publicly by creators will appear here.'}>{filtered&&<button className="secondary" onClick={()=>{onQuery('');setTag('');}}>Reset filters</button>}</FeedEmpty>}
  {more&&!loading&&<div className="feed-more"><button className="secondary" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Loading…':'Show more moves'}<ChevronRight size={16}/></button></div>}
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
