# Raw piano model comparison — implementation status

Date: 13 November 2026  
Scope: packages 1–6 plus the real pilot execution  
Status: registry, adapters, jobs, scoring, common render, API records/endpoints and the
comparison page implemented; the three permitted variants ran on both pilot inputs and once
end to end through the HTTP API and browser. See `piano-model-comparison-pilot-2026-11-13.md`.

## Package 1 — registry and rights (`scripts/piano_model_registry.py`)

The registry is the single source of truth for variant identity and permission. It applies
the existing rights manifest to `model_selection` for every variant:

| variant | family | rights | status |
|---|---|---|---|
| `basic-pitch-native` | basic-pitch | approved | ready |
| `basic-pitch-current-app` | basic-pitch | approved | ready |
| `kong-piano` | kong | approved | ready |
| `transkun-v2` | transkun | unresolved | `blocked_license` |
| `onsets-frames-piano` | onsets-frames | prohibited (MAESTRO) | `blocked_license` |

Decisions recorded in the registry:

- The two Basic Pitch variants share the frozen weights SHA-256
  `2c3c1d14…` (cross-checked against `docs/qualification/basic-pitch-profile.json`) but
  declare distinct decoders; `validate()` rejects a shared decoder profile.
- The current-app variant reuses the frozen `piano-peaks-v1` thresholds from
  `docs/qualification/basic-pitch-piano-config.json` with `verification_enabled: false`.
- Kong's checkpoint SHA-256 `c3fa9730…` matches the manifest and the local artifact at
  `.local/piano-diagnosis/reference-packages/piano.pth`.
- A blocked row must carry a non-empty recorded blocker; a runnable row must have an
  approved right and a complete identity. No hash is ever filled in as a placeholder.
- The pilot is **three runnable variants of two families**, with two blocked rows; it is
  not a completed four-family benchmark.

`--verify` checks local artifact files against the pinned digests. Without a local
artifact an approved variant is `identity_unresolved`, never silently ready.

## Package 2 — adapters (`scripts/piano_model_adapters.py`)

Every adapter output is three separate artifacts:

1. `document.json` — canonical `piano-performance-1` with only honestly mapped fields:
   pitch/onset, and MIDI velocity only where the family actually estimates it.
2. `native.json` — `piano-model-native-1` sidecar retaining predicted offsets, amplitude
   proxies and pedal spans with their convention.
3. `receipt.json` — source/prepared hashes, interval, checkpoint, decoder profile, adapter
   code hash, runtime identity, correction flags (`false`), `correction_operations: 0`,
   and output hashes.

Conservation is enforced by `verify_conservation`: event ids, pitches, onsets, velocity
units, predicted offsets and pedal span counts must survive exactly. Basic Pitch amplitude
can never become `velocity_midi`; a predicted offset can never become
`key_release_seconds`; a Kong pedal span becomes a sustain on/off pair with model-estimated
provenance.

Audio preparation is deterministic and recorded: trim to the declared interval, downmix to
mono, `resample_poly` to the adapter rate (22 050 Hz Basic Pitch, 16 000 Hz Kong), 24-bit
WAV, with the conversion rules and source hash stored.

**Integration decision to carry into package 4:** the canonical document's `source.sha256`
is the *prepared* audio the model saw, not the master video audio. The comparison layer
must bind runs through the receipt's `master_sha256` plus prepared hash and interval, and
must not reuse `benchmark_piano_quality.evaluate`'s candidate-to-reference source equality
check unchanged.

## Package 3 — parent/child runs (`scripts/run_piano_comparison.py`)

A parent freezes source hash, interval, requested variants and registry identity; each
child attempt writes into its own `runs/{variant}/attempt-{n}/` directory. Re-execution
creates a new attempt and leaves the previous bytes untouched. Blocked and
identity-unresolved variants are recorded with reasons and never executed. A child is
`ready` only when its receipt proves `correction_enabled: false`,
`expression_correction_enabled: false` and `correction_operations: 0`; otherwise it fails
with the reason. Parent statuses are `complete`, `partial`, `failed` or `blocked` — a
pilot with two blocked licence rows is `partial`, never `complete`.

The default runner executes the adapter CLI in a subprocess with a 900 s timeout, one
child at a time. The module contains no import of the correction pipeline; a test asserts
this statically.

## Package 4 — scoring and comparison aggregate (`scripts/compare_piano_models.py`)

Every run is validated against its receipt (document hash, prepared-audio source,
master source, interval, bypass) before scoring. Each attribute becomes a cell with a
value and a state from `measured`, `diagnostic_only`, `reference_unavailable`,
`not_estimated`, `unsupported_semantics`, `partial`, `failed`, `blocked_license`,
`not_run`. Capability gaps outrank reference gaps: Basic Pitch amplitude is
`not_estimated` velocity, never a zero error. Unverified alignment keeps the values but
marks correctness/timing `diagnostic_only`. Blocked variants appear in every row with
their recorded blockers. The table covers detected notes, correctness, fine timing,
physical release, audible ending, MIDI velocity, relative dynamics (rank proxy), pedal,
written rhythm, audio diagnostics (normalized and fixed-gain, from the common preview),
stereo/room (explicit no-claim from a mono preview), human similarity (no listener data)
and practicality. No overall score, winner, `improvement_established` or activation field
is emitted.

## Package 5 — common render (`scripts/render_piano_comparison.py`)

Both preview modes share one renderer, sample rate (22 050 Hz), channel layout, tail,
gain and headroom policy (0 dB gain, **-24 dB pre-saturation headroom**, no
normalization). `as_transcribed` uses each note's declared native offset as a render
duration (labelled `legacy-not-release`, with the offset convention and sidecar SHA-256 in
the manifest; never physical release) and maps Basic Pitch amplitude to an uncalibrated
`render_intensity`. `notes_only` fixes intensity 0.6, duration 0.5 s, removes pedal and
ignores the sidecar. Every note is resolved and counted before synthesis; a renderer that
drops notes is refused. Peak, RMS, clipping, identity, control support, release sources,
mapping and warnings are recorded per file. A combined `preview_identity` binds the
renderer identity, the native sidecar hash, the mapping and the headroom policy. The
1 001-note test confirms no silent cap, and dense previews plus all pilot previews are
verified clipping-free.

## Package 6 — owner-only records, endpoints and page

Database (`apps/api/database.py`):

- `piano_comparison_sources`: a registered master audio file, its SHA-256, duration, optional
  reference path and linked lesson. Registration is a developer/owner CLI action
  (`scripts/register_piano_comparison_source.py`); the browser never supplies a path.
- `piano_comparisons`: owner, source, interval, requested variants, registry identity,
  status, cancel flag and cached result.
- `piano_model_runs`: one row per requested variant with status, attempt, lease token, run
  directory, receipt and blocked reasons. `(comparison_id, variant)` is unique.

Endpoints (`apps/api/piano_comparisons.py`), all owner-only and CSRF-protected by the
existing middleware:

- `GET /api/piano-comparisons/sources` — registered sources for this owner.
- `POST /api/piano-comparisons/sources` — owner-checked action that freezes the linked
  lesson's retained source media (ffmpeg to PCM when needed) and registers it; the browser
  supplies only a lesson id.
- `POST /api/piano-comparisons` — start a comparison for a source id and variant ids.
- `GET /api/piano-comparisons/{id}` — progress and per-run states.
- `GET /api/piano-comparisons/{id}/results` — comparison aggregate computed from the
  immutable run receipts and documents.
- `GET /api/piano-comparisons/{id}/runs/{variant}/assets/{asset}` — allowlisted artifacts
  (`document.json`, `native.json`, `receipt.json`, `semantics.json`, `prepared.wav`,
  `preview.wav`, `preview-notes.wav`, `preview.json`).
- `GET /api/piano-comparisons/{id}/source` — owner-only source audio for the Original button.
- `POST .../retry` — new attempt for a failed or cancelled run.
- `POST .../cancel` — cancel queued children; a running subprocess finishes under its
  timeout (documented limitation of the development executor).

Execution runs one child at a time under a process lock, through the same pinned
per-family interpreters and adapter CLI as the pilot. After a successful adapter run the
executor renders both common previews from the frozen document and records the preview
manifest hash, gain and clipping in the child receipt; a child is not `ready` until its
playable preview exists. Comparison jobs never import the correction pipeline, never
accept commands or paths from the browser, and never write a lesson document. A blocked
variant is created as `blocked_license` and is never executed.

Frontend (`apps/web/src/music/PianoModelComparison.tsx`): owner-only page reachable from
the piano review page's "Compare AI models" action (`?page=music-comparison&id=…`). It
provides registered-source selection, variant selection, progress polling, one shared
audio element for Original / model previews / notes-only mode, preserved seek and loop,
a synchronized canvas note roll, run-state list with retry/cancel, and the attribute table
with explicit states. No editing, no "apply winner", and no automatic lesson mutation.

## Verification

- `tests/api/test_piano_model_registry.py`: 14 passed.
- `tests/api/test_piano_model_adapters.py`: 17 passed.
- `tests/api/test_run_piano_comparison.py`: 15 passed.
- `tests/api/test_compare_piano_models.py`: 18 passed.
- `tests/api/test_render_piano_comparison.py`: 11 passed.
- `tests/api/test_piano_comparisons.py`: 14 passed (owner isolation, blocked rows, assets,
  retry, cancel, results gating, lesson immutability, source scoping, preview-before-ready,
  retained-source registration).
- Web: `tsc --noEmit` passes and `vite build` emits `PianoModelComparison-*.js`.

Full suite (13 November, after the live-review preview fixes): **915 collected,
901 passed, 14 skipped, 0 failed** (9 min 44 s), with
`PYTHONPATH=.venv-music/Lib/site-packages`.

**Browser acceptance (13 November):** `model-pilot-output/browser_acceptance.py` starts the
real API on a temporary database, registers the owner's extracted audio, runs the three
permitted adapters through the HTTP flow, and drives the built page with Chromium. It
verified: three `ready` rows and two `blocked_license` rows; disabled blocked controls; a
single audio element switching from Kong to Basic Pitch native with the position preserved
at 5 s; each model's preview loading with a real duration; and the results table showing
`no reference`/`not estimated`/`blocked by licence` rather than zeros. A follow-up page
check against the frozen run confirmed all 13 attribute rows, and the re-run after the
preview-fidelity fixes asserted that native offsets reach the manifest, the preview is not
clipped, and the note roll states that lengths are predicted offsets. Screenshots:
`model-pilot-output/browser/comparison.png`, `results.png`, `results-complete.png`
(archived under `.local/repo-research/model-pilot/browser/`).

## Next

The initial pilot is complete and verified through both the CLI/job layer and the HTTP
API/browser. Remaining work is deliberately outside this pilot: the two blocked checkpoint
permissions, the four-family comparison they would enable, real listener ratings, and a
production-grade leased worker (the development executor uses a process lock and finishes
an in-flight subprocess before honouring cancellation). A source-video panel and keyboard
view are also not part of this page revision; the shared transport, note roll, previews and
results table are.

