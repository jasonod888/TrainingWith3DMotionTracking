import {useEffect,useId,useRef,useState} from 'react';
import {ArrowLeft,Search,X} from 'lucide-react';

export function FeedSearch({query,onQuery,label='Search practices',placeholder='Search lessons or creators',onSubmit}:{query:string;onQuery:(value:string)=>void;label?:string;placeholder?:string;onSubmit?:()=>void}){
 const searchId=useId();
 const [open,setOpen]=useState(false);
 const input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
 return <div className={`feed-header-search ${open?'is-open':''}`}>
  <button ref={trigger} className={`feed-search-toggle ${query?'has-query':''}`} aria-label="Open search" aria-expanded={open} aria-controls={searchId} onClick={()=>setOpen(true)}><Search size={21}/></button>
  <div className="feed-search-panel" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
   <button className="feed-search-back" aria-label="Close search" onClick={close}><ArrowLeft size={21}/></button>
   <form className="feed-search" role="search" id={searchId} onSubmit={event=>{event.preventDefault();onSubmit?.();close();}}><button type="submit" aria-label="Search lessons"><Search size={19}/></button><input ref={input} type="search" aria-label={label} placeholder={placeholder} value={query} onChange={e=>onQuery(e.target.value)}/>{query&&<button type="button" aria-label="Clear search" onClick={()=>{onQuery('');input.current?.focus();}}><X size={18}/></button>}</form>
  </div>
 </div>;
}
