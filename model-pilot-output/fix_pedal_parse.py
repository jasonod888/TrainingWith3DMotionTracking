from pathlib import Path
p = Path('packages/lesson-schema/parse.ts')
t = p.read_text(encoding='utf-8')
t = t.replace(" const playback=readPlayback(value.playback);\n if(!instrument", " const playback=readPlayback(value.playback),pedal=readPedal(value.pedal);\n if(!instrument")
t = t.replace("||playback===null||readPedal(value.pedal)===null)return bad();", "||playback===null||pedal===null)return bad();")
t = t.replace("...(readPedal(value.pedal)?{pedal:readPedal(value.pedal)}:{})", "...(pedal?{pedal}:{})")
p.write_text(t, encoding='utf-8')
print('fixed')
