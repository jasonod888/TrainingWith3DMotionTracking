from pathlib import Path
p = Path('apps/web/src/music/MusicDraftReview.tsx')
t = p.read_text(encoding='utf-8')
t = t.replace(" const piano=useRef<HTMLAudioElement>(null);", " const piano=useRef<HTMLAudioElement>(null);\n const lastSync=useRef(0);")
t = t.replace("   if(needsPianoResync(target.currentTime,mapped))target.currentTime=mapped;",
"   const now=performance.now()/1000;\n   if(needsPianoResync(target.currentTime,mapped,lastSync.current,now)){target.currentTime=mapped;lastSync.current=now;}")
t = t.replace("  source.addEventListener('seeked',sync);", "  const onSeek=()=>{lastSync.current=0;sync();};\n  source.addEventListener('seeked',onSeek);")
t = t.replace("   source.removeEventListener('seeked',sync);", "   source.removeEventListener('seeked',onSeek);")
p.write_text(t, encoding='utf-8')
print('review patched')
