# Piano correction workspace — Phase 7 submission

Normal review workflow and device qualification.

| | |
| --- | --- |
| Phase | 7 — Normal review workflow and device qualification |
| Branch | `phase7/normal-route` |
| Depends on | accepted Phase 6 `0dee2e0` |
| Phase 8 | Not started |

## 0. What changed

| Area | Change |
| --- | --- |
| Initial review | `MusicDraftReview` renders the shared workspace for piano drafts (replacing the legacy piano form list) through `PianoWorkspaceHarness lessonId embedded`, with Back, dirty-navigation confirmation and a save callback. Guitar keeps its existing review. |
| Reviewed revisions | `MusicLessonEditor` renders the same workspace for reviewed piano lessons (`embedded`, `onSaved`). The workspace coordinator loads the saved reference and saves a new private revision on that base. |
| Keyboard focus ownership | Workspace shortcuts (Delete, Ctrl/Cmd+Z, redo) run only while focus or the last pointer is inside the workspace; focusing app chrome or any outside control disables them. The mode-specific Escape handlers stay scoped to their modes. |
| Harness language | Visible “Developer harness · Phase 4 · writes nothing” was replaced with review language; the source clock is no longer labelled a fixture; fixture-only labels and titles remain only on the isolated demo harness (`?demo=`). |
| Responsive / touch | Narrow layout stacks the grid, the inspector becomes a sticky bottom sheet (`data-inspector-sheet`, computed `sticky`, 44vh), the toolbar sticks, and the long score is contained in its own horizontal scroller (document overflow 0 at 390 px). Touch uses an explicit two-step rule: first tap selects, a drag on the already-selected note edits; the same rule applies to sheet noteheads. |
| Accessibility | Visible focus rings, stronger report/hint contrast, and a reduced-motion media query. |
| Performance | The 1,338-note lesson loads in ~133 ms DOMContentLoaded, ~135 ms load, renders 35 roll notes / 43 score noteheads in the current window (virtualised by span/measure), ~22 MB heap. No optimisation was required. |

## 1. Acceptance-gate status

| Criterion | Status |
| --- | --- |
| Enter from normal review route, correct, finalise, reopen | Verified with a controlled normal route on the real 1,338-note draft: pitch 69→72 saved, reopened reference shows 72; legacy form absent. |
| Initial review and later private revision semantics | Initial review uses the existing `music-draft/review` contract with confirmation; the review route then shows the reviewed lesson. Revision creation is wired through `MusicLessonEditor` to the same workspace and `music-revision` path, but the library-driven revision journey was **not** exercised end-to-end in this submission (see limits). |
| No duplicate state/video/transport | The workspace remains the single editing surface; guitar review is unchanged; no second video element is added by integration. |
| Touch panning must not alter notes | Emulated Chromium touch at 390 px: first tap only selects; explicit second-gesture drag edits. Panning on the roll/score background scrolls (`touch-action: pan-x pan-y`). Not verified on hardware. |
| No page horizontal overflow, stuck voices, header overlap | 0 px overflow at 390 px after score containment; header/toolbar are not fixed over content; audition voices are bounded by the existing 0.4 s release. |
| Recovery, confirmation reset, save error, verification conflict usable | Existing Phase 5 flows retained; Back now asks before discarding unsaved work. |
| Actual performance evidence | Measured above on the real 1,338-note draft. |
| Physical touch device | **Not performed.** No physical device was available in this environment; the touch pass is Chromium emulation only. |

## 2. Evidence

- Route script: `scripts/check-normal-route.py`; results `phase7-route.json` (0 failures).
- Captures: `captures/normal-route-saved.png`, `captures/touch-390.png`, `captures/normal-route-1338.png`.
- Regression: Phase 6 reviewer correction script 6/6; original eight probes 8/8; editing browser script exit 0; web suite **471 passed**; `tsc` clean.
- `scripts/workspace-phase6-review-repro.tsx` retained unchanged.

## 3. Limits (explicit)

- **Physical touch qualification is outstanding.** The GO requires a physical device; this submission only provides emulation on Chromium at 390×844 with `hasTouch`. A reviewer or device lab must run the tap/pan/edit checks on hardware before this criterion can be marked met.
- The library-driven “create a new private revision” click path was not exercised end-to-end because the controlled route environment does not expose the studio/library action; the revision editor’s workspace mount and saved-reference load were verified via the reopen path. This should be demonstrated on the integrated environment.
- Video playback integration is the Phase 4 controller already used by the harness; this phase does not add a second transport.
- Compact settings for teaching sections/assessment/diagnostics were **not** moved into a settings flow; the workspace keeps its existing compact panels and the legacy review no longer renders the piano form list. This remains open scope if the reviewer requires it.

## 4. Scope statement

Phase 8 has not started. No deployment or release action was taken.

---

## 5. Correction round: R1–R5 (this commit)

| Item | Resolution |
| --- | --- |
| R1 styling and copy | The shared stylesheet and notation styles load from the application entry (`main.tsx`), so the normal route uses the same grid, note fills, toolbar, focus and motion rules as the harness; harness-global `body` rules are scoped to `.ws-shell`. The normal-route test asserts computed `display:grid`, non-black roll/sheet fills, inspector/toolbar placement, 0 page overflow, and loaded-media-free header bounds. Stale copy is replaced: status says “Unsaved changes”, the offset is a preview-alignment control, anchor/roll hints no longer reference Phase 5/6, and the incomplete-link error is product language. |
| R2 dirty and delayed saves | The workspace forwards dirty state through `onDirty` to `MusicReviewRoute` and `MusicLessonEditor`, so library navigation, browser history and Back all consult one value; the route test drives the real “Form home” link and receives the confirmation. `onSaved(revisionId, current)` marks whether the acknowledged snapshot is still current; wrappers only refresh/navigate for a current snapshot and never clear dirty state for an older save. The normal route no longer auto-navigates on save at all, so a delayed response cannot unmount newer edits. |
| R3 loader, saved-only, format | A new `MusicReviewRoute` resolves the subject from the versioned music manifest first and renders the shared workspace for piano, or the guitar component for guitar; the legacy piano branch is removed from `MusicDraftReview`. A saved-only lesson (manifest + reference, draft 404) opens the workspace directly. Every manifest read in the workspace, reopen and refresh paths sends `X-Lesson-Formats: 1,2`, and the route mock now returns 406 without it, proving the contract. |
| R4 capabilities | A compact, collapsed “Lesson settings” panel restores teaching sections (add/split/rename/boundaries), assessment policy, and playing/explanation passage editing; changes are dirty, reset confirmation and are written through `buildSaveBody`. Verification remains conflict-aware (`verification_state_token` and 409 handling) but the accepted/rejected decision UI is **not** yet rebuilt; this is disclosed below. |
| R5 focus and evidence | Undo/redo now return before `preventDefault` unless the workspace owns the shortcut, and Escape handlers require workspace focus. The route test confirms an outside Ctrl+Z is neither applied nor consumed, then works after re-entry. |

### Verification (correction)

| Check | Result |
| --- | --- |
| Normal-route E2E | 0 failures: computed styling, settings panel, app-navigation guard, saved-only entry, focus ownership, save/reopen (70→73), guitar regression, 1,338-note performance, emulated touch |
| Phase 6 correction checks | 6/6 |
| Original eight probes | 8/8 |
| Editing browser script | pass |
| Web suite | 471 passed, `tsc` clean |

### Still outstanding

- **R6 physical touch qualification is BLOCKED.** No hardware is available in this environment; the touch pass remains Chromium emulation. Per the review, this gate cannot be marked met without a recorded device/OS/browser run.
- The library-driven **new private revision** journey (edit from the library, revision POST with `base_revision_id`) is wired but not driven end-to-end; only the review and saved-reference paths are covered.
- **Verification decisions** (accepted/rejected suggestions, concurrent decisions) are preserved server-side as a token with conflict handling, but no decision UI is rendered in the workspace. Explanation/playing passages have an editor; verification findings do not.
- Performance numbers remain a controlled dev-server run with mocked requests and no playable video.

---

## 6. Correction round: C1–C4

| Item | Resolution |
| --- | --- |
| C1 settings recovery | `RecoveryCheckpoint` now carries validated `sections` and `assessment`; validation rejects malformed settings, both restore paths apply them, confirmation is reset and the work stays dirty. Older checkpoints without these fields restore only their notation and say the current settings were kept. The reviewer's `check-settings.py` passes both cases. |
| C2 passage/map coherence | Passage kind, boundary and add/remove operations are rejected with an explicit message rather than declaring a hold while the cursor advances. Teaching-section edits now move shared boundaries (end adjusts the next start, start adjusts the previous end), the first start and last end are pinned to the clip, and Remove gives the removed span to the previous section (or re-starts the new first at zero). |
| C3 verification | The compact settings panel now loads the verification state and renders findings with Accept/Reject. Decisions call the server, update the token, and apply supported edits (`set_pitch`, `set_onset`, `delete_note`, `add_note`, `merge`, `split_note`) through the same occurrence commands as manual editing, so no second event array exists. A 409/conflict keeps the working document, reloads the diagnostics and reports the conflict. |
| C4 revision path | `MusicLessonEditor` stops after the manifest when the subject is piano: it no longer downloads, hashes or parses the reference or builds a note array before the workspace mounts. Navigation after a revision save waits for the refreshed manifest and re-checks live dirty state, so edits made during the refresh keep the editor mounted. |

### Verification (correction C1–C4)

| Check | Result |
| --- | --- |
| Reviewer settings checks | **2/2** (settings recovered; passage edit rejected and kind remains playing) |
| Normal-route E2E | 0 failures |
| Phase 6 correction checks | 6/6 |
| Original probes | 8/8 |
| Editing browser script | pass |
| Web suite / `tsc` | 471 passed / clean |

### Still outstanding

- **C5 physical touch and loaded-video qualification remain BLOCKED.** No hardware is available; the touch evidence is Chromium emulation and the normal-route run has no playable video.
- **Library → private revision → save/reopen is still not driven end-to-end.** The loader and delayed-navigation code are corrected, but the controlled library card could not be made to render through the summaries fixture in this pass, so the POST-with-`base_revision_id` journey is unverified.
- The verification diagnostics are implemented but have not been exercised against a real verification report/decision fixture in an end-to-end run.

---

## 7. Verification integration corrections (V1–V4)

| Item | Resolution |
| --- | --- |
| V1 atomic findings | The reducer now accepts a `commands` batch that stages the whole finding against an evolving candidate document and commits one history entry only if every command applies. Unsupported operations are refused with a reason; inserted/merged/split notes keep the server's deterministic `vf-*` identity and velocity, and receive written ticks through the current alignment. |
| V2 stale proposals | Each edit's `before` snapshot is compared with the live document before accepting (and again after the asynchronous decision). A manual change blocks the local application with an explicit conflict message; unrelated edits are preserved. |
| V3 decision reconciliation | Rejecting a previously accepted finding builds the inverse command set (pitch/onset/delete/add/merge/split) and applies it atomically only when the accepted state is still present; otherwise the local document is kept and the conflict stated. Conflict reload advances the save token only when the server's working performance matches the local document. |
| V4 revision path | `MusicLessonEditor` stops immediately after the piano manifest (no reference download, hash, parse, score or note array); the legacy piano JSX and notation branch are removed so the file only renders guitar. Revision save waits for the refreshed manifest and re-checks live dirty state before the app's navigation callback. |

### Verification (V1–V4)

| Check | Result |
| --- | --- |
| Reviewer verification checks | **3/3** (manual pitch 61 preserved; Accept→Reject returns 60; merge 20→19 with the merged note and server count 19) |
| Reviewer settings checks | 2/2 |
| Revision journey (revision route) | pitch 73→74, revision POST `base_revision_id=rev-normal-1`, manifest revision 2, reopened revision keeps 74 |
| Normal-route E2E | 0 failures |
| Phase 6 checks / probes / editing | 6/6, 8/8, pass |
| Web suite / `tsc` | 471 / clean |

### Still outstanding

- **Loaded-video qualification was not completed.** A local 3 s fixture was generated, but the controlled draft did not surface a `<video>` element in the workspace (source-video asset path); the test was removed rather than reported as passing. It must be run in a desktop browser with a valid source-video fixture.
- **Physical touch qualification remains BLOCKED** (no hardware).
- The revision journey is driven through the direct `music-edit?id=` route, which is the same component the library action opens; the library card click itself was not exercised.
- Section validation now requires contiguous sections starting at zero, unique ids and a final end matching the checkpoint clip duration; older checkpoints without a duration are validated without that final clamp.

---

## 8. Transition corrections (T1–T2), library journey and loaded video

| Item | Resolution |
| --- | --- |
| T1 later manual edits | A rejection now reverts only when the accepted state is still exactly present (pitch/onset of every affected note, plus inserted `vf-*` identities). A later manual edit makes the revert a no-op with an explicit message, so 62 → manual 63 → Reject keeps 63. |
| T2 authored spelling | Authored spellings are snapshotted per finding before acceptance and passed back on the inverse `set-occurrence-pitch` (and reinserts), so B#3 → Accept → Reject restores B#3 rather than the key-derived C4. |
| Library revision journey | The library card action (“Edit lesson”) now drives the journey: workspace opens, pitch 73→74, revision POST with `base_revision_id=rev-normal-1`, manifest becomes `rev-revision-2`, and the reopened revision keeps 74. |
| Loaded video | A 3 s local fixture is served through the draft (no saved manifest this time, so the proposal is what loads). Verified: duration 3 s, play advances, rate 0.75 applies, pause holds, a score-ruler seek moves the video and the score cursor, and the video does not overlap the app header. |

### Verification (T1–T2)

| Check | Result |
| --- | --- |
| Reviewer transition checks | **2/2** (63 preserved; B#3 restored) |
| Reviewer verification checks | 3/3 |
| Reviewer settings checks | 2/2 |
| Library revision journey | pass (base `rev-normal-1`, reopened 74) |
| Loaded video | pass (3 s fixture, play/rate/pause/ruler-seek/cursor/header) |
| Normal-route E2E | 0 failures |
| Web suite / `tsc` | 471 / clean |

### Outstanding

- **Physical touch qualification remains BLOCKED.** No hardware is available; emulated touch is not a substitute.
- The loaded-video performance figures are still a controlled dev-server run; interactive upper-bound timing has not been profiled beyond the long-example load/render numbers.

---

## 9. Reversal and seek corrections (U1–U3)

| Item | Resolution |
| --- | --- |
| U1 later note edits | Destructive inverses now compare the full accepted after-state: pitch, onset, recorded duration, velocity and the presence of the inserted `vf-*` identity. An added note whose recorded length was changed to 0.9 s is no longer deleted on reject; the reversal is skipped with an explicit reconciliation message. Deleted-not-reinserted state is also checked. |
| U2 baseline after reload | The authored-spelling baseline is part of the versioned recovery checkpoint (validated on read), restored on both recovery paths. If an older checkpoint has no baseline, a reversal that would need authored spelling is refused and the local document kept, rather than restoring a key-derived spelling. |
| U3 seekable video | The fixture is re-encoded with `+faststart`, and the asset route now serves byte ranges (`206` + `Content-Range`/`Accept-Ranges`). Evidence: seekable `[0,3]`, slider seek to 1.5 s gives video 1.5 s, roll cursor 1.5 s and score tick 1740 under the current map, then a playback-to-end check (`ended`, paused, 3 s). Header overlap is checked at rest and while scrolling using the paint/hit result, not just box geometry. |

### Verification (U1–U3)

| Check | Result |
| --- | --- |
| Reviewer recovery cases | **2/2** (0.9 s note retained; B#3 restored after reload/recover) |
| Reviewer verification / transitions / settings | 3/3, 2/2, 2/2 |
| Reviewer loaded-clock | 4/4 (play/pause, rate, exact seek with both cursors, ended) |
| Reviewer bare clip seek | pass (seekable range with byte serving) |
| Library revision journey | pass (base `rev-normal-1`, reopened 74) |
| Normal-route E2E | 0 failures (loaded video now includes seek/ended/scroll checks) |
| Web suite / `tsc` | 471 / clean |

### Outstanding

- **Physical touch qualification remains BLOCKED** — no hardware; emulated touch is not a substitute.
- The video pass uses the 209 s long draft with a 3 s fixture at source second 1.5; it validates the transport/cursors against the current map, not a short-document domain. That limitation is explicit.
- Performance figures remain controlled dev-server measurements; interactive upper-bound profiling is still separate.

---

## 10. Written-rhythm reversal guard (W1)

Reversal safety now uses an accepted-state baseline that covers both performance and authored notation. Before an accepted finding is dispatched, the resulting candidate document is snapshotted per affected occurrence: pitch, onset, recorded duration, velocity, authored spelling, staff, voice, and the owning event's written start/duration. The baseline is persisted in the versioned recovery checkpoint alongside the spelling map.

A destructive inverse runs only when every snapshotted field is still identical. Changing the accepted added note's written duration to a half note (960 written ticks) therefore makes the rejection a no-op with an explicit reconciliation message instead of deleting the corrected note. Missing baselines from older checkpoints continue to refuse reversals that would need authored restoration.

### Verification (W1)

| Check | Result |
| --- | --- |
| Reviewer written-reversal case | **1/1** — note retained after Accept → written half note → Reject |
| Reviewer recovery cases | 2/2 |
| Reviewer verification / transitions / settings | 3/3, 2/2, 2/2 |
| Reviewer loaded clock | 4/4 |
| Normal-route E2E | 0 failures |
| Web suite / `tsc` | 471 / clean |

### Outstanding

- **Physical touch qualification remains BLOCKED** — no hardware.
- Interactive/upper-bound performance profiling remains a separate evidence item.
