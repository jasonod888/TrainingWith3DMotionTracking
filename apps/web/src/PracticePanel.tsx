import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
export function PracticePanel({title,onClose,children,footer,className=''}:{title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;className?:string}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=ref.current!;
  const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],video[controls],textarea:not(:disabled)')).filter(el=>el.getClientRects().length);
  focusable()[0]?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();}if(e.key==='Tab'){const list=focusable(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  node.addEventListener('keydown',key);return()=>{node.removeEventListener('keydown',key);previous?.focus();};
 },[]);
 return createPortal(<div className="practice-modal-backdrop"><div ref={ref} className={`practice-modal ${className}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label={`Close ${title}`}>Close</button></header><div className="practice-panel-body">{children}</div>{footer&&<div className="practice-panel-footer">{footer}</div>}</div></div>,document.querySelector('.mimic-shell')??document.body);
}
