from pathlib import Path
p = Path('apps/api/contracts.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    public_poster: Asset | None = None\n    playback: MusicPlaybackSettings | None = None\n    warnings", "    public_poster: Asset | None = None\n    playback: MusicPlaybackSettings | None = None\n    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    warnings")
t = t.replace("    piano_preview: Asset | None = None\n    playback: MusicPlaybackSettings | None = None\n    events", "    piano_preview: Asset | None = None\n    playback: MusicPlaybackSettings | None = None\n    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    events")
p.write_text(t, encoding='utf-8')
print('fields added')
