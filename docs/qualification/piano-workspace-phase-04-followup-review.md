# Piano correction workspace — Phase 4 follow-up review

Reviewed: 14 November 2026.
Submission: `bc7e98c49b54cee010b6dfe3d6837de2eb751cba`.
Decision: **CHANGES REQUIRED. Phase 5 remains blocked.**

The shared score-time construction, strict map validation, trailing-hold inverse, frame-clock store and session-local anchor controls are substantial corrections. This review does not request persistence or a page replacement. Two reproduced audio integration failures still prevent accepting the claim that all six items are complete; the timing evidence also needs correction.

## Independent verification

- Full web suite: **431 passed, 0 failed**.
- TypeScript: **passed**.
- Production build: **passed**, including the harness entry.
- Original reviewer reproducer: **5/5 passed**.
- New service-free actual-harness audio probes: **0/2 passed**; both fail on this submission as described below.
- Inspected alignment/score construction, clock subscriptions, anchor controls, source hook/controller and verification hook, existing tests, and submitted capture-script assertions.
- Did not rerun authenticated browser captures. The reported 14.3 ms result remains developer-supplied measurement, not an independently repeated browser measurement.
- No product code, service data or authentication state changed. Only this review and its reproducer were added.

## F1 — The harness bypasses verified-preview loading (high; R5)

`PianoWorkspaceHarness.tsx` assigns `previewUrl = assetUrl(draft.piano_preview.key)` and feeds that URL directly to `<audio>`. The Piano button is enabled solely by the presence of this URL. The existing `usePianoPreviewAsset` hook, which verifies byte length and SHA-256 before exposing a blob URL, is never used here. `parseMusicDraftView` validates the shape of the metadata, not the fetched audio bytes. Passing `preview_identity` to the source controller does not verify those bytes either.

Actual harness probe: supply a schema-valid draft advertising a three-byte WAV with an incorrect SHA-256. Piano becomes enabled, the audio src is `/api/lessons/fixture/assets/preview.wav`, and **zero verification fetches** occur. The UI's claim that this is a verified preview is therefore unsupported.

Required: use the existing verification pathway (or demonstrate an equivalent integration), keep Piano disabled while pending or failed, surface the failure honestly and retain Original audio. Add actual-harness integration coverage for a valid asset, mismatched hash/size, and unavailable asset. Cover the supported Piano path under play/pause/seek/rate, offsets and mode changes; existing controller-only tests do not prove the harness wiring. No real-draft preview or backend change is necessary: a controlled asset fixture is sufficient.

## F2 — Original-only playback does not stop audition (high; R5)

The audition-stop effect depends on `player.playing` from `usePianoSourcePlayer`. That hook returns without creating a controller when either media ref is absent. For the real draft, there is no preview, hence no `<audio>` and no controller. Its `playing` state stays false even while the video plays. The harness's own source-derived `playing` state changes, but that state is not used by the audition-stop effect.

Actual harness probe: load a source-video draft with no Piano preview, select a roll note, click Audition, then start the video. The source enters playback, but `NotationAudio.stop()` calls remain **0**. This is the common Original-only case, not merely an unavailable optional feature.

Required: stop audition from source playback events/state independently of optional Piano availability. Cover both source modes and the no-preview case with an actual-harness test, plus mode changes and unmount. Ensure a source play transition cannot leave audition sounding over it.

## F3 — Correct and complete the rendered timing evidence (R6)

The frame-clock implementation removes the deliberate 50 ms visual throttle. However, the submitted script does not establish several claims made in the handoff:

- Its arpeggio fixture attacks are **2.000, 2.045 and 2.090 s**, separated by **45 ms**, not 12 ms. A 2 ms sampling step is not a 12 ms attack spacing.
- The scripted clock is set, then the test waits 40 ms before reading the DOM. This checks settled activation, not consecutive rendered frames under a progressing source clock.
- `identities = all(item['active_keys'] >= 0 ...)` is a vacuous identity check. Silent-state counts alone do not establish that the correct occurrences light in all views. Score segment counts may differ legitimately; compare unique occurrence mappings rather than raw notehead totals.
- The script samples normal playback and one offset but does not exercise a playback-rate change. It accepts 1.5 hard-coded 60 Hz frames rather than enforcing the agreed one-displayed-frame target or documenting a reviewed measurement tolerance.

Required: supply controlled rendered tests with genuinely 12 ms-separated attacks, live clock advancement, start/end boundaries, positive/negative offsets and keyboard/roll/score occurrence identities. Add source seek and rate-change measurements, including the nonzero viewport. Use the agreed frame target with explicit sampling tolerance, and correct claims to match exactly what the evidence demonstrates. It is acceptable that a note wholly between display frames cannot appear; an additional artificial throttle or wrong occurrence is not acceptable.

## Reproducer and next submission

Run from the repository root:

```powershell
node --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-04-followup-repro.ts
```

This uses the actual harness, parser and a tracked synthetic draft, mocks media events and audition methods, and performs no service requests or writes. It exits nonzero on the two unmet audio expectations. It is a diagnostic, not a replacement for the full integration acceptance matrix.

Continue the already authorised Phase 4 corrections, update the handoff and evidence, and resubmit. Keep Phase 5 stopped. Stale-preview invalidation after musical edits remains part of the existing Phase 5 gate; this review does not move that later requirement forward.
