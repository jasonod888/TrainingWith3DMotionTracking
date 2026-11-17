from pathlib import Path
p = Path('packages/lesson-schema/index.ts')
t = p.read_text(encoding='utf-8')
t = t.replace("pedal?:MusicPedalSpan[];raw_model?:boolean", "pedal?:MusicPedalSpan[];preview_identity?:string|null;raw_model?:boolean")
t = t.replace("  pedal?: MusicPedalSpan[];\n  waveform", "  pedal?: MusicPedalSpan[];\n  preview_identity?: string | null;\n  waveform")
p.write_text(t, encoding='utf-8')
print('types')
