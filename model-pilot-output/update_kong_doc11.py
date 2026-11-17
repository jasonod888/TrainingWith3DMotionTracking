from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
start=t.index('## Not implemented yet')
t=t[:start]+"""## Not implemented yet

1. A production Kong worker/profile must be installed and approved, and the worker started
   with `--pipeline music-piano-kong-v1`; without it new uploads queue and never fall back
   to Basic Pitch.
2. Pedal spans are preserved in the draft, manifest, preview audio and browser parser, but
   the roll/keyboard do not visualize pedal state.
3. Measured platform drift behavior is not recorded beyond the automated hysteresis test.

Everything else in the plan's implementation scope is present: Kong profile/route/adapter,
raw completion receipt, native offsets/velocity/pedal, preview identity and headroom,
versioned sync settings, the shared `usePianoSourcePlayer` controller on both pages, and the
seeded browser matrix (offsets, leading silence, zero crossing, mid-note, loop, speed,
dense 1200-note input, preview failure, permissions).
"""
p.write_text(t, encoding='utf-8')
print('ok')
