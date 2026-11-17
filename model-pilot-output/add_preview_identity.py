from pathlib import Path
p = Path('apps/api/contracts.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    warnings", "    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    preview_identity: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')\n    warnings")
t = t.replace("    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    events", "    pedal: list[MusicPedalEvent] = Field(default_factory=list, max_length=2000)\n    preview_identity: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')\n    events")
p.write_text(t, encoding='utf-8')
print('contracts')
