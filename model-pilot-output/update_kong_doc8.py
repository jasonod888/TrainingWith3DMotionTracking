from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace("Lesson page: Piano is selected, the video is muted, the keyboard and note roll render, and\nthe same 2.0 s seek maps the piano to 1.88 s. Screenshots (`review.png`, `lesson.png`) and\nseed artifacts are under `.local/repo-research/kong-review-browser/`.",
"Lesson page: Piano is selected, the video is muted, the keyboard and note roll render, and\nthe same 2.0 s seek maps the piano to 1.88 s. The matrix also covers a negative offset\n(-200 ms) with source-zero mapping, a mid-note Original-to-Piano switch, playback rate\n1.5x mirrored to the piano, and a 1-2 s loop wrapping back to the start. Screenshots\n(`review.png`, `lesson.png`) and seed artifacts are under\n`.local/repo-research/kong-review-browser/`.")
t = t.replace("1. Remaining browser matrix: leading silence, negative offset with a note crossing zero,\n   mid-note switching, loop, speed, dense input, preview failure and permissions.\n   Review and lesson playback, +120 ms mapping and deterministic clock mapping are covered.",
"1. Remaining browser matrix: an explicit leading-silence assertion and the\n   preview-failure UI state. Negative offsets, mid-note switching, loop, speed and\n   permissions are covered; dense input and staleness have unit/API tests.")
p.write_text(t, encoding='utf-8')
print('ok')
