// Controls that change how the reference is shown live with the reference, not in the
// settings drawer: arrangement, follow direction and viewing angle. Each group is a
// separate pill so narrow screens can wrap them instead of shrinking labels.
const ANGLES=[{value:0,label:'Front'},{value:Math.PI,label:'Back'},{value:Math.PI/2,label:'Left'},{value:-Math.PI/2,label:'Right'}] as const;

export function StageControls({angle,onAngle,onRecentre,showAngle,mirror,onMirror,showMirror,arrange,onArrange,showArrange,opacity,onOpacity,showOpacity}:{
 angle:number;onAngle:(angle:number)=>void;onRecentre:()=>void;showAngle:boolean;
 mirror:boolean;onMirror:(mirror:boolean)=>void;showMirror:boolean;
 arrange:'together'|'separate';onArrange:(arrange:'together'|'separate')=>void;showArrange:boolean;
 opacity:number;onOpacity:(opacity:number)=>void;showOpacity:boolean;
}){
 if(!showAngle&&!showMirror&&!showArrange&&!showOpacity)return null;
 return <div className="stage-controls">
  {showArrange&&<div className="stage-control-group" role="group" aria-label="Arrangement">
   <button type="button" aria-pressed={arrange==='together'} title="Together" onClick={()=>onArrange('together')}>Together</button>
   <button type="button" aria-pressed={arrange==='separate'} title="Side by side" onClick={()=>onArrange('separate')}>Side by side</button>
  </div>}
  {showOpacity&&<div className="stage-control-group" role="group" aria-label="Instructor opacity">
   <label className="stage-opacity" title="Instructor opacity in Together"><input type="range" min={.25} max={1} step={.05} value={opacity} aria-label="Instructor opacity" onChange={event=>onOpacity(Number(event.target.value))}/><span aria-hidden="true">{Math.round(opacity*100)}%</span></label>
  </div>}
  {showMirror&&<div className="stage-control-group" role="group" aria-label="Follow direction">
   <button type="button" aria-pressed={!mirror} aria-label="Match left and right" title="Match left and right" onClick={()=>onMirror(false)}>Match</button>
   <button type="button" aria-pressed={mirror} aria-label="Mirror the instructor" title="Mirror the instructor" onClick={()=>onMirror(true)}>Mirror</button>
  </div>}
  {showAngle&&<div className="stage-control-group" role="group" aria-label="Viewing angle">
   {ANGLES.map(option=>{
    const selected=Math.abs(option.value-angle)<1e-6;
    return <button
     type="button"
     key={option.label}
     aria-pressed={selected}
     title={selected?`${option.label} view · press again to centre the instructor`:`${option.label} view`}
     onClick={()=>selected?onRecentre():onAngle(option.value)}
    >{option.label}</button>;
   })}
  </div>}
 </div>;
}
