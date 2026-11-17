# Phase 7 V1–V4 follow-up review — CHANGES REQUIRED

Reviewed 14 November 2026. Commit `0fcc8e92c5ea568d5077fa47275268c9a23621bf`, branch `phase7/normal-route`.

**Phase 7 is still not accepted; Phase 8 remains stopped.** The original verification failures are fixed on their tested paths, and the revision loader is now genuinely improved. Two destructive decision-reversal cases remain, alongside the disclosed qualification gaps.

## Independent evidence

| Check | Result |
| --- | --- |
| Original controlled verification checks | 3/3 pass: stale acceptance preserves local pitch, simple Accept/Reject returns pitch, merge count 20 -> 19 |
| Settings recovery/map checks | 2/2 pass |
| TypeScript | Clean, exit 0 |
| New verification transition checks | **0/2 pass**, normal browser-run exit 1 |
| Full 471-test web suite, full normal-route/revision and Phase 6 scripts | Developer-reported this review, not independently rerun |

The checks use installed Chrome, controlled API responses, real workspace/parser/command code and tracked fixture events. They do not mutate actual lessons or exercise a live server.

New reproducer: `docs/qualification/piano-workspace-phase-07-review/check-verification-transitions.py`.
Output: `verification-transition-results.json` alongside it.
Run with `.venv-saas/Scripts/python.exe` from repository root and Vite on 127.0.0.1:5173. It reuses the controlled fixture definitions from the existing `check-verification.py`; it does not change its three assertions.

## T1 — Reject still overwrites edits made after acceptance (high)

Browser reproduction:

1. Accept the proposed pitch change 60 -> 62.
2. Manually change that attack to 63.
3. Reject the previously accepted finding.

Expected: preserve 63 and report the conflicting reversal. Actual: **63 -> 60**, losing the manual correction.

`findingMatches(..., invert=true)` checks only that set_pitch/set_onset target IDs still exist. It does not check that their accepted after-values remain unchanged. Merge/split/add reversal guards similarly check presence instead of the relevant accepted state. This is not the guarded inverse described in the handoff.

Required: validate reversal preconditions against the accepted after-state before committing, and again after the asynchronous decision response. If a relevant field or structure changed, preserve the local document and expose explicit reconciliation. Unrelated edits should remain compatible. Cover pitch, onset, added/merged/split-note edits, deletion/restoration, and response-time races. A server-side decision update must not silently authorize a destructive local revert.

## T2 — Accept/Reject loses authored notation (high)

Browser reproduction:

1. Respell the fixture's MIDI-60 note as **B#3**.
2. Accept a pitch suggestion to 62.
3. Reject it.

Expected: restore MIDI 60 with the authored spelling **B#3**. Actual: MIDI 60 returns as **C4**. The original spelling is lost.

The inverse translator reconstructs commands from performance-only proposal snapshots; those snapshots do not contain authored spelling, written duration, voice placement or logical-note structure. Reinserted notes can likewise lose metadata. A safe performance inverse is not automatically a safe authored-document inverse.

Required: retain a guarded reversible transaction/patch for the actual authored changes, preserving unrelated later work. Restore original notation/IDs/metadata when reversal is safe. If the required baseline is unavailable (for example an older accepted decision loaded from the server), report that limit and offer a controlled reconciliation path rather than guessing notation. Cover authored spelling, independent written/recorded duration, voices/ties and exact note identity through accept, reject, musical undo/redo, recovery and save/reopen.

Also verify nullable/zero velocities: the new translator replaces null with 0.7 and uses `velocity || 0.7` for merges, which converts a valid zero to 0.7. Do not claim full metadata parity with server edits until those cases are tested and handled explicitly.

## Revision integration: progress and remaining evidence

Confirmed in code: MusicLessonEditor now returns after the piano manifest before the legacy reference parsing/notation build. The refreshed manifest is awaited and the live dirty ref is checked before the app callback. These are the previously missing changes.

The new direct `music-edit?id=` test is useful revision-route coverage, and the reported exact base_revision_id/reopen evidence should be retained. It still bypasses the library card action. Complete the card click as required; direct entry cannot establish action availability/ownership/routing from the library. Include edits during POST and during manifest refresh rather than only an immediate successful save.

Guitar regression must cover reviewed revisions too: the legacy editor is now guitar-only, but its MIDI-note-assessment radio was changed from disabled for non-piano to `disabled={busy}`. Restore the prior guitar restriction unless a guitar assessment feature is explicitly authorized and qualified. Existing draft-guitar DOM-presence checks do not cover this revision control.

## Loaded-video test investigation

The retained scratch `.local/phase7d/video_test.py` explains a likely reason the prior video test never mounted a video: its test world copies the saved manifest/reference from the earlier save (whose source_video is null), then adds a video only to `world.draft`. The workspace correctly prefers the saved reference/manifest, so that draft-only video is not used. This is a fixture-selection diagnosis from the script, not a completed playback test or proof of a product video defect.

Put the valid video asset on the **saved manifest** for a saved-reference scenario, or use a fresh draft-only world with no saved manifest. Serve its matching asset route and use consistent clip timing. The referenced `fixtures/clip.mp4` is not currently present, so restore/generate a reproducible fixture as part of the test rather than dropping the scenario.

Then qualify metadata/readyState, play/pause, seek, rate/end, video-derived cursor agreement and header overlap while scrolling on the normal page. Physical touch is not needed for this desktop-browser test. Keep physical-device qualification separately BLOCKED until hardware is available.

## Resubmission

Fix T1/T2 and protect the existing guitar revision capability; retain the passing original 3+2 checks and add the two transition checks with their assertions intact. Complete the actual library revision entry and desktop loaded-video checks, including delayed-save/refresh evidence. Report physical touch as the remaining hardware gate only after those software and evidence items are complete. No library pivot, architectural restart or release is requested.

No product code, Git branch, commit, publication or real server data was changed during this review.
