# Kong default playback — implementation status

Independent follow-up: see [fixes and live verification](kong-default-fixes-2026-11-13.md).
The ten review defects and local deployment are addressed. The historical rollout
list below describes the earlier delivery. Edited previews are invalidated safely;
strict 40 ms timing and physical Safari/mobile qualification are not claimed.

Date: 13 November 2026  
Plan: `docs/kong-default-original-piano-playback-plan.md`  
Status: Kong profile, adapter, route and raw completion implemented; Original/Piano
playback with sync offset, loop, speed and pedal spans implemented in review and lesson
pages. Seeded browser acceptance passes for both pages, including negative offsets, note
crossing zero, mid-note switching, loop, speed, leading silence and preview failure. A shared `usePianoSourcePlayer` controller now owns the media lifecycle for both pages;
production worker rollout and dense-input browser coverage remain. **New piano uploads now select the Kong route.**

## Implemented

- **Versioned playback settings** (`MusicPlaybackSettings`): `sync_offset_seconds`
  bounded to ±10 s and `revision`. Added to the draft and lesson-manifest contracts; a
  missing object means zero offset.
- **Piano preview asset**: `piano_preview` on draft and manifest contracts (`audio/wav`),
  the music completion role table (`preview.wav`), route optional assets and file MIME
  map. The draft endpoint validates, copies and stores the asset; review carries it into
  the manifest.
- **Raw-model receipt on the draft**: `raw_model`, `correction_operations` and `playback`
  columns (`0025_music_playback_settings.py`). A Kong-model draft is marked raw and the
  automatic verifier/expression correction block is explicitly skipped for it.
- **Playback API**: `PATCH /api/lessons/{id}/music-draft/playback` is owner-only,
  validates bounds, increments `revision`, and rejects stale revisions with `409`.
  `GET /api/lessons/{id}/music-draft` now exposes `playback`, `raw_model` and
  `correction_operations`.
- **Tests**: `test_music_playback_settings.py` (exposure, optimistic update, bounds);
  existing music draft, conversion, review, worker and contract suites still pass.

## Kong path (implemented this round)

- `music_run_profile.load_kong_profile` verifies the package path, checkpoint, code,
  configuration and commercial evidence, requires 16 kHz mono PCM and freezes the
  profile digest. The worker chooses the Kong loader from `model: "kong"`.
- `scripts/music_kong_adapter.py` runs the pinned Kong inference on CPU/GPU from the
  profile, preserves native offsets and model-estimated velocity in the draft/sidecar,
  and renders a headroom-limited piano preview through the common renderer. A real run on
  the owner clip produced 38 notes, 16.6 s preview, no clipping.
- `music-piano-kong-v1` is now the default route for new piano uploads
  (`music_piano_default_model: kong`); the legacy `music-piano-v1` route stays available
  for old jobs and tests. There is no Basic Pitch fallback.
- The draft completion stores `raw_model`, zero correction operations and the piano
  preview asset; automatic verifier/expression corrections are skipped for Kong drafts.
- Review page: Original/Piano buttons share the video clock, Piano mode mutes the video
  and maps `piano_asset_time = video.currentTime - sync_offset_seconds`; the note roll is
  shifted by the saved offset; the offset control writes through the versioned endpoint.

## Lesson playback (implemented this round)

`MusicLessonHome` now mounts a hidden piano preview element, offers Original/Piano
buttons, uses the video clock as the authority, mutes the video in Piano mode, maps
`piano_time = video.currentTime - sync_offset_seconds` (including the saved lesson offset),
and pauses the piano on video pause/wait/seek. A canvas `PianoNoteRoll` shows the same
detected events shifted by the offset; the existing `PianoGuide` supplies the keyboard.
Review and lesson pages share the same clock/mapping rule and the review page persists
the offset through the optimistic endpoint; finalized manifests carry `playback` and
`piano_preview` through review and sharing.

## Verification

- Full suite: **911 passed, 14 skipped, 0 failed** (8 min 56 s) after regenerating the
  lesson schema artifacts for the new draft/manifest fields.
- Web: **326 tests pass**; TypeScript check and production build pass.
- Seeded Chromium acceptance (`.local/repo-research/kong-review-browser/`): review and
  lesson Original/Piano switching, +120 ms/−200 ms offsets, source-zero mapping, mid-note
  switch, loop, 1.5x speed, leading silence, disabled Piano with a reason when no preview,
  and a dense 1 200-note lesson roll.

## Not implemented yet

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
