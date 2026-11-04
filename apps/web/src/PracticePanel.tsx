import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/**
 * Side panels keep the workspace live behind them (`modal={false}`): the stage stays
 * interactive so an angle or preview change is visible while it is made. Panels that
 * cover their workspace keep the default modal behaviour, including the focus trap.
 */
export function PracticePanel({title,onClose,children,footer,className='',drawer=false,dismissOnBackdrop=true,modal=true}:{title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;className?:string;drawer?:boolean;dismissOnBackdrop?:boolean;modal?:boolean}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=ref.current!;
  const focusable=()=>Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],video[controls],textarea:not(:disabled),summary')).filter(el=>el.getClientRects().length);
  focusable()[0]?.focus();
  // Escape is handled at document level so it still closes a non-modal side panel
  // after focus has moved into the workspace behind it.
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();return;}if(!modal||e.key!=='Tab')return;const list=focusable(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
  document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);previous?.focus();};
 },[modal]);
 return createPortal(<div className={`practice-modal-backdrop ${drawer?'settings-backdrop':''}`} onClick={e=>{if(dismissOnBackdrop&&e.target===e.currentTarget)onClose();}}><div ref={ref} className={`practice-modal ${drawer?'settings-drawer':''} ${className}`} role="dialog" aria-modal={modal} aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label={`Close ${title}`}>Close</button></header><div className="practice-panel-body">{children}</div>{footer&&<div className="practice-panel-footer">{footer}</div>}</div></div>,document.querySelector('.mimic-shell')??document.body);
}
