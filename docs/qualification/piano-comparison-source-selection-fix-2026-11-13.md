# Correct uploaded-recording selection for piano comparisons

## Confirmed failure

The screenshot's comparison `32409e89fd674017b5e3cb7873d18671` used
`piano-vienna-public`, a 128.199274-second Chopin benchmark. It was not the owner's
new 209.594-second River Flows upload. Its backend runs had completed when inspected;
the screenshot captured the earlier running state.

The new upload `0df28929d427406cb86d9bb5e2dcd35b`, titled
`river flows_full version`, had already reached `ready_for_review` successfully.

## Causes and changes

- The frontend preferred a source linked to the lesson, but otherwise silently selected
  `sources[0]`. That happened to be the public benchmark. It now automatically registers
  the linked lesson when needed and never silently selects an unrelated recording.
  Without lesson context, the owner must explicitly choose a recording.
- Registration read only the reviewed revision's source. A newly uploaded piano video's
  source is held in its unreviewed `MusicDraft`; registration now uses that draft source
  when appropriate, before falling back to a revision's retained source.
- Registration deduplication previously used owner/audio hash alone. It is now scoped
  to the lesson as well, preserving the correct lesson link and title even when two
  lessons contain identical audio.
- Start remains disabled while source preparation is incomplete; a failed registration
  shows an error rather than substituting a benchmark.
- The comparison header displays the actual selected recording name and duration.
- The comparison URL retains the linked lesson across refresh/back navigation. Starting
  a new comparison clears the old comparison ID and playback state.

Native model output and correction policies were not changed. Existing mistaken
comparisons were retained as their actual benchmark runs, not relabelled as River Flows.

## Completed correct comparison

- Lesson: `0df28929d427406cb86d9bb5e2dcd35b`.
- Source: `4ca9dd017ed44039a2c8b1e2c1f8b080`.
- Comparison: `206116d379b5462b8355895a386a6cc6`.
- Original audio duration: 209.6 seconds, corresponding to the full uploaded recording.
- Both Basic Pitch variants and Kong completed; all default previews are clipping-free.
- Transkun and Onsets and Frames remain explicitly blocked.

URL: `http://127.0.0.1:5173/?page=music-comparison&id=206116d379b5462b8355895a386a6cc6&lesson=0df28929d427406cb86d9bb5e2dcd35b`.

## Verification

- 15 comparison API tests passed, including newly uploaded draft sources and
  cross-lesson identical-audio isolation.
- Four actual-component browser regressions passed: automatic registration, an existing
  linked source, failed registration without fallback, and explicit general selection.
- All 320 existing web tests and the TypeScript/Vite production build passed.
- Live browser followed the real review-to-comparison flow, checked correct selection,
  refreshed before starting, started the comparison, played the 209.6-second original,
  and verified source/lesson IDs returned by the API.
- After completion, a separate browser check verified all three model buttons load
  full-length audio, the header names the correct recording, all 13 attribute rows appear,
  and correctness remains "no reference" rather than inheriting the public MIDI scores.

Receipts/screenshots are in `.local/piano-comparison-source-fix/`. Tests are reproducible
with `scripts/verify_piano_comparison_source.py` against the local Vite server. No full
repository-suite result is claimed for this change.
