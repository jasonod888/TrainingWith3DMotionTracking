from pathlib import Path
p = Path('apps/api/music_review.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            'guitar_chords':[chord.model_dump() for chord in proposal.guitar_chords],\n            'provenance':proposal.provenance.model_dump(),",
"            'guitar_chords':[chord.model_dump() for chord in proposal.guitar_chords],\n            'pedal':[span.model_dump() for span in proposal.pedal],\n            'provenance':proposal.provenance.model_dump(),")
t = t.replace("            piano_preview=proposal.piano_preview,\n            playback=proposal.playback or MusicPlaybackSettings(),",
"            piano_preview=proposal.piano_preview,\n            playback=proposal.playback or MusicPlaybackSettings(),\n            pedal=proposal.pedal,")
p.write_text(t, encoding='utf-8')
print('review patched')
