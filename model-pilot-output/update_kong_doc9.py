from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace("Status: Kong profile, adapter, route and default selection implemented; Original/Piano\nplayback with sync offset implemented in review and finalized lesson pages. Review-page\nbrowser acceptance passes; lesson-page browser acceptance, pedal representation and drift\nhysteresis remain.",
"Status: Kong profile, adapter, route and raw completion implemented; Original/Piano\nplayback with sync offset, loop, speed and pedal spans implemented in review and lesson\npages. Seeded browser acceptance passes for both pages, including negative offsets, note\ncrossing zero, mid-note switching, loop, speed, leading silence and preview failure. A\nsingle extracted media controller and production worker rollout remain.")
t = t.replace("3. Pedal predictions are not represented in the lesson contract; the Kong draft records\n   this as a warning.\n", "")
t = t.replace("1. Remaining browser matrix: an explicit leading-silence assertion and the\n   preview-failure UI state. Negative offsets, mid-note switching, loop, speed and\n   permissions are covered; dense input and staleness have unit/API tests.",
"1. The two pages share the clock/mapping helpers but still own separate media-element\n   lifecycle code; the plan asks for one extracted controller. Dense-input browser\n   playback and a long real upload are not exercised.\n2. Pedal spans are preserved in the draft, manifest and preview audio, but the roll/keyboard\n   do not visualize them.")
t = t.replace("3. A production Kong worker/profile must be installed and approved before new uploads can\n   complete; without it they queue and do not fall back.",
"3. A production Kong worker/profile must be installed and approved before new uploads can\n   complete; without it they queue and do not fall back.")
p.write_text(t, encoding='utf-8')
print('updated')
