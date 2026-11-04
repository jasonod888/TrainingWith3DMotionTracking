import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Check,ChevronRight,Flag,Globe,Plus,Scissors,Search,Share2,Trash2,Users} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {assetUrl,loadPublicMoves,needsCheck,type Account,type MoveState,type PublicMove} from './api';

import {FeedCard,PublicFeedCard} from './FeedCard';
import {FeedEmpty,FeedSkeleton} from './FeedStates';

export type FeedFilter='all'|'own'|'shared'|'public';
type ManageAction='check'|'edit'|'share'|'remove'|'report'|'copy';
type Props={filter:FeedFilter;setFilter:(value:FeedFilter)=>void;active:boolean;query:string;onQuery:(value:string)=>void;account:Account|null;library:LessonManifest[];shared:LessonManifest[];states:MoveState[];demo:LessonManifest|null;loading:boolean;onOpen:(lesson:LessonManifest,owned:boolean,check:boolean)=>void;onPublic:(id:string)=>void;onManage:(lesson:LessonManifest,action:ManageAction)=>void;onCreate:()=>void;onSignIn:()=>void;children?:ReactNode};
const filters:{id:FeedFilter;label:string}[]=[{id:'all',label:'All'},{id:'own',label:'My practices'},{id:'shared',label:'Shared with me'},{id:'public',label:'Public'}];

export function PracticeFeed({filter,setFilter,active,query,onQuery,account,library,shared,states,demo,loading,onOpen,onPublic,onManage,onCreate,onSignIn,children}:Props){
 const [publicMoves,setPublicMoves]=useState<PublicMove[]>([]),[publicLoading,setPublicLoading]=useState(true),[publicError,setPublicError]=useState(''),[more,setMore]=useState(false),[moreBusy,setMoreBusy]=useState(false),[retry,setRetry]=useState(0);
 const generation=useRef(0),loadedKey=useRef('');
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
  <h1 className="feed-sr-only">Find your next practice</h1>
  <div className="feed-filters" aria-label="Practice sources">{filters.map(item=><button key={item.id} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div>
  {children&&<div className="feed-processing">{children}</div>}
  {showPublic&&publicError&&<div className="feed-load-error" role="status"><span>Public practices couldn’t load. Your available practices are shown below.</span><button onClick={()=>setRetry(n=>n+1)}>Try again</button></div>}
  {(loading||showPublic&&publicLoading)&&!count?<FeedSkeleton/>:count?<div className="feed-grid">{own.map(item=>localCard(item,'own'))}{received.map(item=>localCard(item,'shared'))}{discovery.map(item=><PublicFeedCard key={item.lesson_id} move={item} onOpen={()=>onPublic(item.lesson_id)}/>)}{sample&&localCard(sample,'demo')}</div>:<FeedEmpty icon={filter==='shared'?<Users size={28}/>:filter==='public'?<Globe size={28}/>:<Search size={28}/>} title={query?'No matching practices':filter==='own'?'Your practices start here':filter==='shared'?'Nothing shared with you yet':filter==='public'?'Public practices are on their way':'Your next practice starts here'} description={query?'Try a different title or browse another source.':!account&&(filter==='own'||filter==='shared')?'Sign in to see your practices and anything shared with you.':filter==='shared'?'Practices shared directly or through your groups will appear here.':filter==='public'?'Practices appear here when their creators publish them.':'Add a video, or browse the public practices available to you.'}>{query?<button className="secondary" onClick={()=>onQuery('')}>Clear search</button>:filter==='own'||filter==='all'?<button className="primary" onClick={account?onCreate:onSignIn}><Plus size={17}/>{account?'Create a practice':'Sign in to create'}</button>:!account&&filter==='shared'?<button className="primary" onClick={onSignIn}>Sign in</button>:null}</FeedEmpty>}
  {showPublic&&more&&!publicLoading&&<div className="feed-more"><button className="secondary" disabled={moreBusy} onClick={()=>{const current=generation.current;setMoreBusy(true);loadPublicMoves(query.trim(),'',publicMoves.length).then(value=>{if(generation.current!==current)return;setPublicMoves(previous=>[...previous,...value.moves.filter(item=>!previous.some(old=>old.lesson_id===item.lesson_id))]);setMore(value.moves.length===24);}).catch(e=>{if(generation.current===current)setPublicError(e.message);}).finally(()=>{if(generation.current===current)setMoreBusy(false);});}}>{moreBusy?'Loading…':'More practices'}<ChevronRight size={16}/></button></div>}
 </section>;
}

