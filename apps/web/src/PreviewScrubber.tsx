import {useEffect,useState} from 'react';
import type {Playback} from '../../../packages/learning-engine/playback';
const stamp=(time:number)=>`${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;
export function PreviewScrubber({player}:{player:Playback}){
 const [time,setTime]=useState(player.state.time);
 useEffect(()=>{const timer=window.setInterval(()=>setTime(player.state.time),100);return()=>clearInterval(timer);},[player]);
 return <div className="preview-scrub"><span>{stamp(time)}</span><input aria-label="Preview position" type="range" min={0} max={player.duration} step={.01} value={time} onChange={e=>{player.seek(Number(e.target.value));setTime(player.state.time);}}/><span>{stamp(player.duration)}</span></div>;
}
