import {useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Button} from './ui/controls';
import {useDialogBehavior} from './ui/overlays';
/**
 * Side panels keep the workspace live behind them (`modal={false}`): the stage stays
 * interactive so an angle or preview change is visible while it is made. Panels that
 * cover their workspace keep the default modal behaviour, including the focus trap.
 */
export function PracticePanel({title,onClose,children,footer,className='',drawer=false,dismissOnBackdrop=true,modal=true,portalRoot}:{
 title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;className?:string;drawer?:boolean;dismissOnBackdrop?:boolean;modal?:boolean;
 portalRoot?:HTMLElement|null;
}){
 const ref=useRef<HTMLDivElement>(null);
 useDialogBehavior({panelRef:ref,modal,onClose});
 return createPortal(<div className={`practice-modal-backdrop ${drawer?'settings-backdrop':''}`} data-ui-surface="practice" onClick={e=>{if(dismissOnBackdrop&&e.target===e.currentTarget)onClose();}}><div ref={ref} className={`practice-modal ${drawer?'settings-drawer':''} ${className}`} role="dialog" aria-modal={modal} aria-label={title}><header><h2>{title}</h2><Button variant="modal-close" onClick={onClose} aria-label={`Close ${title}`}>Close</Button></header><div className="practice-panel-body">{children}</div>{footer&&<div className="practice-panel-footer">{footer}</div>}</div></div>,portalRoot??document.body);
}
