import {useEffect,useState} from 'react';
export function usePianoPreferences(){
 const [preference]=useState(()=>{try{return JSON.parse(localStorage.getItem('piano-playback-preferences')??'{}');}catch{return {};}});
 const [audioMode,setAudioMode]=useState<'original'|'piano'>(preference.mode==='piano'?'piano':'original');
 const [volume,setVolume]=useState<number>(typeof preference.volume==='number'&&Number.isFinite(preference.volume)?Math.max(0,Math.min(1,preference.volume)):1);
 useEffect(()=>{try{localStorage.setItem('piano-playback-preferences',JSON.stringify({mode:audioMode,volume}));}catch{/* Playback still works when storage is disabled. */}},[audioMode,volume]);
 return {audioMode,setAudioMode,volume,setVolume};
}
