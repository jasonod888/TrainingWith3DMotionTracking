from pathlib import Path
p = Path('apps/web/src/music/MusicDraftReview.tsx')
t = p.read_text(encoding='utf-8')
t = t.replace(" const [savingOffset,setSavingOffset]=useState(false);\n const syncOffset", " const [savingOffset,setSavingOffset]=useState(false);\n const [loop,setLoop]=useState(false),[loopStart,setLoopStart]=useState(0),[loopEnd,setLoopEnd]=useState(0);\n const syncOffset")
t = t.replace(" const saveOffset=async(override?:number)=>{", """ useEffect(()=>{
  const media=video.current;if(!media||!loop||loopEnd<=loopStart)return;
  const tick=()=>{if(media.currentTime>=loopEnd)media.currentTime=loopStart;};
  media.addEventListener('timeupdate',tick);
  return()=>media.removeEventListener('timeupdate',tick);
 },[loop,loopStart,loopEnd]);

 const saveOffset=async(override?:number)=>{""")
t = t.replace("""    <button type="button" disabled={savingOffset} onClick={()=>{setOffsetMs('0');void saveOffset(0);}}>Reset</button>""",
"""    <button type="button" disabled={savingOffset} onClick={()=>{setOffsetMs('0');void saveOffset(0);}}>Reset</button>
    <label className="review-sync"><input aria-label="Loop playback" type="checkbox" checked={loop} onChange={event=>setLoop(event.target.checked)}/> Loop</label>
    <label className="review-sync">from <input aria-label="Loop start" type="number" min={0} max={draft.duration} step={0.1} value={loopStart} onChange={event=>setLoopStart(Number(event.target.value))}/></label>
    <label className="review-sync">to <input aria-label="Loop end" type="number" min={0} max={draft.duration} step={0.1} value={loopEnd} onChange={event=>setLoopEnd(Number(event.target.value))}/></label>""")
t = t.replace("controls playsInline preload=\"metadata\" aria-label=\"Instructor video for reference review\"/>",
"controls playsInline preload=\"metadata\" aria-label=\"Instructor video for reference review\" onLoadedMetadata={event=>{if(loopEnd===0)setLoopEnd(event.currentTarget.duration);}}/>")
p.write_text(t, encoding='utf-8')
print('review loop added')
