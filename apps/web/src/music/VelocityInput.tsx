import {intensityPercent, velocityValue} from './music-velocity';

/** Instructor control for Basic Pitch's approximate intensity, stored as 0–1 velocity. */
export function VelocityInput({label,value,onChange,disabled=false}:{
  label:string;value:number|null;onChange:(value:number|null)=>void;disabled?:boolean;
}){
 const percent=intensityPercent(value);
 const tone=percent===null?'model value':percent<34?'soft':percent<67?'medium':'loud';
 return <div className="velocity-input" role="group" aria-label={label}>
  <div className="velocity-input-head"><span>Approx. intensity</span><strong>{percent===null?'not set':`${percent}/100 · ${tone}`}</strong></div>
  <input type="range" min={0} max={100} step={1} value={percent??Math.round(velocityValue(value)*100)} disabled={disabled}
    aria-label={`${label} slider`} onChange={event=>onChange(Number(event.target.value)/100)}/>
  <input type="number" min={0} max={100} step={1} value={percent??''} placeholder="auto" disabled={disabled}
    aria-label={`${label} value`} onChange={event=>onChange(event.target.value===''?null:Math.max(0,Math.min(100,Number(event.target.value)))/100)}/>
  <p className="small muted">Approximate playback intensity. This does not measure physical key pressure.</p>
 </div>;
}
