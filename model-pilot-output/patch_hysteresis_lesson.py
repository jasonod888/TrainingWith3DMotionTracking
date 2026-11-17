from pathlib import Path
p = Path('apps/web/src/music/MusicLessonHome.tsx')
t = p.read_text(encoding='utf-8')
t = t.replace("  const piano = useRef<HTMLAudioElement>(null);", "  const piano = useRef<HTMLAudioElement>(null);\n  const lastSync = useRef(0);")
t = t.replace("  const seek = (value: number) => {\n    if(practiceRef.current)stopPractice(false);", "  const seek = (value: number) => {\n    lastSync.current = 0;\n    if(practiceRef.current)stopPractice(false);")
t = t.replace("      if(needsPianoResync(target.currentTime,mapped))target.currentTime=mapped;", "      const now=performance.now()/1000;\n      if(needsPianoResync(target.currentTime,mapped,lastSync.current,now)){target.currentTime=mapped;lastSync.current=now;}")
p.write_text(t, encoding='utf-8')
print('lesson patched')
