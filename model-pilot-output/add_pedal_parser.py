from pathlib import Path
p = Path('packages/lesson-schema/parse.ts')
t = p.read_text(encoding='utf-8')
t = t.replace("function readPlayback(value: unknown)", """function readPedal(value: unknown): {onset:number;offset:number;type:'sustain'}[] | null | undefined {
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||value.length>2000)return null;
 const spans:{onset:number;offset:number;type:'sustain'}[]=[];
 for(const span of value){
  if(!isRecord(span)||Object.keys(span).some(key=>!['onset','offset','type'].includes(key)))return null;
  if(!isNumber(span.onset)||!isNumber(span.offset)||span.onset<0||span.offset<=span.onset)return null;
  if(span.type!=='sustain')return null;
  spans.push({onset:span.onset,offset:span.offset,type:'sustain'});
 }
 return spans;
}

function readPlayback(value: unknown)""")
t = t.replace("  'source_video', 'preview_video', 'piano_preview', 'playback', 'waveform', 'midi_export', 'public_poster', 'warnings',",
"  'source_video', 'preview_video', 'piano_preview', 'playback', 'pedal', 'waveform', 'midi_export', 'public_poster', 'warnings',")
t = t.replace("  const playback = readPlayback(value.playback);\n  const waveform", "  const playback = readPlayback(value.playback);\n  const pedal = readPedal(value.pedal);\n  const waveform")
t = t.replace("      || playback === null || waveform === undefined", "      || playback === null || pedal === null || waveform === undefined")
t = t.replace("      ...(playback ? {playback} : {}),\n      waveform", "      ...(playback ? {playback} : {}),\n      ...(pedal ? {pedal} : {}),\n      waveform")
t = t.replace("'source_video','piano_preview','playback','raw_model'", "'source_video','piano_preview','playback','pedal','raw_model'")
t = t.replace("pianoPreview===undefined||pianoPreview&&pianoPreview.mime!=='audio/wav'||playback===null)return bad();", "pianoPreview===undefined||pianoPreview&&pianoPreview.mime!=='audio/wav'||playback===null||readPedal(value.pedal)===null)return bad();")
t = t.replace(" ...(playback?{playback}:{}),...(value.raw_model!==undefined", " ...(playback?{playback}:{}),...(readPedal(value.pedal)?{pedal:readPedal(value.pedal)}:{}),...(value.raw_model!==undefined")
p.write_text(t, encoding='utf-8')
print('parser patched')
