// The viewing angle is a viewport control, not a stored preference: it sits on the
// movement stage next to the instructor it rotates, where the change is visible.
// Comparison pauses while the angle is not Front; the camera pane already reports
// that in its tracking line, so this control carries no explanatory copy.
const ANGLES=[{value:0,label:'Front'},{value:Math.PI,label:'Back'},{value:Math.PI/2,label:'Left'},{value:-Math.PI/2,label:'Right'}] as const;

export function ViewAngleControl({angle,onAngle,onRecentre}:{angle:number;onAngle:(angle:number)=>void;onRecentre:()=>void}){
  return <div className="view-angle-control" role="group" aria-label="Viewing angle">
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
  </div>;
}
