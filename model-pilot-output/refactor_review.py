from pathlib import Path
p = Path('apps/web/src/music/MusicDraftReview.tsx')
t = p.read_text(encoding='utf-8')
start = t.index(" useEffect(()=>{\n  const source=video.current,target=piano.current")
end = t.index(" },[audioMode,syncOffset,draft]);") + len(" },[audioMode,syncOffset,draft]);")
t = t[:start] + " usePianoSourcePlayer(video,piano,audioMode,syncOffset);" + t[end:]
t = t.replace("import {clampOffsetSeconds,needsPianoResync,pianoTimeFor,shiftOnset} from './piano-playback';",
"import {clampOffsetSeconds,shiftOnset} from './piano-playback';\nimport {usePianoSourcePlayer} from './usePianoSourcePlayer';")
t = t.replace(" const piano=useRef<HTMLAudioElement>(null);\n const lastSync=useRef(0);", " const piano=useRef<HTMLAudioElement>(null);")
p.write_text(t, encoding='utf-8')
print('review refactored')
