# Piano correction workspace: phased delivery and review gates

Prepared: 13 November 2026.
Status: planning complete; implementation has not started under this plan.
UX authority: [Detailed workspace specification](piano-correction-workspace-developer-plan.md).

## 1. How the developer and reviewer will work

Develop one phase at a time, in the order below. Each phase must produce something concrete that can be inspected and tested. Stop after its submission. Do not begin the next phase until the reviewer explicitly gives a GO.

The product owner will provide the phase submission to the reviewer in this conversation. The reviewer will inspect the available code/diff, run or inspect appropriate tests, examine the relevant UI evidence and return one of:

- **GO:** the phase acceptance criteria pass; the next named phase may begin.
- **CHANGES REQUIRED:** named blocking issues must be corrected and resubmitted before proceeding.
- **BLOCKED:** required access, evidence or a product decision is missing; identify exactly what is needed.

A screenshot alone cannot establish working synchronisation or correct saving. A developer's statement that tests passed is not a substitute for reviewable results. Review approval applies to the submitted commit/diff; later changes affecting approved behaviour require proportionate regression review.

Neither this document nor a phase GO grants deployment, publication or release approval. Phase GO means permission within this working process to proceed to the next implementation phase. The reviewer cannot automatically observe an external developer's work: the owner/developer must submit it or make it available in the workspace.

## 2. Phase map

| Phase | Deliverable | What the owner can review |
| --- | --- | --- |
| 1 | Baseline audit and safe edit contracts | What already works, what must change, and proof that note identities/timing are understood |
| 2 | Unified document, commands, selection and history | One selected occurrence changes consistently without damaging chords or repetitions |
| 3 | Continuous keyboard/roll/score layout | Readable, horizontally scrollable correction workspace for the long recording |
| 4 | Shared playback, linked navigation and musical alignment | Both playheads, video and active keys follow the same musical moment |
| 5 | Safe persistence and recovery | Notation/alignment survive save/reopen; conflicts and unsaved changes are handled |
| 6 | Complete visual correction gestures | Editing through piano roll, staff and keyboard with one undo history |
| 7 | Production workflow integration and device qualification | Normal review uses the new editor, including narrow screens and actual touch devices |
| 8 | Formatted final score and final acceptance | Continuous correction converts to a readable formatted score using the same notes |

All phases start **NOT STARTED / NOT REVIEWED**. Completing this plan does not mark Phase 1 GO.

## 3. Standard submission for every phase

Submit a compact handoff containing:

1. Phase number, exact commit SHA or identified workspace diff, and changed files.
2. What was implemented and a mapping to that phase's acceptance criteria.
3. How to open the relevant screen/test route, fixture or real lesson; exact reproducible steps.
4. Commands actually run, pass/fail results, and full failure details where relevant. Identify fixture tests versus real-data/device checks.
5. Screenshots for visual changes; a short recording for gestures, scrolling and playback when useful. Record viewport/browser/device.
6. Known limitations, remaining work, contract changes and any deviation from the plan.
7. A statement that the next phase has not started.

Use a separate review note such as `docs/qualification/piano-workspace-phase-01.md` for each submission. Preserve the review decision and follow-up evidence there. Do not include credentials or private source recordings in submitted evidence unless already authorised for that destination.

Review prioritises data integrity, user-visible correctness and maintainability. Tests should cover meaningful behaviour, not merely mirror implementation details.

## Phase 1 — Baseline audit and safe edit contracts

### Goal

Establish a trustworthy starting point and resolve musical/data semantics before building the new interface.

### Developer scope

- Read the detailed specification and the existing draft review, notation editor, shared notation core and API save paths.
- Inspect the actual long example (approximately 209.6 seconds / 1,338 notes if still available), plus representative chord/tie fixtures.
- Inventory existing working behaviour versus required additions. Verify existing tests against current code; separate existing failures from new regressions.
- Trace initial review save versus reviewed-lesson revision save. Confirm where notation and alignment are currently absent or persisted.
- Audit event-wide operations: moving a chord, duration overwrite, generated-rest deletion, ties and multi-performance-ID mappings.
- Propose precise command contracts for per-occurrence pitch/onset/recorded-duration changes, logical written-duration changes, splitting mappings and voice-limit rejection.
- Document the offset sign convention, valid time bounds, note-ID invariants, estimated alignment and the proposed versioned alignment schema.
- Define fixtures and reproducible checks for every known destructive edge case.

### Out of scope

No replacement of the current page, no new library adoption, no visual redesign or production data mutation. Small isolated diagnostic fixtures are acceptable.

### Acceptance gate

- Every existing editor surface and save boundary is identified accurately.
- The developer demonstrates why selecting one C4 must use an occurrence ID, and why moving one chord member cannot blindly reuse an event-wide command.
- Proposed data contracts preserve exact seconds separately from score ticks.
- Existing test failures and actual-example access limitations are recorded honestly.
- No unresolved destructive operation is assumed safe for reuse.

### Submission evidence

Baseline audit, command/schema proposal, current test results and screenshots of the existing example where accessible. Reviewer GO authorises Phase 2 only.

## Phase 2 — Unified document, selection, commands and history

### Goal

Build the shared editing foundation independently of the final screen layout.

### Developer scope

- Establish one working document containing performance, notation and stable links; one shared occurrence selection; one history.
- Extract the existing editor so its surfaces can use external selection/playback rather than owning another video.
- Implement/test safe per-occurrence pitch, onset, recorded length, insertion and deletion commands; logical rhythm/spelling commands with explicit scope.
- Separate free recorded-time changes from beat-snapped changes.
- Split chord/mapping structures when required and representable. Reject unsupported third-voice/ambiguous operations without altering existing notes.
- Preserve logical IDs and authored spelling/rhythm through unrelated edits.
- Ensure drag preview/cancel and completed-command boundaries support a single undo entry.
- Surface a minimal isolated developer harness for selecting/editing representative notes; leave the ordinary review route unchanged.

### Out of scope

No completed gesture UX, linked scrolling, alignment authoring or draft persistence claim yet. No production replacement of note forms.

### Acceptance gate

- Editing one of many repeated pitches changes only the selected occurrence.
- Editing one chord member leaves unrelated members unchanged.
- A 10 ms onset adjustment is not rounded when Snap Off.
- Written duration and recorded duration are independent.
- Undo/redo restores document and valid selection; no dangling mappings.
- Invalid commands, cancelled operations and no-ops do not mutate data or create misleading history entries.
- Existing reviewed-editor behaviour remains compatible or is explicitly isolated until migration.

### Submission evidence

Command tests, before/after document examples, minimal harness steps and regression results. Reviewer GO authorises Phase 3.

## Phase 3 — Continuous correction layout and viewports

### Goal

Make the long recording readable and navigable before introducing playback complexity.

### Developer scope

- Implement the desktop arrangement: keyboard, piano roll, continuous grand-staff strip, smaller reference video and selected-note inspector.
- Use one video element. Keep the harness on an isolated development route or explicit feature flag.
- Add independent horizontal scroll containers and a shared viewport controller, preparing interfaces for time/beat mapping.
- Default the roll to approximately 10 seconds visible; add zoom, readable rulers, fixed pitch labels and score context.
- Add the whole-clip overview with a visible-range window.
- Virtualise/cull long timelines and score measures; do not compress the whole clip into the editing panel.
- Make selection visible in all three views and reveal its counterpart through the controller.
- Implement basic responsive structure now; complete physical-device qualification in Phase 7.

### Out of scope

No claim of complete playback alignment or finished note gestures. Rendered transport controls that are not connected must be disabled/labelled in the harness rather than appearing functional.

### Acceptance gate

- The actual long example is readable at default zoom.
- Sheet music is one continuous horizontal grand staff, not paginated or vertically wrapped.
- No horizontal page overflow at 390 px and desktop widths.
- Scroll/zoom does not mutate notes or seek playback inadvertently.
- Selected notes can be found in both views, and active pitch/selection styles are distinguishable.
- Header and toolbar do not cover editable content; no duplicate video/clock.

### Submission evidence

Desktop/narrow screenshots, scroll/zoom demonstration, long-example render measurements and viewport tests. Reviewer GO authorises Phase 4.

## Phase 4 — Shared playback, navigation and alignment

### Goal

Make the video, keyboard, piano roll and sheet strip represent one source time correctly.

### Developer scope

- Connect the existing video/source-player controller to the visual surfaces. Preserve original/piano audio selection semantics.
- Draw both playheads from one source clock; active note/key highlights use exact effective performance intervals.
- Implement source-seconds/score-tick mapping, inverse seeking and explicit estimated alignment state.
- Implement monotonic alignment anchors and an advanced “Align beat to video” flow with validation/history.
- Handle arpeggiated chords, rubato and explanation passages as specified; do not imply a fixed BPM is exact alignment.
- Link scrolling by musical position, with origin tokens to prevent feedback loops.
- Implement Follow playback, manual-pan suspension, Return to playhead and overview navigation.
- Implement global offset once at the conversion boundary, including inverse conversion for editing targets.
- Keep playback state and selection separate. Pause on note selection/edit initiation.

### Acceptance gate

- Play, pause, seek, playback-rate changes and ending update both views consistently.
- Clicking a note seeks to its actual effective onset; clicking a ruler uses the correct mapping.
- Scrolling does not seek; scrubbing does. Manual scroll disables Follow and linked scroll does not oscillate.
- Both cursors represent the same musical moment even when their pixel positions differ.
- Exact note activation remains correct for arpeggiated chords whose engraved notes share one x coordinate.
- Negative/positive offsets do not accumulate or double-apply.
- Alignment anchors cannot reverse time or score order; pauses in speech passages are represented honestly.
- UI animation does not rerender all editor controls at frame frequency.

### Submission evidence

Recorded playback/scrub/scroll examples, mapping/offset tests, timestamp/geometry assertions and measured visual latency. Reviewer GO authorises Phase 5.

## Phase 5 — Persistence, verification and recovery

### Goal

Prove that corrections can be saved and reopened safely before exposing the full new editing flow as the normal review experience.

### Developer scope

- Extend draft review contracts to store validated notation and versioned alignment alongside performance events.
- Reuse server-side notation integrity validation and existing reviewed-revision conventions.
- Preserve ownership checks, source/reference identity, verification state tokens and idempotent finalisation.
- Handle accepted-suggestion conflicts without silently discarding decisions or user edits.
- Invalidate rendered piano audio only when its relevant performance identity changes; fall back to Original and label stale preview state.
- Add versioned device-local recovery with draft/source/account identity checks and honest status text.
- Reset review confirmation after document edits; retain edits on save failure and through retry.
- Verify legacy references without notation/alignment open correctly.
- Exercise saves in the isolated harness using Phase 2 commands; full gesture UX is not needed to test persistence.

### Acceptance gate

- Pitch, exact onset, recorded length, written duration, spelling, voices/ties and alignment anchors survive save/reopen.
- Submitted event data and notation cannot disagree undetected.
- No duplicate finalisation on retry; stale-draft conflicts retain local recovery information.
- Account/source mismatches never restore another account/draft's data.
- UI never claims server “Saved” for an unpersisted local recovery checkpoint.
- Private save does not publish or update a shared release.
- Spelling-only edits do not unnecessarily invalidate audio; pitch/time edits cannot leave stale piano playback labelled current.

### Submission evidence

API/integration tests, saved payload/reference samples, save-failure/reload recovery demonstration and compatibility results. Reviewer GO authorises Phase 6.

## Phase 6 — Complete visual editing interactions

### Goal

Make all agreed correction journeys work naturally through the three connected views.

### Developer scope

- Piano roll: select, pitch drag, axis-locked time move, recorded-length resize, explicit snap and precise inspector fields.
- Sheet: select individual chord noteheads, drag across staff lines/spaces, duration toolbar, accidentals and separate enharmonic respelling.
- Keyboard: audition, active-occurrence selection, overlap candidate picker, explicit Replace pitch mode and Cancel.
- Add note: ghost preview, time/pitch choice, Insert/Enter and Cancel; duplicate warning.
- Delete, audition, keyboard shortcuts and shared undo/redo.
- Clear indicators for selection, sounding notes, ghost previews, invalid placements and target scope.
- Safe tie handling and voice-limit messaging; no hidden destructive overwrite.
- Touch edit handles and numeric alternatives; no inaccessible drag-only operations.

### Acceptance gate

- Every section 6 user journey in the detailed specification passes.
- Selecting a key with no active occurrence auditions without editing a random note.
- Replace pitch changes exactly its target and exits correctly; Escape changes nothing.
- Drag cancellation/pointer loss restores the prior document; one completed drag is one undo step.
- Editing a chord note or mapped occurrence does not silently change other notes.
- Duration actions state whether they affect written rhythm or recorded length.
- Sharp/flat/natural and respelling have distinct verified results.
- The same corrections save/reopen through the Phase 5 pipeline.

### Submission evidence

Short recordings of each editing surface, interaction tests and a saved/reopened long-example correction. Reviewer GO authorises Phase 7.

## Phase 7 — Normal review workflow and device qualification

### Goal

Replace the unwieldy piano forms in the ordinary review journey, with demonstrated usability and performance.

### Developer scope

- Integrate the workspace into initial piano draft review and reuse it for reviewed piano revisions.
- Remove the redundant piano form list once equivalent capabilities are proven. Retain guitar behaviour.
- Move teaching sections, assessment and diagnostics into the planned compact settings flow.
- Finish review summary, required confirmation, unsaved navigation guard and recovery UX.
- Complete narrow layout, mobile reference panel, inspector bottom sheet and touch pan/edit separation.
- Verify keyboard navigation, focus, readable labels, contrast and reduced motion.
- Measure the actual long example and supported upper-bound fixtures; optimise only demonstrated bottlenecks.
- Test at least one physical touch device; document tested browser/device coverage and unsupported cases.

### Acceptance gate

- A user can enter from the normal library/review route, correct a note, finalise and reopen it.
- Both initial review and later private revision creation retain their existing access/release semantics.
- No duplicate state arrays, video elements or independent playback transports remain.
- Touch panning does not accidentally alter notes; inspector and video do not obscure necessary editing actions.
- No page-level horizontal overflow, stuck audition voices or header overlap.
- Recovery, confirmation reset, save error and verification conflict states are usable.
- Actual test/performance evidence meets the stated targets or limitations are explicitly reviewed.

### Submission evidence

End-to-end route tests, desktop/mobile captures, actual-device evidence, performance report and regression results for guitar/reviewed editing. Reviewer GO authorises Phase 8; it is not deployment approval.

## Phase 8 — Formatted final score and final acceptance

### Goal

Provide a readable final score while preserving the continuous correction workspace and the same musical data.

### Developer scope

- Add read-only formatted preview with wrapped systems/pages, grand staves, titles and correct ties/context across system breaks.
- Add Return to correction that restores selection and viewport.
- Preserve existing MusicXML export; label export formats accurately. If PDF is delivered, implement and visually inspect pagination rather than merely printing the editing strip.
- Reopen finalised material and confirm the formatted score and correction views agree.
- Run final end-to-end acceptance covering the complete detailed-spec matrix and remaining meaningful regression checks.
- Record known notation/rendering limits and anything intentionally deferred with product agreement.

### Acceptance gate

- No second independent note dataset is created for the formatted score.
- A corrected pitch, written duration and accidental appear consistently in correction mode, formatted preview and export.
- Page/system breaks do not lose staff context, ties or notes.
- Preview switching does not mutate notes or lose edits.
- The actual long example remains editable and saveable, with physical-device evidence from Phase 7 preserved.
- All blocking review issues are resolved; no unsupported functionality is presented as complete.

### Submission evidence

Formatted-score captures/export samples, complete acceptance results, final code identity and a short user-facing limitations note. Reviewer returns final acceptance or a named correction list. Any release decision remains separate.

## 4. Review record template

Copy this into each phase submission:

| Item | Value |
| --- | --- |
| Phase | Number and title |
| Submitted code | Commit SHA or exact diff identity |
| Developer summary | Scope completed |
| Evidence | Commands, logs, fixtures, captures and device/browser |
| Deviations / limitations | Explicit list, or none |
| Review decision | NOT REVIEWED / GO / CHANGES REQUIRED / BLOCKED |
| Blocking findings | Severity, file/location, reproduction and expected behaviour |
| Follow-up submission | Fix identity and rerun evidence |
| Next phase authorised | Named phase only after explicit GO |

## 5. First instruction to give the developer

“Read the detailed piano correction workspace specification and the phased-delivery plan. Complete Phase 1 only: audit the existing editor/review/save implementation, establish baseline test evidence, identify destructive command paths, and propose exact occurrence/timing/alignment contracts. Do not replace the page or start Phase 2. Submit the Phase 1 handoff with code identity, findings and test results for review.”
