from pathlib import Path
p = Path('apps/web/src/music/MusicLessonHome.tsx')
t = p.read_text(encoding='utf-8')
start = t.index("  useEffect(()=>{\n    const source=video.current,target=piano.current")
end = t.index("  },[audioMode,syncOffset,lesson.source_video?.key,lesson.piano_preview?.key]);") + len("  },[audioMode,syncOffset,lesson.source_video?.key,lesson.piano_preview?.key]);")
t = t[:start] + "  usePianoSourcePlayer(video,piano,audioMode,syncOffset);" + t[end:]
t = t.replace("import {needsPianoResync,pianoTimeFor,shiftOnset} from './piano-playback';",
"import {shiftOnset} from './piano-playback';\nimport {usePianoSourcePlayer} from './usePianoSourcePlayer';")
t = t.replace("  const piano = useRef<HTMLAudioElement>(null);\n  const lastSync = useRef(0);", "  const piano = useRef<HTMLAudioElement>(null);")
t = t.replace("  const seek = (value: number) => {\n    lastSync.current = 0;\n", "  const seek = (value: number) => {\n")
p.write_text(t, encoding='utf-8')
print('lesson refactored')
