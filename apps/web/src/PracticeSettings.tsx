import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

type Slot='instructor'|'layout'|'camera'|'audio';
const SettingsContext=createContext<{
 row:string|null;setRow:(row:string|null)=>void;
 slots:Partial<Record<Slot,HTMLElement>>;
 register:(slot:Slot,node:HTMLElement|null)=>void;
}|null>(null);

/** Keep camera-owned settings in their existing component, in one shared drawer. */
export function PracticeSettingsProvider({row,setRow,children}:{row:string|null;setRow:(row:string|null)=>void;children:ReactNode}){
 const [slots,setSlots]=useState<Partial<Record<Slot,HTMLElement>>>({});
 const register=useCallback((slot:Slot,node:HTMLElement|null)=>setSlots(previous=>{
  if(previous[slot]===(node??undefined))return previous;
  return {...previous,[slot]:node??undefined};
 }),[]);
 return <SettingsContext.Provider value={{row,setRow,slots,register}}>{children}</SettingsContext.Provider>;
}

export function SettingsGroup({title,slot,children}:{title:string;slot?:Slot;children?:ReactNode}){
 const context=useContext(SettingsContext)!;
 const register=context.register;
 const mount=useCallback((node:HTMLDivElement|null)=>{if(slot)register(slot,node);},[register,slot]);
 return <section className="settings-group" aria-label={title}><h3>{title}</h3>{children}{slot&&<div ref={mount}/>}</section>;
}

export function SettingsPortal({slot,children}:{slot:Slot;children:ReactNode}){
 const target=useContext(SettingsContext)?.slots[slot];
 return target?createPortal(children,target):null;
}

export function SettingsRow({id,label,value,children}:{id:string;label:string;value:ReactNode;children:ReactNode}){
 const context=useContext(SettingsContext)!;
 const expanded=context.row===id,contentId=useId(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(expanded)ref.current?.scrollIntoView({block:'nearest'});},[expanded]);
 return <div className={`settings-row ${expanded?'is-expanded':''}`} ref={ref}>
  <button type="button" className="settings-row-trigger" aria-expanded={expanded} aria-controls={contentId} onClick={()=>context.setRow(expanded?null:id)}>
   <span className="settings-row-label">{label}</span><span className="settings-row-value">{value}</span><ChevronDown size={16} aria-hidden="true"/>
  </button>
  <div id={contentId} className="settings-row-content" hidden={!expanded}>{children}</div>
 </div>;
}

export function SettingsChoices<T extends string|number>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:readonly {value:T;label:string;disabled?:boolean}[];onChange:(value:T)=>void;disabled?:boolean}){
 return <div className="settings-choices" role="group" aria-label={label}>{options.map(option=><button type="button" key={option.value} aria-pressed={value===option.value} disabled={disabled||option.disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>;
}
