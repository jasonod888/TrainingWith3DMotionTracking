# Phase 5: Detailed Workspace Separation Plan

Date: 19 November 2026  
Status: implementation handoff; remaining work is open. This document changes no application code.

Parent: [Act Platform Consolidation and Reuse Plan](act-platform-consolidation-plan.md), Phase 5. Read [AGENTS.md](../AGENTS.md) and the [architecture/reuse guide](act-platform-guide.md) before implementing.

## 1. Outcome and scope

Turn the current music review workspace into a composition of focused controllers and specialist views. Keep the existing Editor, Practice, and Social boundaries, current product behavior, and shared piano/guitar foundations. The main workspace should coordinate those owners rather than implement document commands, verification, selection, transport, persistence, and every panel itself.

The main target is `apps/web/src/music/workspace/PianoWorkspaceHarness.tsx`, whose production `PianoReviewWorkspace` contains those responsibilities. The name "Harness" and its old header comment do not make it disposable development code: production review and regression tests use it. Preserve its exports and callers until a deliberate migration retires them.

The existing `useMusicReviewSave.ts` extraction is completed groundwork, not the whole phase. Its older-snapshot dirty-state fix, exact lesson-scoped API endpoints, conflict preservation, and existing tests must survive all further extraction.

Secondary scope is the boundary between the extracted music editor and `PianoPracticeWorkspace.tsx`, `PracticeWorkspace.tsx`, and `MimicInterface.tsx`. Give those touched boundaries narrow inputs and preserve cleanup. Do not use this phase to redesign all body/drawing editors or add singing/acting features.

### Required versus optional

| Required to close Phase 5 | Optional follow-up |
|---|---|
| Separate document commands/history, selection/inspection, alignment authoring, verification, playback coordination, loading/recovery, and major presentation responsibilities from the root view. | Rename stable public exports or move the entire directory tree. |
| Wire real production callers to the separated owners; remove the superseded implementations. | Fine-grained splitting of small cohesive specialist panels after the major responsibilities are separated. |
| Preserve asynchronous save identity, undo behavior, keyboard/focus, supported piano/guitar tools, URLs, and lazy boundaries. | New UX, new tools, scoring changes, a new state-management dependency, or different history semantics. |
| Produce focused behavior evidence and inspect render/subscription costs for the changed paths. | Full application performance optimization beyond the Phase 5 extraction; that remains Phase 7 work. |

File size is supporting evidence only. A small root backed by an equally monolithic hook, a giant untyped context, or duplicated state is not completion.

## 2. Current resources to reuse

Paths in this table are relative to `apps/web/src/music/workspace/` unless fully qualified. Inspect current callers before adding another module; suggested target names later in this plan are provisional.

| Responsibility | Reuse |
|---|---|
| Document changes and bounded undo/history | `workspace-state.ts`: `WorkspaceState`, `WorkspaceAction`, `workspaceReducer`, `createWorkspaceState`, history identity/summary; `packages/music-notation` commands and parsing |
| Document patching | `document-patch.ts` and existing notation command functions; preserve current patch semantics |
| Save payload, identity, reopen | `save-payload.ts`: `buildSaveBody`, `restoreFromReference`, canonical anchors/alignment, performance fingerprints, insertion placement |
| Save requests and conflict state | `editor-services.ts`, `useMusicReviewSave.ts`; shared `apps/web/src/editor/editor-session.ts` and `revision-handoff.ts` |
| Verification transactions | `verification-transaction.ts`: accepted baseline/prepare/invert operations; `apps/web/src/music/verification.ts` API/parser functions |
| Local recovery | `recovery.ts`: identity checking, read/write/clear, sanitization/salvage |
| Alignment and geometry | `timeline-layout.ts`, `viewport.ts`, `gestures.ts`, existing music-notation alignment/anchor functions |
| Clock and audio | `clock.ts`, `usePianoSourcePlayer`, `usePianoPerformanceAudio`, `usePianoPreviewAsset`, `NotationAudio` |
| Hand assignments | `useHandAssignments.ts` and notation helpers; do not create another independently editable hand map |
| Specialist surfaces | `TimeRoll`, `ContinuousScore`, `FormattedScore`, `ClipOverview`, `PianoWaterfall`, `KeyboardEditor`, `GuitarNeckGuide`, `GuitarChordStrumHud` |
| Instrument facts | `instrument-adapters.ts`, `guitar-chords.ts`, `packages/music-notation/guitar.ts` |
| Shared UI | `apps/web/src/ui/controls.tsx`, tokens/styles, `PracticeSettings.tsx`, `PracticePanel.tsx`, existing dock/settings components |
| Shared policy/session/publication | Existing Act policy, practice access/capture/attempt services, and publication controller; Phase 5 must not replace these |

Do not move specialist algorithms into generic Editor lifecycle code. The shared lifecycle answers dirty/review/release questions; it does not edit music or understand verification findings.

## 3. Target ownership and dependency direction

```text
Existing review route / compatibility export
  -> Music review composition root
       -> load/recovery coordinator
       -> document/history owner
       -> selection/inspection binding
       -> alignment authoring owner
       -> verification coordinator
       -> editor playback binding
       -> immutable save snapshot + existing save/session services
       -> specialist stage, panels, dialogs and shared controls
```

Views receive small typed models and commands. Controllers depend on domain functions and shared services, not on view components. Specialist renderers do not import the composition root. Practice entries do not import editor controllers or panels.

### State ownership ledger to complete before moving code

| State | Canonical owner | Important constraint |
|---|---|---|
| Current notation document, committed selection, past/future command history | Existing `WorkspaceState` through one document controller | Keep selection in the existing reducer where history semantics require it; a new selection hook must not duplicate it. |
| Title, sections, feedback/assessment policy, pedal and guitar authoring data | Typed editor draft aggregate, using existing domain types | Include all persisted authored fields in save/dirty/recovery identity. Preserve existing instrument-specific history rules. |
| Loaded revision/draft/reference identity and accepted baseline | Load/save coordinator and immutable baseline | Lesson ID is not revision ID. Loading a lesson does not itself accept/review it. |
| Alignment passages, spans, anchors, offset, alignment undo state | Alignment authoring owner | Preserve present separate/grouped undo semantics; do not silently merge history domains. |
| Inspector text drafts, pitch/fret pick, add/replace modes, focus targets | Selection/inspection binding and relevant panel-local state | Temporary text is not a committed document edit until the existing commit action runs. |
| Findings, verification token, decision operations, pending rollback | Verification coordinator | Keep server transaction identity and cancellation separate from ordinary local note commands. |
| Media elements, audio instances, playback state, visual clock | Editor playback binding | Media remains authoritative. Visual subscribers mirror it; they do not advance another clock. |
| Drawer/panel visibility and responsive placement | Presentation components or a small layout binding | Pure UI state does not make a lesson dirty or trigger reference reload. |
| Saving/conflict/message state | Existing `useMusicReviewSave` | Current snapshot and saved baseline must remain distinct during an asynchronous save. |
| Recovery checkpoint and availability | Recovery coordinator using `recovery.ts` | Match account, lesson, draft/reference and revision identities before restoring. |

An initial immutable loaded payload may initialize these owners. It must not become a second continuously synchronized copy of the editable document. Temporary bridging callbacks must have explicit removal tasks.

## 4. Contracts and asynchronous invariants

Use existing exported types rather than rewriting similar interfaces. Introduce a narrow type only where a new boundary needs one; keep domain-specific types near their owner, not in a giant catch-all model.

### Boundary contracts

- **Loaded review result:** exact account/lesson/draft/revision/reference identity, validated document, alignment/spans/anchors/offset, authoring metadata, instrument data, and verification baseline/token. Distinguish first draft review, existing saved revision, read-only content, and recoverable loading failure.
- **Document controller:** read-only current state/selectors plus existing typed command dispatch, undo/redo, selection, and explicit document replacement. Do not export unrestricted setters for all internals.
- **Inspector binding:** derives selected-note facts, resolves occurrence identity, manages temporary input/pick state, and emits document commands. Panels receive only fields/actions they use.
- **Alignment controller:** exposes current alignment inputs, derived layout, and typed anchor/span/offset commands with current validation/history semantics.
- **Verification controller:** finding models and commands carrying the exact current document/reference/token identity; generation and abort ownership; an explicit way to apply an accepted transaction through the document/alignment owners.
- **Playback binding:** shared visual clock, media refs or registration callbacks, play/pause/seek/rate/volume/mode commands, and coarse playback state. It accepts the document/alignment snapshot it renders without owning another editable document.
- **Save snapshot:** immutable typed data captured at save start plus canonical signature and base identity. Build the wire payload with `buildSaveBody`; send it through existing services. Document changes after capture must not mutate the submitted snapshot.
- **Views:** typed model/command props, using `Pick` or narrow interfaces as needed. Avoid `any`, `as never`, an unrestricted dispatch string, or passing the entire workspace object to every panel.

### Invariants every extraction must preserve

1. One canonical owner per mutable fact and one advancing media/session clock. Existing visual update loops remain observers.
2. A callback from an older account, lesson, revision, document epoch, verification token, or canceled request cannot overwrite the current editor.
3. A save may advance the saved base revision even when newer local edits exist. It cannot mark those edits clean, reviewed, or released. A follow-up save must use the actual latest saved base without discarding the newer work.
4. Dirty identity includes existing persisted sidecars, not just the reducer's note history: title, sections, alignment, feedback, pedal, and guitar chord/setup changes where currently persisted.
5. Document replacement reconciles selection and clears incompatible transient/pending state. Mere layout changes do not replace the document, reset undo, seek media, or reload references.
6. A verification decision that changes content is one coherent transaction under the existing rules. Late server results cannot reapply it after undo, reset, or lesson navigation.
7. Cleanup is idempotent, safe during pending acquisition, and correct on effect rebind as well as unmount. Development effect setup/cleanup repetition must not destroy a new active owner.

## 5. Detailed implementation sequence

Each step is a reviewable slice. Keep a working production route and targeted tests green after every slice. Do not create all proposed hooks first and leave them unused. Never delete old behavior before its production callers have moved.

### 5.0 — Capture behavior and the real caller graph

**Work**

- Inventory route/harness exports and callers, including embedded/demo/read-only and any retained compatibility practice mode. Identify which branches actually run in production and which are test-only.
- Mark root state/effects/functions against the ownership ledger above. List cross-domain dependencies and which commands currently create undo entries.
- Record existing successful focused tests and gaps. Build exact URL/payload fixtures from current API routes; mocks must reject wrong paths instead of accepting any URL containing `music-revision`.
- Record representative desktop/narrow-height screenshots or browser traces for review, not new design targets. Note pending device-only results honestly.
- Establish before/after counters for cold editor requests, save requests, media subscriptions, clock-driven root renders, and mount/unmount resources. Use the same fixture/browser conditions throughout.

**Deliverable:** add a Phase 5 task/evidence section to the consolidation ledger with current owners, extraction targets, tests and pending acceptance. No extraction in this slice.

**Exit:** actual callers and state ownership are known; piano and guitar have real strict-parsed fixtures and baseline editing/save/reopen tests.

### 5.1 — Establish typed snapshots and pure derived selectors

**Reuse:** `workspace-state`, notation selectors, `save-payload`, existing canonical alignment and history identity.

**Work**

- Extract root-local pure derived calculations only when they have a real consumer: selected-note facts, dirty/signature composition, review summary/diff, and instrument display facts.
- Define the immutable save/baseline boundary from the fields already persisted today. Use existing canonicalizers and performance fingerprints; do not create another meaning of document equality.
- Document which histories are separate and how a grouped edit is represented. Retain existing byte/count limits.
- Preserve unit conversions and distinction between occurrence IDs, event IDs, written score time and performance/media time.

**Exit/tests:** pure selector fixtures cover add/delete/replace, repeated occurrences, written/performance timing, sidecar-only edits, undo back to baseline, and piano/guitar differences. Existing reducer/serialization tests stay unchanged unless a documented bug is corrected separately.

### 5.2 — Extract loading, hydration, baseline and recovery coordination

**Suggested owner:** `useMusicReviewLoad` and, only if needed, a focused recovery binding. Prefer extending current `editor-services.ts` and `recovery.ts` over creating replacement HTTP/storage services.

**Work**

- Move manifest/draft loading, reference restoration, strict parsing, account/reference identity, saved baseline initialization, read-only checks, recovery offer/salvage, and generation checks out of the view.
- Keep the existing independent draft/manifest reads and exact lesson-scoped endpoints. Do not silently turn authorization failures into an editable empty document.
- Return a validated immutable initialization result. A small composition-level hydration operation initializes document, alignment, instrument metadata and verification baseline together; transient partial loads must not be exposed as a valid editable session.
- Retain user-visible recovery choice and identity checks. Scope delayed checkpoint writes and responses to the originating editor identity; avoid overwriting another lesson's checkpoint.
- Reuse hash-verified reference loading and lease/pin ownership where currently applicable. A canceled load must never acquire a pin after cleanup has run.

**Exit/tests:** first draft, saved revision, invalid reference/hash, unavailable source, permission denial, stale A-to-B load, account change, valid/stale/corrupt recovery, guitar chord salvage, and canceled-load cleanup. Assert actual endpoint paths and one committed hydration per accepted load generation.

### 5.3 — Extract document commands and history ownership

**Suggested owner:** `useMusicWorkspaceDocument`, wrapping the existing reducer rather than replacing it.

**Work**

- Move reducer initialization/dispatch, document replacement epoch, command reports, history/undo/redo/reset and command-level validation behind one API.
- Route existing note pitch, duration/onset, add/delete/replace, hand, velocity, written spelling/timing, and applicable instrument edits through their current domain command functions.
- Preserve multi-event/occurrence selection semantics and verification transaction hooks. An edit rejected by the current domain validator must remain rejected and explain why.
- Do not convert transient inspector keystrokes into history entries. Preserve existing commit/group boundaries and memory limits.
- Retire root copies of dispatch helpers as callers migrate. Keep authored metadata/sidecars under an explicitly documented owner rather than mirroring the reducer document in another hook.

**Exit/tests:** command rejection, multi-selection, repeat occurrences, undo/redo/reset, history budget, sidecar-only dirty state, cross-document replacement, and dirty-to-clean baseline transitions. Shared editor session and navigation guard report the same unsaved state.

### 5.4 — Extract selection, inspection and gesture coordination

**Suggested owner:** `useMusicEditorSelection`, with panel-local input state where it does not need cross-panel lifetime.

**Work**

- Keep committed selection in `WorkspaceState`; expose derived selection views, not another independent selected-note store.
- Move contextual inspector facts, pitch/fret pick, add/replace modes, input draft/commit/cancel behavior, reveal tokens and selection-related focus references.
- Reuse `gestures.ts` for drag axis, snapping, pitch/onset/duration math, and existing piano/guitar geometry. Gesture outputs become existing document commands.
- Preserve keyboard shortcuts, text-entry exclusions, pointer cancellation, selection reconciliation after delete/undo/document replacement, and focus restoration to the actual trigger.
- Keep selection/reveal separate from high-frequency playhead movement: playback must not continually steal selection or scroll the chosen note out of view.

**Exit/tests:** keyboard/pointer selection, add/replace/cancel, typing and Enter/Escape/blur commit behavior, drag threshold/snap, repeated-note identity, delete-selected reconciliation, undo restoration, narrow-height inspector reveal, and guitar fret/string changes.

### 5.5 — Extract alignment authoring and timeline coordination

**Suggested owner:** `useMusicAlignmentEditor`; reuse notation alignment functions, `timeline-layout.ts` and `viewport.ts`.

**Work**

- Move spans/passages, anchors, global offset, alignment validation/history and authoring commands into one owner. Keep viewport/scroll-only UI state distinct from saved alignment data.
- Preserve clock conversions, held/explanation passages, mapping of written ticks to performance seconds, and existing anchor validation. Document which edits affect saved notation versus alignment alone.
- Coordinate selection/gesture requests through commands; do not let timeline renderers mutate persisted alignment directly.
- Recompute expensive layout only when its semantic inputs change. Do not add another timeline cache without measured need.

**Exit/tests:** valid/invalid anchors, global offset, passage edits, held/explanation segments, alignment undo/redo, trim/section boundaries, viewport follow/zoom, save/reopen equivalence, and malformed/recovered alignment. No drift between score cursor, roll, source media and saved reference.

### 5.6 — Extract verification and correction transactions

**Suggested owner:** `useMusicVerificationController`, built on `music/verification.ts` and `verification-transaction.ts`.

**Work**

- Move finding loading/parsing, pending decision state, prepare/apply/invert operations, accepted baseline, verification token and rollback requests out of the root.
- Receive typed document/alignment commands and exact current identity. Keep server decisions authoritative; preserve working local changes on 409 or failure.
- Cancel/invalidate pending decisions on reset, account/lesson/revision replacement, or incompatible document edits. Never commit a late prepared correction to a newer document.
- Keep save-readiness effects explicit: invalidated verification cannot be hidden by a generic "newer revision" message or be incorrectly cleared by local save state.
- Apply and invert findings using existing transaction semantics; do not move these operations into the generic Editor lifecycle reducer.

**Exit/tests:** accept/reject/invert, overlapping findings, decision rollback, local edits during a decision, stale token, read-only denial, network failure, reset/undo, and save after verification. Assert both local document state and the actual server request identities.

### 5.7 — Extract editor playback, audio and visual subscriptions

**Suggested owner:** `useMusicEditorPlayback`, composing current source/performance-audio/preview/clock helpers.

**Work**

- Move media node attachment, play/pause/seek/rate/volume/audio-mode commands, offsets, playback error and cleanup to the binding.
- Retain source media as authoritative. `createClock`/`useClockTime` remain visual mirrors; do not add a second advancing clock or import review workspace logic into Practice.
- Move clock-reading leaf helpers such as the live time label, keyboard highlighting, follow indicator and dock into small view modules where justified. Reuse existing live components instead of making duplicate versions.
- Preserve original/synthesized audio choice, alignment/offset synchronization, pedal and guitar program/setup handling. Guard late preview/audio acquisition with current identity and teardown ownership.
- Inventory compatibility `mode='practice'` branches and existing exports. Keep them behind the compatibility entry while needed; remove only after actual callers and tests migrate to `PianoPracticeWorkspace`.

**Exit/tests:** media readiness/error, pause/seek/rate/offset, original/synth audio fallback, held passages, preview replacement, repeated mount/unmount, lesson switch during audio load and bounded subscriptions. Show that playhead updates do not force unrelated inspector/document roots to render at frame rate.

### 5.8 — Extract specialist views, panels and responsive layout

**Candidate views:** `MusicReviewStage`, `MusicNoteInspector`, `MusicVerificationPanel`, `MusicReviewSettings`, and focused header/dialog components. Extend an existing panel when it already owns the responsibility; do not create every candidate just to match this list.

**Work**

- Compose `TimeRoll`, score components, clip overview, keyboard/waterfall and guitar renderers using typed view models/commands from the earlier owners.
- Separate display/layout state: panel visibility, compact mode, responsive placement, drawer settings tabs, return focus and trigger refs. Preserve existing labels, test selectors, DOM relationships and interaction behavior during mechanical extraction.
- Reuse shared UI controls/tokens/settings rather than duplicating markup/styles. Keep piano hand/pedal/velocity and guitar TAB/chords/tuning/capo surfaces explicitly specialized through current instrument adapters.
- Each panel receives only its required state/actions and appropriate clock access. Do not use a giant all-workspace context to avoid writing prop contracts. If scoped context is genuinely needed, justify its provider and subscription boundary.
- Move local presentation helpers like numeric fields or note facts to the nearest cohesive module only when they support these views. Avoid a miscellaneous helper directory.

**Exit/tests:** desktop/compact-height layouts, inspector/settings/add menus, focus restoration, Escape/keyboard behavior, disabled/read-only states, panel toggles without document dirtiness or reference reload, piano/guitar tool parity, and no accidental scroll/follow regression. Screenshots support behavior tests; they do not replace them.

### 5.9 — Complete save/review/dirty/recovery wiring across owners

**Reuse:** `buildSaveBody`, `useMusicReviewSave`, `createEditorSession`, revision handoff, recovery serializers and actual API endpoints.

**Work**

- Capture one immutable save snapshot from the current owners at request start. Validate chords/sections/notation/alignment with existing rules before sending it.
- Keep pending save, current edit signature, saved baseline and base revision distinct. After a successful older-snapshot save, preserve newer edits as dirty, update the valid next-save base, and keep appropriate review confirmation requirements.
- Ensure errors retain exact useful server detail and correctly distinguish verification conflict from stale revision where those recovery actions differ. Preserve local edits and recovery checkpoints on failure.
- Reconcile `EditorSession` snapshot, root `onDirty`, save/review button state, and recovery checkpoint identity after hydration, edit, save, conflict, undo and reopen. Do not initialize revision identity with a lesson ID or infer acceptance solely from loading a manifest.
- Route handoff/invalidation through existing services. Save remains private; no extraction publishes or changes the released pointer automatically.

**Exit/tests:** initial review versus private revision exact paths, 409 detail/recovery, 5xx, edits during save, second save after older-snapshot success, dirty undo-to-baseline, guitar sidecars, read-only state, verification-required save, and save/reopen round-trip. Assert both application navigation guards and the real shared editor session.

### 5.10 — Finish composition and audit touched practice/body boundaries

**Work**

- Reduce the root to accepted-load coordination, composing the owners/views, and existing route/parent callbacks. Remove displaced state/effects/helpers after import/caller verification; do not retain a second implementation as an undocumented fallback.
- Keep existing public exports and route query shapes. Optional naming cleanup can follow independently after callers migrate.
- Audit the touched `PianoPracticeWorkspace`, `PracticeWorkspace` and `MimicInterface` interfaces. Shared orchestration must continue through existing session/policy/resource services; editor extraction must not cause Practice to import editor document/verification state.
- Run body SAM/MediaPipe nullable-animation/public watch-only and drawing regression coverage where common lifecycle or controls changed. Do not refactor their specialist algorithms merely to create symmetry.
- Update stale source comments, owner map and the Phase 5 ledger. Record remaining compatibility paths with real callers and removal criteria.

**Exit:** root ownership is clear, no new shared workflow duplication, no unused extracted controllers, no untyped prop bridge, and no hidden editor import in practice.

### 5.11 — Acceptance and scope closure

- Run the focused matrix below, production type/build and bundle inspection on the exact final build. Repeat tests after substantive fixes; do not cite a test pass from before the last edit.
- Record actual browser desktop/narrow/mobile results for changed layouts, focus, pointer behavior, media/audio and cleanup. Keep unavailable device checks explicitly open.
- Compare requests, subscriptions and representative renders with 5.0. Distinguish a measured improvement from a structural change with no established performance gain.
- Close Phase 5 only when the required responsibilities have real production owners/callers and behavior evidence. Additional splitting inside an already cohesive panel is optional; the major ownership separation is not.
- Phase 5 mounted regressions contribute to Phase 8. They do not, by themselves, close the full production editor-to-social-to-practice conformance gate or the separate PostgreSQL/MediaPipe CPU acceptance gates.

## 6. Incremental delivery and rollback

| Slice | Content | Depends on |
|---|---|---|
| A | 5.0 inventory/evidence and 5.1 types/selectors | Current shared-service fixes |
| B | 5.2 loading/hydration/recovery | A |
| C | 5.3 document/history | A-B |
| D | 5.4 selection/gestures/inspection | C |
| E | 5.5 alignment/timeline | C-D |
| F | 5.6 verification transactions | C-E |
| G | 5.7 playback/audio | B, E; retain current integration until consumers move |
| H | 5.8 specialist views/layout | D-G; small leaf view extractions can accompany their owner |
| I | 5.9 save/dirty/recovery reconciliation and 5.10 root cleanup | B-H; save compatibility tests run throughout |
| J | 5.11 final evidence/closure | All applicable slices |

This is a delivery order, not a requirement to maintain two implementations until slice I. Each slice moves real callers and has a thin temporary bridge only when its next consumer cannot yet move. Record and remove that bridge in the dependent slice.

Keep each slice behavior-preserving and revertible through its existing entry/export. Do not combine it with dependency upgrades, database migrations, schema expansion, new Acts, default-pipeline changes, scoring changes, or a visual redesign. Reverting an extraction must preserve already-saved revisions/recovery identity and must not alter published data.

An implementation handoff for each slice should list owners moved, callers switched, old behavior removed, temporary bridges, exact tests/results, bundle effects, measured costs where relevant, and still-open acceptance. Do not mark a slice complete because its proposed filename exists.

## 7. Regression matrix and existing tests

Test names are relative to `apps/web/tests/`; verify their current fixtures/callers before editing. Proposed new tests are requirements, not files created by this planning task.

| Area | Retain/extend existing coverage | New behavior evidence needed |
|---|---|---|
| Commands/history | `workspace-state.test.tsx`, `notation-editor.test.tsx`, `workspace-editing-journeys.test.tsx` | Controller command parity, selection reconciliation, bounded history and sidecar dirtiness |
| Loading/recovery | `workspace-persistence.test.tsx`, `workspace-save.test.tsx`, `music-practice-context.test.tsx` where shared helpers are touched | Stale load/hydration, correct identity, recovery offer/salvage, canceled reference/audio acquisition |
| Selection/layout | `workspace-gestures.test.tsx`, `workspace-phase2-contextual.test.tsx`, `workspace-surfaces.test.tsx`, `workspace-viewport.test.tsx` | Actual inspector commit/cancel/reveal/focus behavior after component movement |
| Alignment | `workspace-alignment.test.tsx`, `workspace-overview-follow.test.tsx` | Held passages, offsets, anchor validation/history and synchronized cursor/media behavior |
| Verification | `verification.test.tsx`, `verification-transaction.test.tsx` and relevant API verification suites | Mounted decision races, invert/rollback, local edits during requests and exact save-readiness behavior |
| Save/session | `editor-services.test.ts`, `music-review-save.test.tsx`, `workspace-save.test.tsx`, `editor-lifecycle.test.ts` | Older-snapshot success followed by another save, real session dirty state, exact API paths and useful 409 recovery |
| Piano/guitar | `workspace-piano-integration.test.tsx`, `guitar-surfaces.test.tsx`, `hand-assignment-hook.test.tsx`, formatted/editing journey suites | Piano and guitar actual review routes, instrument-specific controls and saved/reopened authored fields |
| Access/compatibility | `access-loss-session.test.tsx`, `mediapipe-fullbody-integration.test.tsx`, `workspace-video-only.test.tsx`, `drawing-act.test.tsx` | No shared-control/lifecycle regression; pending resources released on route/identity changes |
| Lazy imports | `bundle-boundaries.test.ts`, `act-entry-boundaries.test.ts` plus built manifest | Practice graph excludes editor root/new editor controllers; review still reaches its tools |

Recommended additional focused suites as the corresponding owners land: loading/recovery binding, document controller, selection inspector, alignment authoring, verification coordinator, editor playback, and review route integration. Reuse an existing suite instead of creating another when it already exercises that boundary.

Mocks must validate actual endpoint/path/method/identity and representative payloads. At least one integration path must execute the real route composition and strict reference parsing rather than injecting an already-built context into every boundary. Include API-backed save/reopen/verification checks where they establish contracts that frontend mocks cannot prove.

Do not write tests that merely require a particular hook name or inspect source strings for a behavioral claim. Use source/import checks for genuine dependency boundaries only.

## 8. Definition of done

- [ ] 5.0 owner/caller/state inventory and baseline evidence recorded.
- [ ] Validated loading/hydration/recovery separated and cancellation-safe.
- [ ] Document commands/history and committed selection have one canonical owner.
- [ ] Inspection/gesture and alignment authoring boundaries are migrated and tested.
- [ ] Verification transactions have an explicit owner with exact identity/race handling.
- [ ] Editor playback/audio and local visual subscriptions are separated without another clock.
- [ ] Major presentation responsibilities compose existing specialist surfaces and shared UI through narrow typed props.
- [ ] Save, base revision, dirty, review, navigation and recovery state agree for current and older-snapshot saves.
- [ ] Root production callers use the extracted owners; superseded implementations and temporary bridges are retired or explicitly justified.
- [ ] Piano/guitar specialist behavior and touched full-body/drawing boundaries pass regression coverage.
- [ ] Exact current build/type checks, relevant API checks, mounted integration, and import graph evidence recorded.
- [ ] Browser/layout/resource acceptance and Phase 5 cost comparisons recorded, or the corresponding gate remains openly incomplete.
- [ ] Ledger/guide describe actual production ownership; wider Phase 8 and external gates are not incorrectly declared complete.

No implementation, application tests, dependency changes, commits, or deployments are performed by creating this plan.
