# Multi-discipline Phase 3: preparation

Started 5 November 2026. **Preparation only; music uploads and both music processing
routes remain disabled.** The movement creation path has not changed. No model or
runtime dependency was added in this slice.

## First audio-preparation evidence

`scripts/verify_music_preparation.py` exercises the existing development-only harness
at `/spike/music-prepare.html`. It generates its own six-second colour video with a
440 Hz tone using ffmpeg, selects seconds 1–4, and inspects the prepared stream facts.
It then repeats with a source containing no audio. No account, worker, transcription,
user media, or upload is involved. The script asserts no API requests or page errors.

Environment: Windows, Playwright headless Chromium **156.0.8078.4**, installed
mediabunny **1.65.0**, 48 kHz mono synthetic source. This is not qualification of
installed desktop Chrome/Edge, Safari, phones or tablets.

| Candidate | Output | Audio | Audio/video first-timestamp difference | Result |
| --- | --- | --- | --- | --- |
| MP4 AVC/AAC | 3.01 s; approximately 74 KiB | AAC, 48 kHz, mono | 0 ms | Stream-fact checks passed |
| WebM VP8/Opus | 3.01 s; approximately 53 KiB | Opus, 48 kHz, mono | 7 ms | Stream-fact checks passed |
| MP4 AVC/AAC from silent source | 3.00 s | No audio track | Unavailable | Correctly failed harness validation |

The silent-source result means the **harness rejects the candidate**, not that a
production music upload validator exists. It does not identify acoustic silence in
an existing audio track. No production preparation path is selected by this run.

Run with the Vite development server and Python Playwright available:

```powershell
$env:PRACTICE_TEST_URL='http://127.0.0.1:5196'
.venv-saas/Scripts/python.exe scripts/verify_music_preparation.py
```

The detailed report is generated at `test-results/music-prepare-chromium.json`.
Generated media and reports stay in the ignored test-results directory.

## Next implementation order

1. P3.1: add the server-driven subject choice before preparation, preserving the default
   movement flow. For adjustments, retain the lesson's subject. Keep music choices
   disabled until their complete route is qualified; a route flag alone must not make
   an unfinished music uploader available.
2. P3.2/P3.3: implement an isolated music preparation module and a recoverable export
   path. Verify absolute timestamp origins, decoded audio, audibility, cancellation,
   size/duration bounds and representative long clips. Complete target-browser/device
   coverage before selecting and enabling a production path. Keep `prepareClip.ts`
   unchanged for movement.
3. P3.4/P3.5: bind resume metadata to the exact prepared artifact and validate decodable
   video plus usable audio on the server. Reject absent audio before queuing a music job.
4. P3.6 onward: isolated music worker, commercial artifact inventory, attempt-bound
   completion, cancellation and cleanup. Retain existing account limits and separate
   movement capacity. No transcription dependency is installed in this preparation slice.

PostgreSQL migrations 0015/0016 still need a disposable database with legacy rows before
deployment. The audio browser/device matrix remains open before enabling music uploads.

## Implementation slice: creation, isolated preparation, upload identity, audio validation

5 November 2026. Music routes remain **disabled**; this slice builds the movement-free
parts of the music path and cannot be reached by a learner by default.

- **P3.1 subject choice.** `CreateLesson` reads `/conversions/limits` for the subject
  catalogue and per-capability availability. The selector sits before the file picker.
  Movement stays the default, a replacement keeps the movement subject, and piano/guitar
  options are disabled with "(not available yet)" unless that capability is enabled.
  A blocked music subject disables submission, and the movement text and button labels
  are unchanged in the movement path.
- **P3.2/P3.3 isolated preparation.** New `prepareAudioClip.ts` keeps audio and is used
  only for a music subject; `prepareClip.ts` is untouched for movement. It prefers MP4
  AVC/AAC and falls back to WebM VP8/Opus when the encoder pair exists, then re-reads the
  prepared file and refuses it unless both a video and an audio track are present and the
  duration matches the selection. It never uploads the original file. If no encoder pair
  exists, it raises a recoverable message that asks for an exported clip with sound.
- **P3.4 resumable-upload identity.** Creation records subject, instrument and
  preparation provenance (version plus selection offsets). The local clip cache stores
  the same subject/instrument/preparation version; resuming refuses a cached artifact
  prepared for a different lesson type, in addition to the existing filename, size and
  part-hash checks.
- **P3.5 server audio validation.** `apps/api/media_probe.py` inspects the uploaded file
  with ffprobe and decodes a bounded window with ffmpeg. Completion of a music job now
  requires a video track and an audio track; a missing/unreadable audio track fails the
  job as `invalid_audio` (non-retryable) and deletes the uploaded source before queueing.
  Findings record codecs, sample rate, channels, duration and maximum volume, including
  `silent_audio` and `clipping_audio`. Movement completion is unchanged and keeps empty
  findings. Migration `0017_media_findings.py` adds the additive column.

Verification for this slice:

| Check | Result |
| --- | --- |
| Web tests | **244 passed** (+5 preparation-policy) |
| TypeScript / production build | Clean |
| API media validation | **4 passed**: audio queued with measured facts, no-audio rejected as `invalid_audio` with the source removed, silence recorded as a finding, movement unchanged |
| Migration rendering | `alembic upgrade head --sql` renders 0017 |
| Full API suite | **267 passed, 13 skipped** |
| Subject selection browser check | **Passed**: choice before preparation, movement default, music options disabled with an explanation |
| Music uploads end to end | **Not possible by design**: music routes are disabled and no worker exists |

Still open: selecting and qualifying the production preparation path, the target
browser/device matrix, an isolated music worker, transcription, attempt-bound completion,
cancellation/cleanup, and PostgreSQL verification with legacy rows.
