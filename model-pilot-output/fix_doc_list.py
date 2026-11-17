from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
start=t.index('## Not implemented yet')
t=t[:start]+"""## Not implemented yet

1. The two pages share the clock/mapping helpers and resync rule, but still own separate
   media-element lifecycle code; the plan asks for one extracted controller. Dense-input
   browser playback and a long real upload are not exercised.
2. Pedal spans are preserved in the draft, manifest, preview audio and browser parser, but
   the roll/keyboard do not visualize them.
3. A production Kong worker/profile must be installed and approved before new uploads can
   complete; without it they queue and do not fall back.

Until those are complete, the plan's "done" criteria are not met; the comparison tool and
existing lessons are unchanged.
"""
p.write_text(t, encoding='utf-8')
print('fixed')
