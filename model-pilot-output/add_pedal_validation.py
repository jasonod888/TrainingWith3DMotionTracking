from pathlib import Path
p = Path('apps/api/contracts.py')
t = p.read_text(encoding='utf-8')
t = t.replace("        if self.piano_preview and self.piano_preview.mime != 'audio/wav':\n            raise ValueError('A piano preview must be a WAV asset.')",
"        if self.piano_preview and self.piano_preview.mime != 'audio/wav':\n            raise ValueError('A piano preview must be a WAV asset.')\n        for span in self.pedal:\n            if span.offset <= span.onset or span.offset > self.duration + 1e-6:\n                raise ValueError('A pedal span must stay inside the clip.')")
p.write_text(t, encoding='utf-8')
print('validated')
