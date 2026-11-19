# Act Platform Consolidation and Reuse Plan

Date: 19 November 2026  
Status: planning and implementation handoff; no implementation or release approval is implied.

## 1. Objective and scope

Make the existing Editor, Practice, and Social architecture inexpensive to extend. A new Act should contribute specialized documents, tools, processing, transport/evidence adapters, and registration while reusing common navigation, lifecycle, publication, progress, access cleanup, and discovery behavior.

The target is lower change fan-out: a common behavior should have one owner and a small, predictable set of callers. Function count, file count, and shorter files are not success measures by themselves. Small cohesive functions and explicit adapters are desirable; moving duplicated logic into several new files is not consolidation.

Retain the working platform and the reviewed SAM/MediaPipe, piano, guitar, and drawing behavior. This plan does not implement additional Acts, replace specialist editors, change scoring semantics, switch the body pipeline default, or redesign the product UI.

Related documents:

- [Original Act-platform implementation plan](act-platform-implementation-plan.md).
- [Act-platform guide](act-platform-guide.md).
- [Existing performance evidence](act-platform-phase7-measurements.md).
- [Act-platform rollout runbook](act-platform-rollout-runbook.md).
- The separately maintained MediaPipe completion/acceptance plan at `C:/Users/enqui/.gemini/antigravity/brain/c2bd6961-86f4-4499-b017-d3e43030786d/implementation_plan.md`.

This plan adds consolidation work after the architecture rollout. It does not claim that historical test reports establish current runtime performance or physical-device acceptance. MediaPipe CPU/visual qualification and PostgreSQL migration acceptance remain separate release gates.

## 2. Findings driving the work

The review examined the current application shell, Act registry, editor/practice coordination, publication, storage, workers, and related tests. It was a static maintainability review, not a benchmark of the entire repository.

| ID | Current evidence | Consequence |
|---|---|---|
| R1 | `apps/api/lessons.py::effective_capabilities`, `apps/api/social.py::_action_set`, `apps/api/publication.py`, frontend support descriptors, and publication readiness independently decide overlapping permissions. The capability function still contains the blanket video-only publication restriction while publication supports approved video roles. | Rules drift; one feature requires fixes in several places. |
| R2 | `LibraryApp.tsx` separately opens restored links, feed items, public values, and Studio actions, with separate body/music/drawing state. Registry `loadPractice` functions are declared while the experience host separately dispatches/imports entries. | Each Act expands shell branches and creates competing entry-point definitions. |
| R3 | `PianoWorkspaceHarness.tsx` was approximately 3,668 lines at review; body and music practice screens also mix workflow coordination with rendering. | Editing one responsibility requires understanding unrelated state and effects. |
| R4 | Practice screens assemble access monitoring, resources, attempts, and persistence independently. Music listen/play and challenge repeat capture-lifetime and cancellation orchestration despite sharing capture/transcription primitives. | Cleanup, evidence, and account/revision race fixes must be repeated. |
| R5 | Body/music/drawing sharing screens, and drawing's editor publication action, repeat publication mutations, rights/roles handling, errors, and invalidation. | The same release operation behaves differently depending on entry point. |
| R6 | SAM and MediaPipe worker handlers repeat artifact uploads, optional-output failure handling, and completion assembly after a shared lease runner. | Adding pipelines copies infrastructure and validation details. |
| R7 | Some lifecycle/policy tests assert source strings and helper names instead of observing a mounted workflow. | Wiring can pass while behavior is bypassed or incomplete. |
| R8 | Reference maps lack an explicit eviction budget; refresh reloads broad application data; playback snapshots reach large React components frequently. | Memory, request volume, and render cost can grow with library size and session duration. Actual impact needs measurement. |

## 3. Ownership rules and design constraints

1. **Server policy owns authorization and release eligibility.** One server resolver supplies permitted actions and publishability from the actual audience projection, revision, acceptance, creator policy, and deployment state. The browser adds device/evidence readiness and learner choices; it cannot lift server restrictions.
2. **The registry owns executable Act entry points.** Use literal lazy imports with typed entry contracts. Never execute module paths supplied by a server or force a body document into another Act's editor.
3. **Controllers coordinate; adapters specialize; components present.** Shared controllers own requests, mutation lifecycles, generation checks, and invalidation. Act adapters own format-specific interpretation and tools.
4. **One owner for each resource and clock.** Keep `PracticeRuntime`, existing transports, `createResourceBag`, and access guards. No additional session timer/state machine is introduced to facilitate extraction.
5. **Existing schemas remain strict and negotiated.** A deliberate boundary union handles body/music/drawing and public projections. Missing assets remain missing; no fabricated GLBs, pose references, or MIME substitutions.
6. **Extract repeated semantics, not superficially similar code.** Piano note correction, body tracking correction, drawing steps, and different musical practice sequences remain specialized. Do not build a universal editor or a configuration language for hypothetical Acts.
7. **Extend existing functions before creating replacements.** Each extraction records its current owner, callers to migrate, and superseded path to retire. Provisional names below describe responsibilities, not mandatory new modules.
8. **Compatibility is explicit and temporary where possible.** Preserve active URLs, accepted/public revisions, legacy progress, and historical reports. Put legacy behavior behind named adapters with removal criteria.

## 4. Delivery sequence

| Phase | Outcome | Dependencies |
|---|---|---|
| 0 | Verified inventory, behavior baseline, ownership map, measurements | None |
| 1 | Consistent policy and descriptor contracts | Phase 0 |
| 2 | One lesson-opening flow and authoritative Act entry registry | Phase 1 |
| 3 | Shared publication and revision-mutation coordination | Phases 1-2 |
| 4 | Reusable practice-session, capture, attempt, and persistence bindings | Phases 1-2; align invalidation with Phase 3 |
| 5 | Cohesive specialist editor/workspace modules | Phases 2-4 for shared behavior boundaries |
| 6 | Shared worker artifact and completion infrastructure | Phase 0; policy/contracts from Phase 1 where relevant |
| 7 | Measured memory, loading, and rendering improvements | Phase 0 baseline; relevant extracted controllers |
| 8 | Conformance proof, retirement of superseded paths, acceptance | All applicable phases |

Prefer incremental PRs for one behavior at a time. Keep functional changes separate from mechanical moves unless separating them would leave an unsafe intermediate state. Finish a shared API and migrate its callers before introducing another abstraction for the same responsibility.

## Phase 0 — Establish the baseline and ownership map

### Work

- Record current commit plus working-tree changes. The reported implementation is uncommitted; preserve unrelated work and obtain a reproducible snapshot before attributing measurements to this refactor. Do not reset, discard, or automatically commit it.
- Inventory production imports, route entry points, shared functions, compatibility shims, and tests for each R1-R8 responsibility. Distinguish live fallback paths, tests-only historical code, generated/vendor assets, and actual dead production code.
- Create a consolidation evidence ledger. For every extraction record: behavior owner, present callers, target owner, migration steps, compatibility obligations, tests, and removal condition. Note declarations that are not used by production callers.
- Capture current behavior for SAM full body, MediaPipe private scored references, MediaPipe public watch-only video, piano, guitar, and unassessed drawing. Include owner, invited/link/group, public, and demo audiences where supported.
- Establish controlled baselines for initial feed, filtered page, next page, editor open/save, practice start, active playback, and repeated navigation across references. Record request/query count, lazy JS bytes, React commits, frame timing, and retained memory where browser tooling is available.
- Keep tests/build results separate from deferred browser, CPU corpus, and PostgreSQL checks. Read existing evidence as historical context, not a substitute for a fresh run.

### Deliverables and exit criteria

- Ownership/caller inventory and named duplication groups exist for R1-R8.
- Baseline fixtures cover actual current documents and role-filtered public projections.
- Numeric runtime budgets, measurement conditions, and tolerances are recorded before claiming an improvement. If a device-dependent budget is pending, mark that acceptance gate pending rather than inventing a passing result.
- No application behavior has changed during inventory.

## Phase 1 — Consolidate policy and descriptor facts

Primary files: `apps/api/acts.py`, `lessons.py`, `publication.py`, `social.py`, `editor_lifecycle.py`; `apps/web/src/acts/registry.ts`, `app/lesson-context.ts`, `sharing/publication-readiness.ts`; `packages/learning-engine/act-capabilities.ts` and `practice-policy.ts`.

### Work

1. Define which facts are stable catalogue data and which decisions depend on revision/audience/device/evidence. Version the shared descriptor DTO; retain Python's server catalogue as the authority and generate/check a frontend data artifact rather than hand-maintaining another independent catalogue. Keep executable loaders local to the frontend.
2. Build or extract a pure server action resolver used by detail, summaries, discovery, and editor state. Reuse `publication.publishability()` for release eligibility instead of reimplementing its conditions. Supply preloaded facts so policy does not trigger a query per card.
3. Resolve against authorized content: a public video with no approved pose reference cannot inherit assessment/challenge capability from the private manifest. Preserve explicit watch-only behavior.
4. Remove overlapping hard-coded publication restrictions from capability/discovery callers after switching them to the shared service. Fix R1's video-only disagreement through that migration.
5. Preserve the independent practice axes: mode, assessment permission, feedback presentation, and usable evidence. The server supplies permission/support ceilings; the client refines device/learner readiness locally without a server round trip per frame.
6. Keep UI-only rights-checkbox validation local, while server acceptance, allowed roles, actual assets, and publishability remain authoritative. Use typed reason codes rather than parsing human-readable error messages for business decisions.
7. Add shared scenario fixtures exercised by server and frontend implementations where logic must exist in both languages. Generate catalogue facts; use parity fixtures for dynamic decisions. Do not attempt to run Python policy inside the browser or generate arbitrary executable code.

### Exit criteria

- Detail, summary, discovery, and editor readiness agree for the same actor/revision/projection, except explicitly documented surface-specific actions.
- SAM 3D, private MediaPipe, approved public video, reviewed/unreviewed music, creator-disabled assessment, and drawing have matrix coverage.
- Public watch-only never becomes assessed through client defaults; unknown Acts and contract versions fail explicitly.
- Descriptor drift fails a focused check; policy evaluation adds no per-item queries and does not regress listing budgets.

## Phase 2 — Centralize lesson opening, routes, and Act entries

Primary files: `LibraryApp.tsx`, `LessonExperienceHost.tsx`, `acts/registry.ts`, `app/lesson-context.ts`, `app/routes.ts`, and Act entry modules.

### Work

1. Represent the active lesson through one validated context plus navigation intent, instead of independently mutable body/music/drawing documents and ownership flags that must be cleared together. Keep separate state only for distinct pending editor/share operations when required.
2. Extract a common opening coordinator from the existing `open`, public-open, restored-link, and Studio callbacks. Inputs include lesson identity, audience/source, intent, and account scope; outputs include validated context and permitted destination. Keep draft review, which may precede a complete lesson manifest, as an explicit typed entry.
3. Make the existing registry's entry loaders the ones the host actually invokes. Provide typed watch/practice/editor/share bindings only where appropriate. A heterogeneous registry may use typed per-Act registration factories and thin wrappers; do not spread `unknown`, `any`, or repeated casts through the shell to force uniform props.
4. Register specialized music/body/drawing entry components with literal dynamic imports. Keep the full-body transport initialization inside its adapter; opening music must not construct body playback. Keep editor imports out of practice dependency graphs.
5. Reuse `lessonPageUrl()` for audience-based URL synchronization and `routeOf()` for restoration. Preserve public/demo markers, existing IDs/query shapes, sign-in return intent, back navigation, and source-specific loading.
6. Use a common account/filter generation boundary for lesson opening and page loading. Preserve the existing library pager rather than inventing another stale-response scheme. Invalidate pending work on account change/unmount and guard results, errors, and loading metadata consistently.
7. Move library page state and filter/reload coordination into a cohesive binding over `createLibraryPager()`. Route refresh, sign-in, search, and load-more through it instead of manually assigning the same state fields in each callback.

### Exit criteria

- All production open paths use the coordinator, or a documented draft-only entry; copied Act dispatch blocks are removed from shell callbacks.
- Every declared registry entry has a real caller; the host does not maintain competing imports/registration definitions.
- Public video-only refresh, private resume, demo, direct/group/link access, Studio edit/share, and auth-return tests exercise application wiring.
- Out-of-order open/reload/load-more results cannot cross account or filter boundaries. Existing public watch-only capabilities survive routing.
- Bundle tests confirm practice does not import `PianoWorkspaceHarness` or another Act's editor.

## Phase 3 — Consolidate publication and revision mutations

Primary files: `ShareLesson.tsx`, `music/MusicShareLesson.tsx`, `acts/drawing/DrawingShareLesson.tsx`, `DrawingEditorEntry.tsx`, `sharing/publication-readiness.ts`, `editor/revision-handoff.ts`, and API mutation wrappers.

### Work

1. Extract a publication binding for loading authoritative readiness/roles, selecting an exact revision, requesting listing/unlisting, reporting busy/error state, and invalidating release/context/discovery data.
2. Give it typed inputs: lesson/revision, audience, selected approved roles, metadata, and rights acknowledgement. Act views supply representation previews and wording; they do not replicate mutation or eligibility rules.
3. Migrate body, music, drawing, and inline editor publication to the same commands. Preserve supported invitation/group/link operations; a shared controller must not accidentally grant an Act a distribution mode it does not support.
4. Route save/review/release invalidation through the existing revision-handoff functions or their extended owner. Distinguish immutable reference caching from mutable context/release metadata. A new private revision must not move an existing public release.
5. Build common mutation-state/error handling only where repeated behavior is identical. Reuse `classifySaveError()` semantics where appropriate, replacing message-regex classification with typed server codes incrementally. Preserve endpoint-specific validation messages and retained edits.
6. Invalidate or update only affected query results. Keep a broad refresh fallback until Phase 7 measurements and targeted invalidation tests establish equivalent behavior.

### Exit criteria

- One publish/unlist implementation serves all active publishing entry points.
- Rights, acceptance, available representations, server denial, revision conflicts, and publication updates have shared behavioral tests plus Act-specific previews.
- Role-filtered asset authorization remains intact. Focused-video failure permits private preview but does not invent an approved public representation.
- Publishing an older accepted revision does not publish newer local edits; failed save/publish preserves appropriate local state.

## Phase 4 — Share practice binding, evidence lifetime, and persistence

Primary files: `practice/useMusicPractice.ts`, `practice/practice-store.ts`, `practice/session-guard.ts`, `LessonWorkspace.tsx`, `PracticeWorkspace.tsx`, `music/workspace/PianoPracticeWorkspace.tsx`, `acts/drawing/DrawingPracticeEntry.tsx`, music capture hooks, and `packages/learning-engine`.

### Work

1. Extract a reusable session binding around the existing runtime, transport, plan, policy, progress store, and resource bag. Reuse current behavior from `useMusicPractice()` where applicable; choose a neutral name only when it genuinely serves multiple Acts. Do not add another advancing clock.
2. Define Act adapter boundaries for plan creation, transport, evidence acquisition, qualified assessment/report, and specialized stage. Drawing retains step-based progression; music follows media time; body retains its existing playback adapter.
3. Centralize audience-aware revalidation setup, interval/listener cleanup, and access-loss transition. Session ownership covers pending requests, recording, capture, inference, audio, MIDI, workers, subscriptions, and transport/runtime cleanup. Use exactly one owner for each acquisition; teardown remains idempotent.
4. Extract capture-job lifetime shared by music listen/play, live challenge, and uploaded assessment where semantics overlap: generation, abort signal, acquired resource handles, stale-result rejection, and cancellation. Keep their different musical phases, evidence windows, and guard/count-in sequences in specialized controllers.
5. Centralize attempt serialization/submission over the existing envelope/API function so camelCase-to-wire mapping, account identity, idempotency, error handling, and local fallback are not assembled in every screen. Preserve typed Act-specific reports and rubric/provenance.
6. Classify results from actual evidence: qualified completion, unassessed, insufficient evidence, or interruption. Turning assessment permission on is not proof that sufficient evidence was captured. Keep hiding feedback independent from assessment.
7. Unify progress behavior behind the existing `PracticeStore` interface. Keep the legacy body endpoint/table authoritative through a compatibility adapter during this plan. New Acts use plan-scoped storage; do not silently dual-write or migrate historical body progress. Any later authority switch needs a separate data migration/rollback decision.
8. Preserve account/revision/plan keys, revision remapping rules, conservative local import, server-newer protection, and truthful guest/offline behavior. Reuse common validation and preference serialization across adapters.

### Exit criteria

- Body, piano, guitar, and drawing use the shared session/persistence contracts through adapters; no new Act must copy a session controller.
- Mounted tests observe actual device/capture cancellation and zero post-unmount polling, including pending permission/assessment completion and denied/revoked access.
- Demo/public/private checks use the correct endpoint; transient network errors do not masquerade as revoked access.
- Assessed/unassessed/interrupted/insufficient-evidence outcomes persist consistently without duplicate completion events or cross-account leakage.
- Existing legacy body resume and current music/drawing flows remain behaviorally equivalent. No historical reports or scores are rewritten.

## Phase 5 — Separate large workspaces by responsibility

Primary files: `music/workspace/PianoWorkspaceHarness.tsx`, `PianoPracticeWorkspace.tsx`, `PracticeWorkspace.tsx`, `MimicInterface.tsx`, `editor-services.ts`, `instrument-adapters.ts`, and specialist panels.

### Work

- Map each workspace's state/effects into document commands and undo, selection/inspection, save/review, verification, transport/clock, evidence/session, and presentation. Extract one cohesive responsibility at a time with the Phase 0 behavior fixtures.
- Keep specialist document editing and verification state owned by the Act. Shared editor lifecycle describes dirty/review/release state; it must not absorb note editing, body tracking algorithms, or drawing-step commands.
- Expand existing `editor-services.ts` and instrument adapters where appropriate before adding services. Move repeated instrument defaults/tool support into adapters, but keep meaningful piano/guitar rendering differences explicit.
- Give panels narrow inputs and commands. High-frequency clock consumers subscribe near the timeline/stage; opening a settings panel should not require all document editing state.
- Make active editor save/review use the shared session and Phase 3 mutations. Preserve asynchronous save identity: saving an earlier snapshot cannot mark newer edits clean or accepted.
- Keep existing public exports and URLs through thin compatibility shims during migration. Migrate their callers/tests, then remove shims when evidence supports removal.
- Consolidate ordinary source formatting for touched files so statements and effects are reviewable. Avoid a repository-wide formatting rewrite mixed into behavioral refactoring.

### Exit criteria

- Workspace views primarily compose specialist panels and controllers; repeated orchestration is no longer embedded in each view.
- Undo/redo, selection, notation/TAB/chords, body sections/calibration, drawing steps, verification, save conflicts, and dirty navigation pass focused regressions.
- Reduced line count is recorded only as supporting evidence. The decisive measures are fewer duplicated responsibilities and a lower number of modules that must change for a common workflow update.
- Editor extraction preserves lazy practice/editor boundaries and does not increase runtime work merely to simplify files.

## Phase 6 — Consolidate worker artifacts and completion

Primary files: `scripts/saas_worker.py`, `instructor_pipeline.py`, route contracts in `apps/api/processing_routes.py`, and worker/pipeline tests.

### Work

- Retain the shared lease/download/command runner and separate SAM/MediaPipe algorithms. Extract repeated artifact upload, required/optional output validation, and completion handling from pipeline handlers.
- Introduce a small typed pipeline-result structure if needed: validated reference metadata, required artifacts, optional artifacts, warnings, and route identity. Existing route contracts remain authoritative for engine/version/MIME requirements.
- Share thumbnail/encoding command construction only where policies are identical; normalization rates, model requirements, GLB handling, and scoring semantics remain pipeline-specific.
- Ensure optional-output failure updates every dependent output coherently. Do not retain marker references to a focused video that failed validation/upload. Alpha requires its valid focused output.
- Preserve exact provider/pipeline credentials, lease loss, cancellation, artifact paths/checksums, finite JSON, final-frame duration, pose/mask distinction, and CPU/GPU-specific dependency boundaries.
- Keep `body-mediapipe-v1` and existing SAM identifiers stable. Do not switch defaults or introduce schema changes as a side effect of extraction.

### Exit criteria

- Required upload, optional failure, cancellation, lease loss, and finish logic are tested once at the shared boundary and through both pipeline adapters.
- SAM/MHR70 and MediaPipe regressions pass, including MP-1/MP-2/MP-3 and playback-duration fixtures.
- Fake inference tests verify orchestration only. Real CPU/visual acceptance remains explicitly pending until performed under the separate MediaPipe qualification plan.

## Phase 7 — Improve measured loading, memory, and render costs

Primary files: `app/lesson-context.ts`, library/pager bindings, summary/workflow endpoints, clock consumers, and the extracted workspace components.

### Work

1. Add a bounded reference-cache policy around existing SHA-256 integrity and in-flight de-duplication. Record byte/entry budget and eviction behavior from measured reference sizes and supported-device memory. Active sessions retain their references; oversized assets may bypass caching rather than breaking playback. Preserve audience/account isolation and sign-out cleanup.
2. Remove unnecessary duplicate cold loads and broad post-mutation refreshes through targeted context/release/library invalidation. Use the existing request client and shared error handling; preserve special streaming/progress transports where needed.
3. Ensure the first usable owned/shared page is not held behind loading every shared page or unrelated workflow data. Search, subject facets, totals, and continuation remain server-correct, generation-protected, and stable under account/filter changes.
4. Profile large React roots at idle and during playback/evidence inference. Move fast clock updates to targeted subscribers and avoid unchanged snapshots causing broad renders where measurements show meaningful cost. Retain one authoritative clock and correct buffering/end behavior.
5. Recheck bounded SQL, N+1 protection, request counts, lazy entry graphs, and artifact sizes. Avoid adding database indexes or a new client-state library solely because it might help; justify them with query plans or measured repeated needs.

### Exit criteria

- Document before/after request/query counts, retained reference memory, render/frame results, and lazy JS bytes under the Phase 0 conditions.
- Cache growth is bounded by a documented policy and still verifies hashes and rejects tampered assets.
- New mutation paths invalidate affected data without regressing revision/public-role consistency.
- Runtime results meet the Phase 0 budgets; measurements that were not possible remain open acceptance items. Smaller files or a successful build are not performance evidence.

## Phase 8 — Act conformance, retirement, and rollout

### Reusable conformance suite

Build a parameterized fixture/driver suite around existing specialized Acts. Adapters supply valid documents, supported actions, stage-specific interactions, and expected limitations. Reuse assertions for:

- Source/route open, unsupported formats, public/demo/authenticated loading, and correct lazy entry.
- Edit/save/review, dirty/conflict handling, exact revision acceptance, and release stability.
- Allowed publication roles, rights acknowledgement, asset authorization, list/unlist, discovery/search/facets/pagination, and likes where supported.
- Practice start/pause/repeat, valid time/step progression, optional evidence, policy restrictions, qualified/unassessed outcomes, progress, and attempt persistence.
- Account/revision/plan changes, stale requests, revoked access, resource release, and unmount.

Keep specialized algorithm tests and import-graph checks. Replace behavioral source-string assertions with actual behavior tests as each extraction lands. Do not remove historical tests solely to make refactoring pass; migrate useful assertions and document genuinely obsolete ones.

### Extensibility proof and retirement

- Use the existing drawing Act as a lightweight conformance proof and piano/guitar as evidence that shared infrastructure can serve different specialist controls. Do not implement singing/acting to validate this plan.
- Record the expected extension points for the next real Act: descriptor/subject, strict document/reference validator, processing adapter if required, editor/tools, practice transport/evidence/assessment adapters, approved representation, registration, and fixtures.
- The next Act may extend explicit type unions, schemas, registry data, and format boundaries. It should not require copying shell open/share/progress/access code or adding Act-id conditions throughout shared screens. Any necessary new shared behavior needs an ownership/design decision before expansion.
- Remove superseded implementations only after production imports, route flags, fixtures, and compatibility usage have been audited. Tests-only historical controllers do not automatically justify keeping a permanent production API; retain fixtures/assertions in their appropriate test home.
- Update the Act guide, integration checklist, capability matrix, and rollback runbook to describe actual production callers. Remove claims that a registry/helper is authoritative when the app bypasses it.

### Rollout and rollback

- Keep each phase deployable with its focused regressions and production build passing. Use an existing temporary rollout switch only where two behaviors must coexist; give any new switch an owner and removal criterion.
- Prefer wrapper/adaptor rollback for code movement. Avoid schema/data migrations in this consolidation unless an independently reviewed requirement proves one necessary.
- Never roll back by relabeling jobs, altering accepted references, deleting attempts, or changing published revision pointers. Reverting UI/controller code must preserve stored data contracts.
- Validate existing Act-platform migrations 0026-0029 on disposable representative PostgreSQL, including upgrade/downgrade/re-upgrade and EXPLAIN checks; do not downgrade live user data.
- Release approval requires real browser/device journeys for the changed surfaces. The SAM-to-MediaPipe default switch remains outside this consolidation and retains its own CPU/visual gates.

### Final acceptance

- R1-R8 each have an implemented owner, migrated callers, current evidence, and no competing active implementation except named compatibility adapters.
- One policy change has a predictable owner and parity coverage. One new Act uses registered adapters and the common workflows.
- Active shell opening, publication, practice lifecycle, progress, and artifact handling use shared services in production, not merely in test fixtures.
- All current Act/audience journeys pass without fabricated assets, historical-report reinterpretation, public/private leakage, or duplicate clocks.
- Measured runtime budgets and supported-device acceptance pass; deferred results remain visibly incomplete.
- Evidence identifies the exact commit/build and test commands. Completion is not inferred from function names appearing in source.

## 5. Validation and evidence checklist

Run focused tests for the changed boundary in each PR; broaden once shared callers have migrated. Reuse the repository test runner instead of inventing another harness. Representative existing checks include:

| Boundary | Existing checks to retain/extend |
|---|---|
| Policy/schema | `tests/api/test_acts.py`, `test_publication_neutral.py`, `test_lesson_negotiation.py`; frontend `act-capabilities`, `lesson-context`, `publication-readiness`, engine parser tests |
| Shell/routes/discovery | `public-act-rendering`, `summary-loading`, `act-entry-boundaries`, `bundle-boundaries`; API social/query-budget/public-pagination tests |
| Editor | `editor-lifecycle`, `workspace-save`, existing specialist editor tests; replace lifecycle wiring strings with mounted behavior |
| Practice/persistence | `practice-store`, `practice-progress-sync`, `practice-policy`, `access-loss-session`, `music-practice-context`, `mediapipe-fullbody-integration`, `drawing-act`; API progress/workflow tests |
| Workers | `tests/avatar/test_focused_video.py`, `test_instructor_pipeline.py`, `test_saas_worker_mediapipe.py`, and `tests/api/test_mediapipe_pipeline.py` |
| Build/contracts | `python -m apps.api.export_lesson_schemas --check`; `npm --prefix apps/web run build`; inspect `dist/.vite/manifest.json` practice/editor reachability |

Use the appropriate existing Python environment for each suite; OpenCV and API environments currently differ. Planning or refactoring does not authorize dependency upgrades, model downloads, production data changes, or a pipeline-default switch. Handle required environment preparation as a separate explicit implementation step.

For each phase report what changed, what was retired, which callers remain, commands/results, measured costs where relevant, compatibility exceptions, and open gates. This document itself creates no application code, migrations, tests, commits, or deployments.
