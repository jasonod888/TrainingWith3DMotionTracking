# Act platform consolidation evidence ledger

Status: Phases 0–8 have landed shared-service owners in the working tree. Phase 5
(document commands, selection, alignment, verification, playback and specialist
presentation separation inside `PianoWorkspaceHarness`) has its required owners,
migrated review callers and specialist views in place. The final four Phase 5 gaps
(save generation/unmount guards, hash-verified open/restore with stale-apply guards,
selection/recovery ownership completion, and shared `editorSession` hydration/dirty
sync) are closed; the only remaining Phase 5 work is optional fine-grained splitting.
Phase 8 (full mounted production editor → review → publish → discover → practice
journeys beyond the shared-service conformance suite) remains open. Automated evidence
is recorded below. This ledger does not claim live browser/device acceptance,
before/after performance measurements, PostgreSQL migration/query acceptance, or a
qualified CPU MediaPipe corpus.

## 1. Automated baseline (this working tree)

| Gate | Status | Evidence |
| --- | --- | --- |
| Act API tests | passing before this phase | `test_acts`, `test_lesson_negotiation`, `test_publication_neutral`, `test_social_engine`, `test_drawing_act` |
| MediaPipe API / focused-video | passing before this phase | `tests/api/test_mediapipe_pipeline.py`, `tests/avatar/test_focused_video.py` |
| Web Act/platform tests | passing before this phase | registry/context/social/editor/policy/mediapipe suites |
| Type/build | passing before this phase | `npm --prefix apps/web run build` |
| Contract artifacts | passing before this phase | `python -m apps.api.export_lesson_schemas --check` |

**Deferred acceptance gates (not established by the commands above):** live
PostgreSQL migration/query plans; a representative CPU MediaPipe corpus with visual
qualification; physical camera/MIDI/microphone teardown; and before/after browser
performance measurements (frame, memory, request and build budgets). Phase 0 records
them as pending, never as passing.

## 2. Ownership and caller ledger (R1–R8)

| ID | Current owner(s) / active callers | Target single owner | Migration / compatibility | Removal criteria |
| --- | --- | --- | --- | --- |
| **R1** | `lessons.effective_capabilities`, `social._action_set` (retired), `publication.py`, `editor_lifecycle`, TS registry support, `act-capabilities`, `publication-readiness` | `apps/api/acts.py` for catalogue facts; new `apps/api/policy.py` for pure action/capability decisions; `publication.py` for role eligibility | **Done in Phase 1:** detail/summary/discovery/editor use `policy`; frontend support derives from generated `act-descriptors.json`; public video-only has `landmarks=null`, watch-only. Preserve existing reason codes/support fields and v1/v2 summaries. | Remove legacy duplicated capability branches only after parity fixtures stay green and no old client depends on the retired reason strings. |
| **R2** | `LibraryApp` open/restore/public/Studio callbacks; `LessonExperienceHost` dispatch; registry `loadPractice` | `LessonContext` + `lesson-opener.ts`; registry `practiceEntryFor()` owns literal lazy loaders | **Done:** all shell opens use `createLessonOpener()`; host invokes registry loaders; `useLibraryPages()` owns owned-library paging. Preserve route IDs, public/demo markers, sign-in returns. | Retire independent body/music/drawing setters after all callers/URL tests remain green. |
| **R3** | `PianoWorkspaceHarness`, body/music practice screens | Specialist tools plus `useMusicWorkspaceDocument`, `useMusicEditorSelection`, `useMusicAlignmentEditor`, `useMusicVerificationController`, `useMusicEditorPlayback`, `useMusicReviewLoad`, `useMusicReviewSave.ts`, `useMusicReviewRecovery.ts`, `editor-services.ts`, and the specialist views below | **Done for the required Phase 5 separation:** document/history, selection/transient modes/gesture commands, alignment, loading/reopen, recovery checkpoints, verification transactions, editor playback/audio, save/conflict, topbar, note inspector, verification panel and major settings sections all have dedicated owners wired to the review root. Save and reopen are generation-guarded; the shared `editorSession` tracks hydration, edits and undo-to-clean. Practice imports none of these editor owners. | Retire the remaining lesson/timing/more inline sections only if later extraction adds equivalent mounted coverage; no duplicated editor controller or recovery state is retained in the review root. |
| **R4** | Body/music practice each assemble guard/resources/attempts; listen/play and challenge repeat capture orchestration | `usePracticeAccessGuard.ts`, `submit-attempt.ts`, `capture-job.ts` | **Done:** body, piano/guitar and drawing practice use the shared guard/submission; capture lifetime is one helper. Keep one runtime clock. | Remove remaining per-screen cleanup/capture branches after access-loss tests cover both Acts. |
| **R5** | Body/music/drawing sharing and drawing editor publish | `usePublicationController.ts`; `publication.py` remains release authority | **Done:** all four publishing entry points use readiness/roles/mutations/invalidation through the controller. Preserve Act-specific previews and audience restrictions. | Retire repeated update/unlist/invalidation blocks only after all entry-point tests stay green. |
| **R6** | SAM and MediaPipe worker handlers repeat upload/completion | `saas_worker.py` `publish_required_artifacts`, `publish_optional_derivatives`, `complete_pipeline_job` | **Done:** both adapters use coherent dependent-output invalidation; alpha never uploads without focused. Preserve pipeline identities, MP-1/2/3 and playback duration. | Retire duplicated upload/finish blocks after both pipelines pass worker acceptance fixtures. |
| **R7** | Source-string/wiring tests can pass while mounted behavior is bypassed | Behavioral/mounted tests + parameterized conformance | **Partially open:** shared-service conformance, policy parity, opener/controller/guard/submission tests exist; full mounted production editor → review → publish → discover → practice journeys are still pending. | Retire helper-name assertions as mounted journey coverage replaces them. |
| **R8** | Reference maps, broad refreshes, playback snapshots into large React components | Bounded SHA-256 cache + pager/render budgets | **Done:** cache is LRU + byte-budgeted, supports pins and oversized bypass; `createLibraryPager` remains the paging owner. | Add broader render budgets only after measured baseline; remove ad-hoc refreshes when cohesive bindings land. |

### Classification

- **Live fallback:** legacy body progress endpoint/table; invitation/link/group access; body v1 summary compatibility; `MusicLessonHome` fallback for non-piano/guitar music subjects; `music-practice.ts` test-only historical controller; `MusicDraftReview` flag-gated/reachable only through explicit legacy flag.
- **Tests-only historical code:** `music-practice.ts` is imported by its historical test only; it is not deleted while that test remains.
- **Dead production code:** `MusicLessonScreen` export and `public.listing_item` were already retired in earlier phases; no new deletion is made without a zero-caller proof.
- **Generated:** schema artifacts and the new Act descriptor artifact; never hand-edit their facts independently.

## 3. Phase 1 descriptor drift check

`packages/lesson-schema/act-descriptors.json` is generated from `apps/api/acts.py` by
`export_lesson_schemas.py`. `--check` fails on any descriptor
drift. `apps/web/src/acts/registry.ts` imports only these data facts; executable
lazy loaders remain local literal imports.

## 4. Phase 1 R1 closure

- Detail/summary/editor use `apps/api/policy.py`; discovery uses the same
  `action_set` with the projected roles.
- `publication.publishability()` remains the editor/release authority; policy
  reuses `publication.role_assets()` for representation eligibility.
- Public video-only projects `landmarks: null`; client context forces watch-only
  even without explicit server capabilities.
- The stale blanket `animation is None -> video_only` capability block is retired.
- Shared fixtures live in `packages/lesson-schema/policy-parity-fixtures.json`
  and are exercised by Python and TypeScript.

## 5. Exact current owners and migrated callers

- Shell opening/paging: `lesson-opener.ts`; `LibraryApp` uses `applyOpenedContext`
  and `refreshOwned` (targeted owned refresh), and `useLibraryPages.ts` owns the pager.
- Review save/recovery: `useMusicReviewSave.ts`, `useMusicReviewLoad.ts` and
  `useMusicReviewRecovery.ts` + `editor-services.ts`/`recovery.ts`; the workspace consumes
  the hooks while specialist notation tools remain local.
- Music capture: `useListenPlay.ts`, `useMusicChallenge.ts` and uploaded assessment use
  `createCaptureJob()` for generation/abort/handles/stale results.
- Practice: `usePracticeAccessGuard.ts`, `submit-attempt.ts` are the shared owners.
- Release: `usePublicationController.ts`; `publication.py` remains authoritative.
- Worker: `saas_worker.py` shared required/optional completion helpers.
- Reference cache: `lesson-context.ts` bounded pinned LRU with real checksum checks.
- Conformance: strict-parser `act-conformance.test.tsx`, policy parity and focused
  controller/opener/guard/submission tests.

## Phase 5 workspace separation inventory

**Actual callers/exports:** `PianoWorkspaceHarness` is exported from
`apps/web/src/music/workspace/PianoWorkspaceHarness.tsx` and consumed by
`PianoReviewWorkspace` (the review composition root), `MusicReviewRoute.tsx`,
`workspace-harness.html`, and the mounted workspace review/save/persistence tests.
Compatibility `mode='practice'|'challenge'` delegates to `PianoPracticeWorkspace`.

**Baseline line counts:** `PianoWorkspaceHarness.tsx` 3644,
`PianoPracticeWorkspace.tsx` 848, `PracticeWorkspace.tsx` 773,
`MimicInterface.tsx` 538.

| Mutable domain | Target owner |
| --- | --- |
| Document/history/selection | `workspace-state.ts` reducer via a document controller |
| Authored sidecars (title, sections, feedback, pedal, guitar) | typed editor draft aggregate |
| Load/revision/reference identity and saved baseline | `useMusicReviewLoad` + immutable baseline |
| Alignment passages/spans/anchors/offset | `useMusicAlignmentEditor` (serialized through `save-payload`) |
| Inspection, gestures, temporary inspector input | `useMusicEditorSelection`; panel-local where possible |
| Verification findings/token/transactions | `useMusicVerificationController` using `verification-transaction.ts` |
| Playback/audio/media/visual clock | `useMusicEditorPlayback`; one authoritative media clock |
| Save/conflict/message state | `useMusicReviewSave` |
| Recovery checkpoint | recovery coordinator using `recovery.ts` identity checks |
| Layout/drawer/panel visibility | presentation components/local state (never dirty) |

Browser/device layout and frame measurements remain pending until real browser runs.

### Phase 5 final ownership (Slices A–J)

**Production owners**

- `useMusicReviewLoad.ts`: validated draft/saved-revision loading, hash-verified
  `reopenSaved()` on the same generation/abort owner, reference pin/unpin, stale-apply
  refusal and one accepted initialization.
- `useMusicWorkspaceDocument.ts`: reducer dispatch, replacement epoch, undo/redo/reset.
- `useMusicEditorSelection.ts` + `MusicNoteInspector.tsx`: committed selection plus
  inspector facts, guitar position/fret editing, hand/velocity/duration controls,
  replace/pitch-pick/add/fret modes, reveal token, mode focus and selection element
  references, gesture→command translation, and the add-note placement panel. The review
  root consumes these instead of keeping duplicate mode/focus/reveal state.
- `useMusicReviewRecovery.ts`: checkpoint offer/stale/notice state, identity-scoped
  delayed read, debounced write, clear/discard and validated restore coordination over
  `recovery.ts`; the root only applies a parsed checkpoint to its authored sidecars.
- `useMusicAlignmentEditor.ts`: spans, anchors, offset, saved map and anchor undo/redo.
- `useMusicVerificationController.ts` + `MusicVerificationPanel.tsx`: findings,
  exact server token, decisions, rollback, accepted baselines and the conflict banner.
- `useMusicEditorPlayback.ts`: media attachment, commands, preview verification, one
  visual clock mirror and cleanup.
- `useMusicReviewSave.ts` + `editor-services.ts`: immutable save snapshot, older-
  snapshot dirty retention, next-save base revision, 409/verification classification,
  and save generation/unmount guards so a delayed lesson-A response cannot mutate
  lesson-B state or call `saved`/`conflict`/`onSaved`.
- `createEditorSession` shared lifecycle: hydration records the exact saved revision id
  (or the unreviewed draft state), ordinary edits call `markDirty()`, and undo back to
  the baseline restores the clean current identity without fabricating a revision.
- `MusicReviewHeader.tsx`: `header.ws-topbar` title/status/undo/redo/settings/review.
- `MusicReviewSettings.tsx`: view/display, editing, guitar setup, sound, reference-video
  controls and guitar chord shapes. The persistent `<video>` stays in the root PiP host,
  so opening/closing the drawer never remounts source media.

**Migrated callers**

`PianoWorkspaceHarness.tsx` (`PianoReviewWorkspace`) composes the owners above and
passes narrow typed props to the specialist views. `MusicReviewRoute.tsx`,
`workspace-harness.html` and the mounted workspace suites remain the production/test
callers. `PianoPracticeWorkspace` continues to import its own practice stack through
`PracticeEntry.tsx`; no new editor controller or review panel enters Practice.

**Retired root code**

The inline topbar, note inspector/guitar editor, verification findings list/rollback,
add-note placement panel, all settings-drawer sections (view/editing/guitar/sound/
video/chords/insert/timing/more/lesson), chord-shape editor and their local helpers
(`NumberField`, `DURATION_CHOICES`, `SNAP_CHOICES`, `displayPieceTitle`) were removed
from `PianoWorkspaceHarness.tsx`. The root keeps the drawer shell/nav, review dialog,
add-note menu and route/load orchestration.

**Phase 5 regressions fixed**

- Roll pitch drag now uses the stable shared gutter, so a pitch edit cannot look like an
  onset shift.
- Native play and workspace transport both clear temporary follow suspension and reveal
  the offscreen playhead through the playback owner's coarse `playing` state.
- The dock `Video` action opens the reference drawer instead of toggling PiP, so the
  source element is not replaced.
- The Space transport listener re-binds when the media element becomes available and
  still rejects repeats, modifiers, composing events, outside focus/targets, hidden
  workspaces and interactive targets.

**Phase 5 final gap closures**

1. **Delayed save isolation.** `useMusicReviewSave.ts` owns a monotonic save generation
   and mount flag. Lesson/session changes and unmount invalidate an in-flight save and
   clear its transient state, so a delayed lesson-A response never calls
   `editorSession.saved/conflict`, `onSaved`, or mutates lesson-B state.
   Regression coverage: `music-review-save.test.tsx` (lesson switch and unmount).
2. **Hash-verified, cancellable reopen.** `useMusicReviewLoad.ts` exposes
   `reopenSaved()` sharing its generation ref, `AbortController`, reference pinning and
   `loadReferenceValue` SHA-256 verification, then parses with `restoreFromReference`.
   `PianoWorkspaceHarness` no longer fetches the reference directly; `reopen()` captures
   the pre-reopen workspace signature and refuses to apply when newer local work or a
   lesson switch invalidates the response. Regression coverage:
   `music-review-load.test.tsx` (tampered hash, delayed local edit, lesson switch).
3. **Selection and recovery ownership.** The review root consumes replace/add/pitch-pick/
   fret modes, reveal token, mode-focus and selection-element refs, and gesture→command
   translation from `useMusicEditorSelection`; checkpoint state and delayed
   read/write/clear/restore/discard behavior live in `useMusicReviewRecovery.ts`. No root
   duplicate state remains for those domains. Regression coverage:
   `music-editor-selection.test.tsx` and `music-review-recovery.test.tsx`.
4. **Shared session truth.** Unsaved drafts no longer start as
   `{state: 'saved-private', reviewed: true}`. Hydration records the exact saved revision
   id or puts the session in its unreviewed draft state; ordinary edits call
   `markDirty()` and undo-to-clean restores the current clean identity. The mounted shell
   exposes `data-session-dirty`/`data-session-state`/`data-session-revision` alongside
   `onDirty`. Regression coverage: `workspace-save.test.tsx` (draft and saved-revision
   hydration → edit → undo).

**Evidence and open gates**

Focused mounted suites cover gestures, overview/follow, save/reopen/conflict,
phase-2 contextual editing, piano/guitar integration, persistence and practice
boundaries; production `tsc --noEmit`/`vite build` and the full web suite are run by the
orchestrator on the final tree. Phase 8 mounted editor → review → publish → discover →
practice journeys, real browser/device frame, media, focus, camera/MIDI/microphone and
teardown acceptance, before/after performance measurements (frame, memory, request and
build budgets), a live PostgreSQL migration/query run, and a representative CPU
MediaPipe corpus with visual qualification remain explicitly open; mocked or build-only
evidence does not close them.

## 6. Verification commands
```powershell
.venv-saas\Scripts\python.exe -m pytest -q tests/api/test_policy_consolidation.py
.venv-saas\Scripts\python.exe -m pytest -q tests/api/test_acts.py tests/api/test_mediapipe_pipeline.py
.venv-saas\Scripts\python.exe -m apps.api.export_lesson_schemas --check

npm.cmd --prefix apps/web test -- --file tests/policy-parity.test.ts
npm.cmd --prefix apps/web test -- --file tests/lesson-context.test.ts --file tests/public-act-rendering.test.tsx
npm.cmd --prefix apps/web test -- --file tests/music-review-save.test.tsx --file tests/music-review-load.test.tsx --file tests/music-review-recovery.test.tsx --file tests/music-editor-selection.test.tsx --file tests/workspace-save.test.tsx
npm.cmd --prefix apps/web run build
```

Deferred: Phase 8 mounted end-to-end journeys, live PostgreSQL plans, the CPU MediaPipe
corpus with visual qualification, physical-device and browser/device teardown, and
before/after browser performance measurements.
