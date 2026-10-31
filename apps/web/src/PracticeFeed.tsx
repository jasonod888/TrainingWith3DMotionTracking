import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,ChevronRight,Ellipsis,Flag,Globe,User,Play,Plus,Rotate3D,Scissors,Search,Share2,Trash2,Users,X} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {assetUrl,loadPublicMoves,needsCheck,type Account,type MoveState,type PublicMove} from './api';

type Filter='all'|'own'|'shared'|'public';
type ManageAction='check'|'edit'|'share'|'remove'|'report'|'copy';
type Props={active:boolean;account:Account|null;library:LessonManifest[];shared:LessonManifest[];states:MoveState[];demo:LessonManifest|null;loading:boolean;onOpen:(lesson:LessonManifest,owned:boolean,check:boolean)=>void;onPublic:(id:string)=>void;onManage:(lesson:LessonManifest,action:ManageAction)=>void;onCreate:()=>void;onSignIn:()=>void;children?:ReactNode};
const filters:{id:Filter;label:string}[]=[{id:'all',label:'All'},{id:'own',label:'My practices'},{id:'shared',label:'Shared with me'},{id:'public',label:'Public'}];
const duration=(t:number)=>`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;

export function PracticeFeed({active,account,library,shared,states,demo,loading,onOpen,onPublic,onManage,onCreate,onSignIn,children}:Props){
 const [filter,setFilter]=useState<Filter>('all'),[query,setQuery]=useState(''),[publicMoves,setPublicMoves]=useState<PublicMove[]>([]),[publicLoading,setPublicLoading]=useState(true),[publicError,setPublicError]=useState(''),[more,setMore]=useState(false),[moreBusy,setMoreBusy]=useState(false),[retry,setRetry]=useState(0);
 const generation=useRef(0),loadedKey=useRef(''),accountId=account?.id;
 useEffect(()=>{setFilter('all');setQuery('');},[accountId]);
 const showPublic=filter==='all'||filter==='public';
 useEffect(()=>{
  if(!active||!showPublic)return;
  const key=JSON.stringify([query.trim(),retry]);if(loadedKey.current===key)return;
  let stopped=false;loadedKey.current='';generation.current++;setPublicLoading(true);setPublicMoves([]);setPublicError('');setMore(false);setMoreBusy(false);
  const timer=window.setTimeout(()=>{loadPublicMoves(query.trim()).then(value=>{if(!stopped){loadedKey.current=key;setPublicMoves(value.moves);setMore(value.moves.length===24);}}).catch(e=>{if(!stopped)setPublicError(e.message);}).finally(()=>{if(!stopped)setPublicLoading(false);});},200);
  return()=>{stopped=true;generation.current++;clearTimeout(timer);};
 },[query,showPublic,active,retry]);
 const matches=(title:string)=>title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
 const own=filter==='all'||filter==='own'?library.filter(item=>matches(item.title)):[];
 const received=filter==='all'||filter==='shared'?shared.filter(item=>matches(item.title)&&!library.some(own=>own.lesson_id===item.lesson_id)):[];
 const discovery=showPublic?publicMoves.filter(item=>filter==='public'||![...library,...shared].some(known=>known.lesson_id===item.lesson_id)):[];
 const sample=demo&&filter==='all'&&matches(demo.title)&&![...library,...shared,...publicMoves].some(item=>item.lesson_id===demo.lesson_id)?demo:null;
 const count=own.length+received.length+discovery.length+(sample?1:0);
 const localCard=(lesson:LessonManifest,source:'own'|'shared'|'demo')=>{
  const state=states.find(item=>item.lesson_id===lesson.lesson_id),check=source==='own'&&needsCheck(lesson,state);
  const creator=source==='own'?'You':source==='demo'?'Form · Demonstration':'Shared with you';
  const badge=check?'Ready to check':source==='own'?'Your practice':source==='demo'?'Try a practice':'Shared with you';
  const actions=source==='own'?[...(check?[{label:'Check movement',Icon:Check,action:()=>onManage(lesson,'check')}]:[]),{label:'Adjust practice',Icon:Scissors,action:()=>onManage(lesson,'edit')},{label:'Share practice',Icon:Share2,action:()=>onManage(lesson,'share')},{label:'Remove practice',Icon:Trash2,action:()=>onManage(lesson,'remove')}]:source==='demo'?[{label:account?'Add private copy':'Sign in to save',Icon:Plus,action:()=>onManage(lesson,'copy')}]:account?[{label:'Report practice',Icon:Flag,action:()=>onManage(lesson,'report')}]:[];
  return <FeedCard key={`${source}-${lesson.lesson_id}`} title={lesson.title} thumbnail={lesson.thumbnail?assetUrl(lesson.thumbnail.key):null} seconds={lesson.duration} creator={creator} badge={badge} kind={source} detail={`${lesson.section_set.sections.length} ${lesson.section_set.sections.length===1?'section':'sections'}${check?' · Check before practising':''}`} onOpen={()=>onOpen(lesson,source==='own',check)} actions={actions}/>;
 };
 return <section className="practice-feed" aria-label="Practice feed">
  <div className="feed-toolbar"><h1>Find your next practice<span>.</span></h1><div className="feed-search"><Search size={19}/><input type="search" aria-label="Search practices" placeholder="Search practices or public creators" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={18}/></button>}</div></div>
  <div className="feed-filters" aria-label="Practice sources">{filters.map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div>
  {children&&<div className="feed-processing">{children}</div>}
  {showPublic&&publicError&&<div className="feed-load-error" role="status"><span>Public practices couldn’t load. Your available practices are shown below.</span><button onClick={()=>setRetry(n=>n+1)}>Try again</button></div>}
  {(loading||showPublic&&publicLoading)&&!count?<div className="feed-grid" aria-label="Loading practices" aria-busy="true">{[0,1,2,3,4,5].map(i=><div className="feed-skeleton" key={i}><div/><span/><span/></div>)}</div>:count?<div className="feed-grid">{own.map(item=>localCard(item,'own'))}{received.map(item=>localCard(item,'shared'))}{discovery.map(item=><FeedCard key={`public-${item.lesson_id}`} title={item.title} creator={item.creator_name} thumbnail={item.thumbnail_url} seconds={item.duration} badge="Public" kind="public" detail={item.tags.slice(0,2).join(' · ')||'Available to everyone'} onOpen={()=>onPublic(item.lesson_id)} actions={[]}/>)}{sample&&localCard(sample,'demo')}</div>:<div className="feed-empty"><span className="feed-empty-icon">{filter==='shared'?<Users size={28}/>:filter==='public'?<Globe size={28}/>:<Search size={28}/>}</span><h2>{query?'No matching practices':filter==='own'?'Your practices start here':filter==='shared'?'Nothing shared with you yet':filter==='public'?'Public practices are on their way':'Your next practice starts here'}</h2><p>{query?'Try a different title or browse another source.':!account&&(filter==='own'||filter==='shared')?'Sign in to see your practices and anything shared with you.':filter==='shared'?'Practices shared directly or through your groups will appear here.':filter==='public'?'Practices appear here when their creators publish them.':'Add a video, or browse the public practices available to you.'}</p>{query?<button className="secondary" onClick={()=>setQuery('')}>Clear search</button>:filter==='own'||filter==='all'?<button className="primary" onClick={account?onCreate:onSignIn}><Plus size={17}/>{account?'Create a practice':'Sign in to create'}</button>:!account&&filter==='shared'?<button className="primary" onClick={onSignIn}>Sign in</button>:null}</div>}
  {showPublic&&more&&!publicLoading&&<div className="feed-more"><button className="secondary" disabled={moreBusy} onClick={()=>{const current=generation.current;setMoreBusy(true);loadPublicMoves(query.trim(),'',publicMoves.length).then(value=>{if(generation.current!==current)return;setPublicMoves(previous=>[...previous,...value.moves.filter(item=>!previous.some(old=>old.lesson_id===item.lesson_id))]);setMore(value.moves.length===24);}).catch(e=>{if(generation.current===current)setPublicError(e.message);}).finally(()=>{if(generation.current===current)setMoreBusy(false);});}}>{moreBusy?'Loading…':'More practices'}<ChevronRight size={16}/></button></div>}
 </section>;
}

type CardAction={label:string;Icon:typeof Play;action:()=>void};
function FeedCard({title,thumbnail,seconds,creator,badge,kind,detail,onOpen,actions}:{title:string;thumbnail:string|null;seconds:number;creator:string;badge:string;kind:'own'|'shared'|'public'|'demo';detail:string;onOpen:()=>void;actions:CardAction[]}){
 const [broken,setBroken]=useState(false),menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{setBroken(false);},[thumbnail]);
 useEffect(()=>{const close=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false;};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[]);
 return <article className={`feed-card feed-card-${kind}`}>
  <button className="feed-thumbnail" onClick={onOpen} aria-label={`Open ${title}`}>{thumbnail&&!broken?<img src={thumbnail} alt="" loading="lazy" onError={()=>setBroken(true)}/>:<span className="feed-poster"><span className="feed-poster-orbit"/><Rotate3D size={52} strokeWidth={1}/><span>3D MOVEMENT</span></span>}<span className="feed-source-badge">{kind==='public'?<Globe size={11}/>:kind==='shared'?<Users size={11}/>:kind==='own'?<User size={11}/>:<Play size={11}/>} {badge}</span><span className="feed-hover-play"><Play size={22} fill="currentColor"/></span><span className="feed-duration">{duration(seconds)}</span></button>
  <div className="feed-card-info"><span className="feed-avatar" aria-hidden="true">{kind==='own'?<span>Y</span>:kind==='shared'?<Users size={17}/>:kind==='demo'?<Rotate3D size={19}/>:creator.trim().slice(0,1).toUpperCase()||<Globe size={17}/>}</span><div className="feed-card-copy"><h2><button onClick={onOpen}>{title}</button></h2><p>{creator}</p><p className="feed-card-detail">{detail}</p></div>{actions.length>0&&<details ref={menu} className="feed-card-menu"><summary aria-label={`Options for ${title}`}><Ellipsis size={21}/></summary><div className="feed-card-actions">{actions.map(({label,Icon,action})=><button key={label} onClick={()=>{if(menu.current)menu.current.open=false;action();}}><Icon size={16}/>{label}</button>)}</div></details>}</div>
 </article>;
}

