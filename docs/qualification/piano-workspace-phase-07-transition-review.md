# Phase 7 transition/evidence review — CHANGES REQUIRED

Reviewed 14 November 2026. Commit `1e7774563fd214c599e8c3b969e676e345d06ade`, branch `phase7/normal-route`.

**Phase 7 is not accepted; Phase 8 stays stopped.** The previously submitted checks now pass, including the actual library-card revision journey. Two verification reversal gaps remain, and the loaded-video seek assertion is a false positive with the current fixture/serving setup. Physical-touch qualification is also still outstanding.

## Independent verification

| Check | Result |
| --- | --- |
| Original verification cases | 3/3 pass |
| Earlier transition cases | 2/2 pass: subsequent pitch retained, spelling restored in the same session |
| Settings cases | 2/2 pass |
| TypeScript | Clean, exit 0 |
| Submitted full normal-route script, redirected reviewer captures | Pass, normal exit 0; library menu -> Edit lesson -> revision POST base rev-normal-1 -> reopened 74 confirmed |
| Added structural-edit/recovery cases | **0/2 pass**, normal exit 1 |
| Stronger loaded-clock checks | Play/pause and rate pass; exact slider seek and seek-based end test fail with current fixture serving |
| Bare video element using the same bytes/serving | Reports duration 3 s but seekable range [0,0]; setting currentTime=1.5 returns 0 without application code |
| Full web 471 / original Phase 6 6+8 | Developer-reported this review, not independently rerun |

Review-only scripts/results are in `docs/qualification/piano-workspace-phase-07-review/`:

- `run-normal-evidence.py`, `phase7-route.json`, `normal-captures/` run the submitted script without overwriting its evidence.
- `check-verification-recovery.py`, `verification-recovery-results.json` demonstrate the two remaining reversal failures.
- `check-loaded-clock.py`, `loaded-clock-results.json` use before/after target checks and compare both cursors.
- `check-clip-seek.py`, `clip-seek-results.json` isolate the seek problem from the application.

Run with `.venv-saas/Scripts/python.exe` from repository root, with Vite at 127.0.0.1:5173. Browser checks use controlled routes and local fixtures; no real lesson data or server decisions were changed.

## U1 — reverting an added note ignores later length/metadata edits (high)

Reproduction: Accept an add-note suggestion (stored length 0.5 s), select the created `vf-add-1-a` note, change Recorded length to **0.9 s**, then Reject the suggestion.

Actual: the edited note is deleted. Expected under the agreed guarded-reversal policy: preserve the later edit and report the conflicting revert rather than silently discard it.

The revised `findingMatches(..., invert=true)` checks pitch/onset for add/merge/split, but omits recorded duration, velocity and relevant authored state. A note with later changes still passes as the unchanged accepted state. This is the same T1 contract applied to a recorded-length edit rather than the one tested pitch edit.

Required: define and validate the accepted transaction's relevant after-state before any destructive inverse. Preserve later recorded-length, velocity, spelling/rhythm/mapping changes where the inverse would discard them. Revalidate after the decision response as well. Test add/merge/split reversals and both compatible unrelated edits and conflicting affected-note edits. Keep atomic all-or-nothing history and explicit reconciliation.

## U2 — authored reversal baseline exists only in memory (high)

Reproduction: spell the original MIDI-60 note **B#3**, Accept a pitch correction, wait for a recovery checkpoint, reload, Restore local checkpoint, then Reject.

Actual: the note becomes **C4 / MIDI 60**. The authored B#3 spelling is lost again. The earlier same-session test passes because `authoredSpellings.current` is populated in that session; it is neither stored in recovery nor reconstructed from an authoritative authored baseline.

Required: persist a versioned, identity-scoped reversible authored transaction when appropriate, or explicitly refuse a reversal whose baseline is unavailable and preserve the current document with a reconciliation explanation. Do not fall back to a key-derived spelling and call that a faithful restore. Include older checkpoints, accepted decisions loaded from the server, reload/recovery, base/report changes and save/reopen. A complete guarded patch is preferable to snapshots of spelling alone where inverse delete/reinsert can also lose written duration, voices/ties and other metadata.

## U3 — video seek qualification still needs a seekable fixture and meaningful assertions (required evidence)

The actual library card journey is now independently confirmed. Loaded playback/pause/rate are also confirmed. Seek/cursor/end/header-scroll qualification is narrower than the handoff implies.

The submitted script plays first, pauses, clicks a ruler and checks only `seek > 0.3`. Playback has already passed that time, so the assertion can succeed without a successful seek. It checks only that a score cursor exists, not that both cursors represent the requested time. Its ruler click computes a proportion from the 3-second video's duration across a score for the 209-second draft, despite non-linear engraving.

Independent stronger check: after pausing around 0.36 s, request source-clock 1.5 s. Video and both cursors end at **0**, not 1.5. A separate bare video element (no app code) using the same clip bytes and response setup exposes **seekable [0,0]** and likewise returns to 0 on a 1.5 s seek. This isolates a fixture/serving limitation; it does not establish an application seek bug. The seek-based ended test is consequently not qualified either.

Required:

1. Use a reproducible seekable fixture and correct asset response behaviour, including byte-range support where required. Assert a usable seekable range before the transport test. Validate the real asset route's playback/seek semantics too, rather than assuming the mock matches it.
2. Use a short lesson whose time domain matches the fixture, or explicitly state the long-document/short-video limitation. Seek to known targets through the clock slider and roll/score ruler with the current map and actual geometry.
3. Assert before/after currentTime near the requested value, roll position in seconds, score tick under the map, and unchanged document/confirmation where appropriate. Test nonzero offset, rate, pause and natural end.
4. Test the original header problem **while scrolling**, with a loaded video and the real app header. The current header assertion checks only the initial geometry and conditionally skips if either box is absent. Assert elements exist and verify paint/hit order or containment at relevant scroll positions.
5. Keep interactive/upper-bound performance evidence separate from mocked page-load metrics.

Physical-touch qualification remains a distinct hardware gate. The mock/fixture seek problem can be fixed and tested on desktop without physical hardware.

## Resubmission

Fix U1/U2, retain the passing original 3+2+2 assertions and add the two recovery/structural cases without weakening their intended safety contracts. Complete U3's desktop evidence, then provide physical-device results or leave that last item explicitly BLOCKED. The accepted core architecture and actual library entry need no restart or library pivot. No product code, Git branch, commit or release was changed during review.
