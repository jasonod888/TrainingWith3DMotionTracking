import {createContext,useCallback,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';

type Slot='instructor'|'layout'|'camera';
type Family='setup'|'playback'|'display';
const familyFor=(id:string):Family=>['speed','repeat','countdown','metronome'].includes(id)?'playback':['fullscreen','large-text'].includes(id)?'display':'setup';
const Availability=createContext<{reason?:string;status?:string}>({});
const SettingsContext=createContext<{
 row:string|null;groups:ReadonlySet<Family>;openGroup:(id:Family)=>void;toggleGroup:(id:Family)=>void;
 slots:Partial<Record<Slot,HTMLElement>>;register:(slot:Slot,node:HTMLElement|null)=>void;
}|null>(null);

export function PracticeSettingsProvider({row,children}:{row:string|null;setRow:(row:string|null)=>void;children:ReactNode}){
 const [slots,setSlots]=useState<Partial<Record<Slot,HTMLElement>>>({});
 const [groups,setGroups]=useState<ReadonlySet<Family>>(()=>new Set(['setup']));
 const openGroup=useCallback((id:Family)=>setGroups(previous=>previous.has(id)?previous:new Set([...previous,id])),[]);
 const toggleGroup=useCallback((id:Family)=>setGroups(previous=>{const next=new Set(previous);if(next.has(id))next.delete(id);else next.add(id);return next;}),[]);
 const register=useCallback((slot:Slot,node:HTMLElement|null)=>setSlots(previous=>previous[slot]===(node??undefined)?previous:{...previous,[slot]:node??undefined}),[]);
 return <SettingsContext.Provider value={{row,groups,openGroup,toggleGroup,slots,register}}>{children}</SettingsContext.Provider>;
}

/** One accordion per dependency family; individual controls never collapse. */
export function SettingsGroup({id,title,summary,children,disabledReason,status}:{id:Family;title:string;summary?:string;children?:ReactNode;disabledReason?:string;status?:string}){
 const context=useContext(SettingsContext)!,contentId=useId(),expanded=context.groups.has(id),openGroup=context.openGroup;
 useEffect(()=>{if(context.row&&familyFor(context.row)===id)openGroup(id);},[context.row,id,openGroup]);
 return <section className="settings-group settings-family" aria-label={title}>
  <h3><button type="button" className="settings-family-trigger" aria-expanded={expanded} aria-controls={contentId} onClick={()=>context.toggleGroup(id)}><span>{title}{summary&&<small>{summary}</small>}</span><ChevronDown size={17} aria-hidden="true"/></button></h3>
  <div id={contentId} className="settings-family-content" hidden={!expanded}><Availability.Provider value={{reason:disabledReason,status}}>{children}</Availability.Provider></div>
 </section>;
}

export function SettingsMount({slot}:{slot:Slot}){
 const register=useContext(SettingsContext)!.register;
 const mount=useCallback((node:HTMLDivElement|null)=>register(slot,node),[register,slot]);
 return <div ref={mount}/>;
}
export function SettingsPortal({slot,children,disabledReason,status}:{slot:Slot;children:ReactNode;disabledReason?:string;status?:string}){
 const target=useContext(SettingsContext)?.slots[slot];
 return target?createPortal(<Availability.Provider value={{reason:disabledReason,status}}>{children}</Availability.Provider>,target):null;
}

export function SettingsRow({id,label,value,children,disabledReason,status}:{id:string;label:string;value:ReactNode;children:ReactNode;disabledReason?:string;status?:string}){
 const context=useContext(SettingsContext)!,inherited=useContext(Availability),reason=inherited.reason||disabledReason;
 const stateLabel=inherited.reason?(inherited.status||'Unavailable'):(status||(reason?'Unavailable':undefined));
 const visible=context.groups.has(familyFor(id)),labelId=useId(),reasonId=useId(),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(context.row===id&&visible)ref.current?.scrollIntoView({block:'nearest'});},[context.row,id,visible]);
 return <div className={`settings-row settings-control ${reason?'is-unavailable':''}`} ref={ref}>
  <div className="settings-control-heading"><span id={labelId} className="settings-row-label">{label}</span><span className="settings-control-state">{stateLabel&&<small>{stateLabel}</small>}<span className="settings-row-value">{value}</span></span></div>
  <fieldset className="settings-row-content" aria-label={`${label} controls`} aria-describedby={reason?reasonId:undefined} disabled={Boolean(reason)}>{children}</fieldset>
  {reason&&<p id={reasonId} className="settings-disabled-reason">{reason}</p>}
 </div>;
}

export function SettingsChoices<T extends string|number>({label,value,options,onChange,disabled=false}:{label:string;value:T;options:readonly {value:T;label:string;disabled?:boolean}[];onChange:(value:T)=>void;disabled?:boolean}){
 return <div className="settings-choices" role="group" aria-label={label}>{options.map(option=><button type="button" key={option.value} aria-pressed={value===option.value} disabled={disabled||option.disabled} onClick={()=>onChange(option.value)}>{option.label}</button>)}</div>;
}
