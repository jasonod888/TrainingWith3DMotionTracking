# Phase 7 review — CHANGES REQUIRED

Reviewed 14 November 2026. Submission: `11feba09ed42908b782bdcd4f19b47f31f797d61`, branch `phase7/normal-route`, compared with accepted Phase 6 `0dee2e0`.

**Decision: Phase 7 is not accepted. Phase 8 must remain stopped.** The developer correctly disclosed unfinished qualification, but there are also functional integration regressions to fix before hardware qualification can complete the gate.

## Evidence and scope

- Independently reviewed changed route components, workspace integration, CSS imports, save callback and navigation wiring.
- Independent TypeScript check: clean, exit 0.
- Independent installed-Chrome normal-route diagnostic: **three failed assertions**, normal exit 1: missing stylesheet, unguarded app-chrome navigation, and failure to open a saved-only review entry. The same diagnostic records draft request count as informational, not a test of an exact request count (development StrictMode may repeat mounts).
- Script: `docs/qualification/piano-workspace-phase-07-review/check-integration.py`; results: `integration-results.json` alongside it. Controlled API routes, extracted long draft, no real lesson mutation. Run from repository root with `.venv-saas/Scripts/python.exe` and Vite on 127.0.0.1:5173.
- Inspected submitted screenshots and route script. The submitted narrow capture itself shows stale "this harness has no save" copy and an unstyled workspace; zero page overflow is not proof of a working editor layout.
- 471 web tests, original eight probes and Phase 6 browser regression results remain developer-reported for this review. They do not establish normal-route lifecycle correctness.
- Physical touch qualification, new-private-revision entry journey and the compact settings flow are openly missing. Those gates have not been waived.

## R1 — load and qualify the actual workspace styling (high)

`apps/web/src/workspace-harness.tsx:5` is the only source import of `music/workspace/workspace.css`. Neither normal route nor the shared workspace imports it.

Independent normal-route browser results: workspace stylesheet **not loaded**, `.ws-grid` computes to **display:block**, and roll note fill is **black** instead of the workspace styling. The narrow sticky inspector happens to get inline styles, but the grid, selected/sounding visual distinction, responsive toolbar, gesture touch-action, focus-ring and reduced-motion CSS are not established on this entry point.

Required: load the shared component styles from a shared boundary, scope formerly harness-global rules such as `body` so they do not reset the rest of the app, and rerun desktop/narrow layout against the normal application entry. Assert actual computed grid/layout, selection versus sounding colours, toolbar/inspector bounds and pointer/touch behaviour, not just scrollWidth. Test the original video-over-header problem with loaded media and the real app header.

Finish visible copy cleanup too: `workspaceStatus` still says the harness has no save after editing; offset says "not saved"; alignment says unsaved until Phase 5; roll text still calls dragging Phase 6. The submitted capture contradicts the handoff's broad language-cleanup claim. Replace these with accurate product state and controls.

## R2 — restore application-wide dirty and delayed-save protection (high)

`MusicDraftReview` receives `onDirty` from LibraryApp, but does not forward workspace dirty changes. `PianoWorkspaceHarness` has no dirty callback prop. `MusicLessonEditor` likewise does not connect workspace dirty state to app navigation. Only the workspace's own Back button asks for confirmation.

Independent reproduction: open normal piano review, edit one pitch, click app **Form home**. No dialog appears and the workspace unmounts. The app's `navigate` and popstate guard depend on its separate `dirty` value, which stays false. A debounced recovery checkpoint is not a substitute for guarding navigation.

A related save regression is code-inspected: workspace `save` invokes `onSaved` **before** comparing the submitted signature with the live signature. Both normal wrappers use that callback to refresh and navigate out of the editor. Saving snapshot A, making edit B while A is pending, and resolving A can therefore navigate away from B even though the Phase 5 workspace correctly knows B is unsaved. Parent callbacks also unconditionally clear dirty state.

Required: share dirty state with the app router for initial and revision editing; preserve Back, app chrome, browser history and reload protections consistently. Give save callbacks explicit snapshot/current-work semantics, and do not auto-navigate or clear the current dirty state for an earlier acknowledged snapshot. Add bounded normal-route delayed-success/failure tests, with edit B retained in the mounted workspace and recovery, and a successful-current-save navigation test. Cover title, offset, anchors and settings edits as well as pitches.

## R3 — use one loader/document boundary and the real music-manifest contract (high)

The wrappers still execute their old editing hooks and retain independent events/notation state before returning the shared workspace:

- MusicDraftReview loads a draft, performance arrays, verification state and preview hooks; its child separately loads a draft/reference and maintains another document.
- MusicLessonEditor downloads, hashes/parses and builds a score plus note arrays, then the child repeats saved-reference loading and score state.

This violates the phase's single-authority requirement, even where the old DOM is hidden. The development diagnostic sees four draft GETs; StrictMode may repeat mounts, so do not treat four alone as a production performance count. The duplicate loaders/state are explicit in the source.

It also breaks the accepted saved-only lifecycle: MusicDraftReview only mounts the workspace after a successful draft response. With an available saved manifest/reference and draft 404, the normal review entry shows the old error screen; the saved-reference coordinator never gets a chance to run. This was reproduced independently. The submitted reopen script intentionally leaves the draft available, so it misses that case.

Separately, the workspace coordinator/reopen path and MusicDraftReview's new refresh callback fetch music manifests with bare `request(...)`. `api.ts` does not add a default lesson-format header. The real server (`apps/api/lessons.py`, `client_formats` / `ensure_supported`) treats an unversioned client as v1-only and returns **406** for music without `X-Lesson-Formats: 1,2`. MusicLessonEditor's outer loader sends this header, but the child's loader does not. The mock World ignores this server rule, masking failed saved loads/refreshes.

Required: establish a shared route/controller loader or pass validated loaded data into the workspace; remove dormant piano editing authorities/hooks from the guitar/subject dispatcher. Use the versioned manifest contract consistently. Test saved-only with no proposal, slow/late/failed proposal response, legacy saved notation fallback, explicit manifest failure, and initial review -> complete returned manifest -> actual preview navigation. Use fixtures valid under `parseMusicLessonManifest`, not just minimal objects accepted by raw child loading; enforce format negotiation in mocks.

## R4 — preserve teaching, assessment and verification capabilities (high)

The piano early returns remove the old teaching-section, assessment, diagnostics and verification controls from the rendered tree. They do **not** remain accessible in their existing panels, contrary to the handoff wording.

The workspace only retains saved sections/assessment metadata on reopen; it provides no setters/controls for them. A new draft save defaults to a whole-clip section and watch-only assessment in `buildSaveBody`. The old route's accepted verification events/decisions are held in the parent, while the workspace independently rebuilds from the proposal. The child only has a token/conflict path, not a diagnostic decision/reconciliation UI. Do not assume those independent event arrays are interchangeable.

Required: build the planned compact settings flow with teaching sections, assessment and diagnostics; preserve existing validated values and make changes dirty/confirmation-resetting, recoverable and saveable. Retain verification decisions/token semantics and demonstrate accepted/rejected suggestions, concurrent decisions and 409 resolution without losing authored notation. Retain explanation/playing passage editing or an explicit usable equivalent. Do not remove functioning piano capabilities merely because their previous forms are hidden. Guitar should remain on its compatible path.

## R5 — finish focus ownership and real navigation evidence (medium)

The new focusin/outside-pointer bookkeeping prevents document undo when focus is outside. However, the global handler still calls `event.preventDefault()` for undo/redo **before** checking workspace ownership. It can consume keyboard shortcuts belonging to unrelated app UI even when it does not mutate this document.

Required: return before consuming the event unless the workspace owns the shortcut; then enforce mode/typing-field restrictions. Test keyboard-only entry, focus transfer to chrome/dialogs, contenteditable/native inputs, outside shortcuts not prevented, and re-entry. Keep Escape/Enter mode handlers similarly scoped when embedded with other UI.

The submitted route script drives only the draft-review URL and a manually reopened reference; it does not drive the library's actual create-private-revision entry or a revision POST from that entry. Complete that journey, including base_revision_id, clean save, delayed saves, conflict/recovery and release/access semantics. A mount claim cannot replace this acceptance evidence.

## R6 — complete usable responsive layout and physical qualification (required gate)

Emulated pointer dispatches are useful component evidence but do not exercise browser gesture arbitration, inertia, pinch behaviour or physical hit targets. `touch-action:none` on notes can intercept a swipe even when the first touch only selects. No tested physical device is available here; this review cannot certify it.

First fix R1-R5 and produce a styled, usable mobile build. Then arrange a hardware run by the owner/developer/device lab. Record device/OS/browser, viewport/orientation, tested commit and results for:

- Empty-space pan and swipe over unselected/selected notes: no accidental edits while navigating; deliberate pitch/time/resize edits work.
- Pointer cancellation/loss, two-finger interaction, rotate/reflow, Escape/numeric alternatives where available, undo/redo and no stuck audition.
- Both roll and score remain reachable with the keyboard/video/inspector; the bottom sheet and toolbar do not cover the selected note or essential controls. A sticky computed style alone is not usability evidence.
- Loaded video playback/seek/rate and both cursors; no overlap with app header or duplicated transport.
- Review confirmation, save, reload/reopen, recovery and unsaved navigation at narrow width.

Physical touch evidence remains mandatory under the original Phase 7 gate. Do not silently replace it with an emulation pass. If hardware is unavailable, submit corrected code and explicitly leave this item BLOCKED for a separate hardware run; Phase 8 still waits for final Phase 7 acceptance.

## Resubmission

Address R1-R5, then submit route-level regression evidence and hardware qualification R6. Preserve Phase 6 command/history/timing tests. Use a full valid manifest and realistic network failure/format semantics. Add app-navigation and delayed-save checks alongside the existing local Back check. Keep initial review, saved-only edit, library revision creation and guitar flows distinct in the evidence.

The performance numbers currently represent a controlled dev-server run with mocked requests and no proof of playable video; report them with that scope and remeasure styled interactive behaviour and supported upper-bound fixtures. No release or deployment is authorized by this review. No product code or Git branches were changed during review.
