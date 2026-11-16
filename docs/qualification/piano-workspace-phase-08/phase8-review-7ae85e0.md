# Phase 8 correction review — 7ae85e0

Reviewed 16 November 2026 (Singapore).
Branch `phase8/formatted-score`; commit `7ae85e021e84b497174fb4b5c6c892678e23f28e`.

## Decision

**Phase 8 remains in correction, with three specific remaining defects.** The previous six-case review now passes independently, and the major mode/media restoration and saved-only reopen repairs are confirmed. Do not rebuild or reopen those passing areas. Complete the three repairs below as one submission.

These are existing P8-R1/P8-R3 cases: unfinished pointer transactions and correct rendering of supported notation. No new feature, PDF/MIDI export, library migration, hand separation or Phase 7 qualification work is requested.

## Confirmed closures

| Independent check | Result |
|---|---|
| Original six-case `review-probes.py` | **6/6 pass**: visible staves, anchor geometry, non-default scroll restoration, Delete blocked in preview, preserved source element/time/rate, working returned clock |
| `scripts/check-formatted-score.py` | Pass: exact edited-note MusicXML match, same-session state, private save, actual saved-only reopen and formatted agreement |
| `scripts/check-mode-lifecycle.py` | Pass: repeated switches retain dirty document/selection/history/zoom/scroll and same video; playing entry pauses and preserves position/rate |
| TypeScript | Clean |
| Submitted page 1/page 2 captures | Inspected; missing-staff and detached-ledger defects fixed; flags/context visibly improved |

The new focused Node test run emitted passing subtests, but automatic approval review blocked its completion observation because an unsolicited connection to a Visual Studio telemetry endpoint had an unknown payload. It was not retried or bypassed. Do not describe the full 505-test/build/16-script results as independently repeated in this review; those remain developer evidence. This environment limitation is separate from the three reproduced product defects.

## One independent edge-case runner

From repository root:

```powershell
& .venv-saas/Scripts/python.exe docs/qualification/piano-workspace-phase-08/review-edge-probes.py
```

Current result: **0/3 pass**. Raw evidence: `review-edge-probes-results.json`.

The runner uses a controlled route over the real draft, a real mouse/keyboard interaction, and rendered compact notation fixtures. No real server data is changed. Reviewer additions are evidence files only.

## C1 — unfinished pointer edit commits after entering preview

**Reproduction:** start a pitch drag using a real mouse, move until the live candidate appears, keep the pointer down, focus the Formatted score button and activate it with Space, then release the mouse.

Observed:

```json
{
  "preview_pitch": "70",
  "before_pitch": 69,
  "after_pitch": 70,
  "before_history": 0,
  "after_history": 1
}
```

The keyboard shortcuts and explicit Add/Replace modes are protected, but the mounted hidden TimeRoll still owns an active drag and its global pointer-up listener. `applyGestureEdit` does not check formatted mode; hiding the subtree does not cancel that transaction.

**Required repair:** cancel in-flight roll/sheet pointer transactions on entering formatted mode or prevent the transition until they resolve. Also refuse late gesture commits while formatted mode is active, so already-bound callbacks cannot bypass the mode policy. Keep the mounted-subtree solution and media/viewport fixes; do not reintroduce unmounting to cancel drags. Clear candidate/audition/capture/listeners appropriately.

**Pass conditions:** start pitch/time/resize and sheet drag, switch via keyboard while the pointer is still held, release/cancel/lost-capture, and verify canonical document/history/dirty state stay at the pre-drag state. Add/Replace cancellation and ordinary preview shortcuts remain passing. Return and perform a normal drag, proving editing still commits once and audition/capture is not stuck. These cases belong to the already-requested unfinished-gesture handling in P8-R1.

## C2 — supported minor-key signatures disappear

The formatted renderer has its own major-only key-name map. The shared notation engine already supports 30 major/minor keys. The rendered probe checks all 30 and finds **14 failures**: all minor keys with nonzero fifths produce zero key-signature glyphs.

Examples:

| Key | Expected glyphs on a one-system grand staff | Rendered |
|---|---:|---:|
| Em | 1 sharp per staff = 2 | 0 |
| Dm | 1 flat per staff = 2 | 0 |
| Bbm | 5 flats per staff = 10 | 0 |

This can change how the score is read: the note-level accidental may correctly be suppressed because it is already supplied by the key, while the formatted key signature is missing. MusicXML uses the shared key helper, so the exported and visual score can disagree.

**Required repair:** derive the formatted signature from the existing shared `keySignature` fifths/mode definition instead of duplicating a major-key lookup. Reuse the appropriate sharp/flat order and clef positions. Do not patch Em alone or add a separate list of minor exceptions.

**Pass conditions:** all 30 currently supported keys render the expected symbol count/type on both staves on every system. Include natural zero-signature keys, positive/negative fifths and the highest supported accidental counts. Check signature geometry and agreement with the existing MusicXML fifths/mode. This is supported-key rendering, not a request for new keys or key detection.

## C3 — ledger lines are truncated for valid piano notes

The coordinates now use the correct spacing, but `ledgerLines` clamps to five lines beyond either staff.

| Valid piano note | Required ledger lines | Rendered |
|---|---:|---:|
| A0 on bass staff | 6 | 5 |
| C8 on treble staff | 9 | 5 |

**Required repair:** draw the ledger lines needed to read the actual pitch, without the arbitrary five-line cap. Keep them attached to the relevant staff/system and within usable page/system bounds. If spacing must grow for a supported extreme, adjust spacing rather than silently omitting lines. No new octave-transposition feature is required.

**Pass conditions:** render the supported piano range A0-C8 with both-staff line/space/ledger checks, including these two boundary cases. Verify ledger count and placement, no clipped heads/lines or collision with an adjacent system/page context, and retained segment/occurrence counts. Preserve the already-passing E4/F5/A3 anchors.

## Exact next goal and submission

**Goal: close C1-C3 together while retaining all previous closures, then submit Phase 8 for acceptance once.**

1. Repair active gesture cancellation/late-commit protection, shared key signatures and complete ledger rendering.
2. Add durable tests for the case families above; the supplied edge runner must pass without weakening its assertions.
3. Retain the six original probes, repeated lifecycle check and saved-only/MusicXML check. Run ordinary tests/build plus affected gesture/keyboard/media regressions; no new full Phase 7 performance run is requested.
4. Inspect refreshed real pages and compact key/extreme-register fixtures; include captures and raw results with final SHA.
5. Keep the existing limits and Phase 7 carry-forward explicit: no PDF, cap inactive pending approval/audit, physical H1-H9 blocked, deployment/release unauthorised.

Do not submit only a C1 patch and leave C2/C3 for another acceptance round. Checkpoints are fine; the next acceptance package must contain all three fixes and evidence. Any unrelated engraving improvement belongs in the backlog. Rendering caches/layout remain derived from the same working document; no second note authority or transcription pass is needed.
