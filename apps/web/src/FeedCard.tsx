import {useEffect,useRef,useState} from 'react';
import {Ellipsis,Globe,Music2,Play,Rotate3D,User,Users} from 'lucide-react';
import type {PublicMove} from './api';
import {SubjectBadge} from './SubjectBadge';
import {Button} from './ui/controls';

const duration=(t:number)=>`${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`;

export function PublicFeedCard({move,onOpen}:{move:PublicMove;onOpen:()=>void}){
 return <FeedCard title={move.title} subjectLabel={move.subject_label} creator={move.creator_name} thumbnail={move.thumbnail_url} seconds={move.duration} badge="Public" kind="public" family={move.experience_family} detail={move.tags.slice(0,2).join(' · ')||'Available to everyone'} onOpen={onOpen}/>;
}

type CardAction={label:string;Icon:typeof Play;action:()=>void};
export function FeedCard({title,thumbnail,seconds,creator,badge,kind,detail,onOpen,actions=[],family='body',subjectLabel}:{title:string;thumbnail:string|null;seconds:number;creator:string;badge:string;kind:'own'|'shared'|'public'|'demo';detail:string;onOpen:()=>void;actions?:CardAction[];family?:'body'|'music';subjectLabel?:string|null}){
 const [broken,setBroken]=useState(false),menu=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{setBroken(false);},[thumbnail]);
 const PosterIcon=family==='music'?Music2:Rotate3D;
 const hasActions=actions.length>0;
 useEffect(()=>{if(!hasActions)return;const close=(e:PointerEvent)=>{if(menu.current&&!menu.current.contains(e.target as Node))menu.current.open=false;};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&menu.current?.open){menu.current.open=false;menu.current.querySelector('summary')?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[hasActions]);
 return <article className={`feed-card feed-card-${kind}`}>
  <Button variant="feed-thumbnail" className="feed-thumbnail" onClick={onOpen} aria-label={`Open ${title}`}>{thumbnail&&!broken?<img src={thumbnail} alt="" loading="lazy" onError={()=>setBroken(true)}/>:<span className="feed-poster"><span className="feed-poster-orbit"/><PosterIcon size={52} strokeWidth={1}/><span>{family==='music'?'MUSIC LESSON':'3D MOVEMENT'}</span></span>}<span className="feed-source-badge">{kind==='public'?<Globe size={11}/>:kind==='shared'?<Users size={11}/>:kind==='own'?<User size={11}/>:<Play size={11}/>} {badge}</span><span className="feed-hover-play"><Play size={22} fill="currentColor"/></span><span className="feed-duration">{duration(seconds)}</span></Button>
  <div className="feed-card-info"><span className="feed-avatar" aria-hidden="true">{kind==='own'?<span>Y</span>:kind==='shared'?<Users size={17}/>:kind==='demo'?<Rotate3D size={19}/>:creator.trim().slice(0,1).toUpperCase()||<Globe size={17}/>}</span><div className="feed-card-copy"><h2><Button variant="feed-title" onClick={onOpen}>{title}</Button></h2><p>{creator}</p><SubjectBadge label={subjectLabel}/><p className="feed-card-detail">{detail}</p></div>{actions.length>0&&<details ref={menu} className="feed-card-menu"><summary aria-label={`Options for ${title}`}><Ellipsis size={21}/></summary><div className="feed-card-actions">{actions.map(({label,Icon,action})=><Button variant="feed-card-action" key={label} onClick={()=>{if(menu.current)menu.current.open=false;action();}}><Icon size={16}/>{label}</Button>)}</div></details>}</div>
 </article>;
}
