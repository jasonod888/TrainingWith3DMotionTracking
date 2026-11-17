from pathlib import Path
p = Path('packages/lesson-schema/index.ts')
t = p.read_text(encoding='utf-8')
t = t.replace("export type MusicPlaybackSettings={sync_offset_seconds:number;revision:number};",
"export type MusicPlaybackSettings={sync_offset_seconds:number;revision:number};\nexport type MusicPedalSpan={onset:number;offset:number;type:'sustain'};")
t = t.replace(" piano_preview?:Asset|null;playback?:MusicPlaybackSettings;raw_model?:boolean;correction_operations?:number;",
" piano_preview?:Asset|null;playback?:MusicPlaybackSettings;pedal?:MusicPedalSpan[];raw_model?:boolean;correction_operations?:number;")
t = t.replace("  piano_preview?: Asset | null;\n  playback?: MusicPlaybackSettings;",
"  piano_preview?: Asset | null;\n  playback?: MusicPlaybackSettings;\n  pedal?: MusicPedalSpan[];")
p.write_text(t, encoding='utf-8')
print('types patched')
