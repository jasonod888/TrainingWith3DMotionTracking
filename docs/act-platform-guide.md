# Act platform architecture and reuse guide

Updated: 19 November 2026. Shared reference for developers and AI agents. [Root agent instructions](../AGENTS.md) contain the concise rules; this guide explains the architecture and where existing behavior belongs.

## 1. Engines and Acts

The product has three Engines:

| Engine | User journey | Common behavior | Specialized behavior |
|---|---|---|---|
| Editor | Select source, process with AI where appropriate, correct, save privately, review, publish | Navigation, lifecycle/dirty state, revisions, conflicts, readiness, release/access | Act-specific interpretation, correction/verification tools, specialist stage |
| Practice | Watch, practice, or challenge with independent assessment/feedback choices | Plan/runtime/transport contracts, common actions/settings, progress, attempts, cleanup | Evidence, qualified assessment/rubric, specialist display, time or step progression |
| Social | Feed, search/filter, recommendations, likes, discovery | Authorized summaries, publication roles, pagination, facets, reactions, routing | Representation renderer, Act metadata, supported actions |

An Act is a content experience used inside those Engines:

- `full_body`: movement editing and pose-based practice. SAM and MediaPipe are alternative processing pipelines within this Act.
- `piano`: note, hand, velocity, pedal, notation and music-practice tools.
- `guitar`: TAB, positions, chords, tuning, capo and music-practice tools.
- `drawing`: ordered steps and unassessed step-based practice; currently a lightweight extensibility proof, not a complete drawing AI studio.
- Singing and acting are future Acts. Do not implement them merely to generalize an abstraction.

Acts can have different AI modules, processing workflows, editor tools, input devices, and assessment. Shared workflow, navigation, and common controls create familiarity. A full-body editor does not use piano tools; piano and guitar can share music foundations where their semantics match.

Keep these concepts separate:

| Concept | Meaning/example |
|---|---|
| Product Engine | Editor, Practice, Social |
| Act | `full_body`, `piano`, `guitar`, `drawing` |
| Subject | Classification, e.g. dance/taekwondo within `full_body` |
| Processing engine/pipeline | SAM/MediaPipe; manifest `engine` and pipeline/version fields describe computation |
| Schema/family | Body v1, music v2, drawing v3; data/implementation representation |
| Assessment adapter/rubric | Qualified evidence evaluation and independently versioned scoring semantics |
| Public representation | Approved video, interactive 3D, reviewed notation/steps, poster |

Changing a model does not automatically create an Act. Worker availability affects new processing, not playback eligibility for existing lessons.

## 2. Find an existing owner before writing code

Paths are repository-relative. Inspect implementation and production callers: a declared helper or a plan is not evidence that the app uses it.

| Responsibility | Existing resources |
|---|---|
| Act facts and subjects | `apps/api/acts.py`, `apps/api/subjects.py`; frontend `apps/web/src/acts/registry.ts` |
| Shared server action/capability policy | `apps/api/policy.py`; role/release eligibility remains in `apps/api/publication.py` |
| Generated descriptor facts and policy parity | `packages/lesson-schema/act-descriptors.json`, `packages/lesson-schema/policy-parity-fixtures.json`; generated/checked through `apps/api/export_lesson_schemas.py` |
| Strict contracts/public projections | `apps/api/contracts.py`, `packages/lesson-schema/index.ts`, `packages/lesson-schema/parse.ts`, `apps/api/export_lesson_schemas.py` |
| Context loading/reference integrity | `apps/web/src/app/lesson-context.ts` |
| URL/auth-return/opening intent | `apps/web/src/app/routes.ts`, `apps/web/src/app/open-target.ts`; active dispatch also in `apps/web/src/LibraryApp.tsx` / `apps/web/src/LessonExperienceHost.tsx` |
| Generation-protected paging | `apps/web/src/app/library-pager.ts` and summary page functions in `apps/web/src/api.ts` |
| Editor lifecycle/readiness | `apps/web/src/editor/authoring-lifecycle.ts`, `editor-session.ts`, `editor-readiness.ts`, `editor-adapter.ts` |
| Revision handoff/invalidation | `apps/web/src/editor/revision-handoff.ts` |
| Music editor orchestration/tools | `apps/web/src/music/workspace/editor-services.ts`, `instrument-adapters.ts`, `useMusicReviewSave.ts`, `useMusicWorkspaceDocument.ts`, `useMusicEditorSelection.ts`, `useMusicAlignmentEditor.ts`, `useMusicVerificationController.ts`, `useMusicEditorPlayback.ts`, `useMusicReviewLoad.ts`; specialist views `MusicReviewHeader.tsx`, `MusicNoteInspector.tsx`, `MusicVerificationPanel.tsx`, `MusicReviewSettings.tsx` |
| Music capture lifetime | `apps/web/src/music/capture-job.ts` (used by listen/play and challenge) |
| Shared shell opening/paging/publication | `apps/web/src/app/lesson-opener.ts`, `useLibraryPages.ts`; `LibraryApp` `applyOpenedContext`/`refreshOwned`; `apps/web/src/sharing/usePublicationController.ts` |
| Shared practice access/submission/capture | `apps/web/src/practice/usePracticeAccessGuard.ts`, `submit-attempt.ts`; `apps/web/src/music/capture-job.ts` |
| Shared worker completion | `scripts/saas_worker.py` required/optional artifact and completion helpers |
| Practice execution | `packages/learning-engine/practice-runtime.ts`, `practice-plan.ts`, `practice-transport.ts`, `practice-commands.ts`, `practice-view.ts` |
| Capabilities/policy/outcomes | `packages/learning-engine/act-capabilities.ts`, `practice-policy.ts`, `attempt-envelope.ts` |
| Session binding/transport | `apps/web/src/practice/useMusicPractice.ts`, `media-transport.ts`; body retains its existing playback/session adapter |
| Resources/access monitoring | `packages/learning-engine/practice-adapter.ts`, `apps/web/src/practice/session-guard.ts` |
| Progress/preferences/attempts | `apps/web/src/practice/practice-store.ts`, `apps/api/practice_progress.py`; body legacy progress remains authoritative through its adapter |
| Publication/asset authorization | `apps/api/publication.py`, `permissions.py`, `public.py`; frontend `apps/web/src/sharing/publication-readiness.ts` |
| Discovery/reactions/workflow | `apps/api/social.py`, `apps/api/workflow.py`, `apps/web/src/social/` |
| UI primitives/style tokens | `apps/web/src/ui/controls.tsx`, `controls.css`, `tokens.css` |
| Familiar settings/panels/labels | `apps/web/src/PracticeSettings.tsx`, `PracticePanel.tsx`, `practice/PracticeCommonSettings.tsx`, `practice/PracticeSettingsPanel.tsx`, `app/capability-labels.ts` |
| Worker/pipeline orchestration | `scripts/saas_worker.py`, `scripts/instructor_pipeline.py`, `apps/api/processing_routes.py` |

Where a row abbreviates neighboring filenames, resolve them against the first file's directory. Use repository search to verify current locations before edits.

### Current implementation versus planned consolidation

The initial architecture and reviewed integration fixes exist. Consolidation is in progress; the [plan](act-platform-consolidation-plan.md) describes its scope, not proof that every controller is shipped. Check the current implementation and [consolidation ledger](act-platform-consolidation-ledger.md) for phase-specific status and evidence.

The active policy consolidation introduces `apps/api/policy.py` and generated descriptor/parity artifacts. Reuse these owners; catalogue facts are regenerated from the server instead of independently hand-edited. Their presence is not itself proof of test or deployment acceptance.

The registry currently declares entry loaders while the host still has explicit imports/dispatch. Shell callbacks and sharing/session screens still repeat coordination. Repair of the music review workspace has moved its document/history, selection, alignment, verification, playback, loading/recovery, save/conflict and major presentation sections into the typed owners above; the review root is now a composition point, while practice keeps its own stack and imports no review controller or panel. These are real owners with mounted callers, not a second framework. Update this paragraph as those callers migrate; do not add another parallel framework.

`apps/web/src/` and `apps/api/` are the SaaS sources. The historical `web/` prototype is not the application shell, but `web/dist/pose.js` currently has active shared scoring consumers. Verify import/build paths before deleting something that looks generated or obsolete.

## 3. Shared functions and UI

1. Search implementations/callers/tests with `rg` before adding a helper, hook, endpoint, controller, or component.
2. Reuse the existing function when semantics match. Creating another name for identical orchestration increases maintenance.
3. Inject a typed adapter or specialized component when content differs. AI, scoring, notation, 3D, and canvas tools remain Act-owned.
4. Place genuinely new shared behavior in a narrow existing owner where possible. Avoid omnibus utilities, speculative configuration languages, and a universal editor.
5. When consolidating, migrate production callers and retire the superseded path when compatibility permits. Adding a shared helper without replacing duplicated behavior is incomplete.

Reuse common buttons/inputs, settings rows, panels, spacing/color tokens, capability explanations, and loading/error/empty states. Preserve keyboard/focus/accessibility and responsive behavior. Keep specialist stages inside their Act; do not copy a full screen or its CSS to obtain ordinary controls.

Keep React views focused on presentation/local interaction. Loading, mutations, async identity, invalidation, and session/resource lifetime belong in existing services or cohesive extractions. Do not turn an unrelated task into a full rewrite to satisfy a file-size target.

## 4. Invariants across all Acts

### Context, policy, and routes

- Validate private documents and public projections through the correct readers. Preserve declared Act identity and explicitly refuse unsupported formats. Never infer an Act from title, file, tag, GLB, or worker status.
- Server access, effective capability restrictions, acceptance, and publishability remain authoritative. Use the shared `policy.py` decisions and existing publication service. The browser refines device/evidence readiness and learner choice without lifting server restrictions. Do not create another set of publication/capability rules in a screen; regenerate descriptor artifacts rather than maintaining another catalogue.
- Route through `LessonContext` and `lessonPageUrl({ page, lessonId, audience })`. Derive public/demo sources from audience, including null-landmark videos; preserve refresh/back/auth-return behavior.
- Apply search/subject filters and facets before server pagination. Use generation protection across reload, load-more, metadata/errors, refresh, and account changes.

### Editor and revisions

- AI completion requires human review. Save is private. Review/acceptance and publication are explicit and tied to an exact revision.
- Saving an earlier snapshot cannot mark newer edits clean. Conflicts retain edits; private work never silently moves a release.
- Reuse authoring sessions, readiness, revision handoff, and existing music services where relevant. Correction tools and stage layout can differ.

### Practice and resources

- Use the existing runtime/plan/transport. A visual loop may observe time but must not create another authoritative session clock. Drawing uses actual steps rather than fake media timestamps.
- Keep mode, assessment permission, feedback presentation, and usable evidence independent. A learner cannot override creator-disabled assessment; hiding feedback does not disable assessment.
- Preserve qualified completion, unassessed, insufficient-evidence, and interrupted outcomes. Missing tracking/audio is not a zero or an invented score. Different Acts' reports are not automatically comparable.
- Reuse account/revision/plan-scoped stores, attempt envelopes/service, and server-newer import protection. Offline/guest claims must reflect actual storage. Preserve the body legacy adapter until an explicit migration changes authority.
- Each resource has an owner/release path: devices, recording, playback/audio, MIDI, workers, subscriptions, intervals, and pending inference. Release on cancellation, revoked access, route/Act change, and unmount; reject stale async completions.
- Use audience-aware revalidation: demo does not poll authenticated endpoints; public checks the public projection; authenticated audiences check their actual access.

### Public assets

- Private playback availability and public publication are distinct. Require accepted revision, approved roles/assets, rights acknowledgement, and server publishability. Private preview fallback does not authorize public exposure.
- Full body supports valid `interactive_data` or an approved `playable_preview`. Music supports approved preview/reference/poster. Drawing supports approved steps/reference and poster. A poster alone is not playable.
- Public video-only body has `animation: null`, `landmarks: null`, and an approved MP4 watch source. Keep it watch-only without an approved pose reference. Private movement still requires its real pose reference.
- Never fabricate a JSON landmark asset from video, invent animation, expose private source as fallback, or fetch private pose data for a video-only public projection.
- Extend contracts, strict parsing, role projection/allowlists, asset authorization, readiness, and UI actions together when adding a public role/shape.

### Processing and efficiency

- Reuse worker leases/cancellation/upload infrastructure; keep model/inference differences in pipeline handlers. Preserve exact provider/pipeline credentials and immutable job/revision identities.
- SAM stays default while MediaPipe CPU/visual qualification is pending. Preserve historical rubric/provenance; never reinterpret old reports silently.
- Keep playback duration distinct from the final frame's start time. Preserve MediaPipe/browser confidence parity and safe preview fallback for unrepaired matte gaps.
- Keep specialist editors out of practice imports. Reuse hash integrity/in-flight de-duplication; `lesson-context.ts` owns the bounded LRU/byte-budget reference cache with pinning and oversized-asset bypass. Address remaining cache/render budgets through their actual owners.
- Function count or a passing build does not prove efficiency. Measure request/query count, lazy JS, frame/render cost, retained memory, and worker throughput where relevant.

## 5. Adding or extending an Act

1. Confirm user scope and whether this is a new Act or a backend/tool inside an existing Act.
2. Extend catalogue/subjects and local registration with truthful support and literal lazy entries. Preserve explicit unsupported behavior.
3. Reuse an existing schema only if it accurately models the content; otherwise extend the strict discriminated boundary/reference validation. Do not fabricate a piano/body document for a different medium.
4. Supply specialized editor tools, reference/readiness, processing when needed, and practice plan/transport/evidence/assessment/stage adapters. Reuse lifecycle, commands, storage, and cleanup.
5. Declare approved representations and reuse publication, asset authorization, summaries, discovery, shared UI, and audience routing. Do not add another feed or copy a sharing controller.
6. Test the actual production entry path across supported engines/audiences, unsupported modes, revision/account changes, cancellation, and cleanup. Keep specialized algorithm tests and import-boundary checks.
7. Update this owner map and retire obsolete guidance when ownership changes. Explain/document deliberate user-requested architecture changes; do not invent an approval process for routine work.

A new Act normally adds explicit catalogue/contract/registry entries and specialist adapters/tools/tests. Repeated modifications to shared open/share/progress/access/feed decisions indicate an ownership boundary that needs consolidation.

## 6. AI-agent startup and verification

[AGENTS.md](../AGENTS.md) is the common repository entry point. Antigravity recognizes root `AGENTS.md` as workspace guidance; see its [official rules documentation](https://antigravity.google/docs/rules-workflows/). Keep one architecture reference rather than copying policy into separate `GEMINI.md` or agent-specific rule files.

DeepSeek Harness instruction discovery is runner-dependent and has not been verified here. Pass this startup instruction or attach these files to its task context:

> Read AGENTS.md and docs/act-platform-guide.md before editing. Follow their Engine/Act boundaries and reuse shared functions/UI. For consolidation tasks also read docs/act-platform-consolidation-plan.md. Inspect production callers; do not assume planned abstractions are implemented. Keep specialist tools separate from common workflows.

Use the existing web test runner, relevant production/type build, schema parity check, and focused API/worker suites. Observe mounted workflow behavior for lifecycle/cancellation; use import graphs for bundle boundaries. Source/helper-name assertions alone are insufficient workflow evidence.

Phase 5's music review separation is implemented with real callers: `PianoWorkspaceHarness.tsx` composes the typed controllers and `MusicReviewHeader`/`MusicNoteInspector`/`MusicVerificationPanel`/`MusicReviewSettings` views, and Practice imports none of them. The remaining Phase 8 mounted editor → review → publish → discover → practice journeys, live PostgreSQL acceptance, CPU MediaPipe corpus/visual qualification, and real browser/device (frame, media, focus, camera/MIDI/microphone, teardown) gates are still open; build or mocked-test success does not close them.

Report what was reused, changed, tested, and remains unverified. Preserve unrelated changes and existing data/contracts. Do not implement unrequested consolidation/new Acts, switch defaults, or claim PostgreSQL/CPU/device acceptance from mocked tests.

For staged work see the [consolidation plan](act-platform-consolidation-plan.md). Existing [rollout](act-platform-rollout-runbook.md) and [performance evidence](act-platform-phase7-measurements.md) have dates/limitations that must be checked before relying on them.
