from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace("A\nsingle extracted media controller and production worker rollout remain.",
"A shared `usePianoSourcePlayer` controller now owns the media lifecycle for both pages;\nproduction worker rollout and dense-input browser coverage remain.")
t = t.replace("1. The two pages share the clock/mapping helpers and resync rule, but still own separate\n   media-element lifecycle code; the plan asks for one extracted controller. Dense-input\n   browser playback and a long real upload are not exercised.",
"1. Both pages now use the shared `usePianoSourcePlayer` controller; a dense-input browser\n   run and a long real upload are still not exercised.")
t = t.replace("2. Pedal spans are preserved in the draft, manifest, preview audio and browser parser, but\n   the roll/keyboard do not visualize them.",
"2. Pedal spans are preserved in the draft, manifest, preview audio and browser parser, but\n   the roll/keyboard do not visualize them. Preview identity is recorded in the renderer\n   manifest; it is not yet copied onto the lesson asset record.")
p.write_text(t, encoding='utf-8')
print('ok')
