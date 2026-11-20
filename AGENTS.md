# Repository instructions for AI coding agents

Applies to this repository and all subdirectories. Follow the user's current scope; a planning/review request does not authorize implementation.

## Read first

Read [the Act architecture and reuse guide](docs/act-platform-guide.md) before changing an Act or shared workflow. For consolidation tasks also read [the consolidation plan](docs/act-platform-consolidation-plan.md). Inspect production callers: planned abstractions are not necessarily implemented or used.

## Product vocabulary

- **Engines** are the three product workflows: **Editor** (create/process/correct/save/review/publish), **Practice** (watch/practice/challenge with independent assessment and feedback), and **Social** (feed/search/recommendations/likes/discovery).
- **Acts** are specialized content experiences: `full_body`, `piano`, `guitar`, `drawing`; singing and acting are future extensions. Each supplies its tools/data while reusing the common workflows.
- SAM and MediaPipe are processing pipelines inside `full_body`, not new Acts or product engines. Manifest `engine`, subject, instrument, schema, assessment adapter/rubric, and public representation are separate concepts.
- Familiar workflow/UI does not mean identical tools: body correction, piano notation, guitar TAB, and drawing steps remain specialized.

## Reuse requirements

1. Search existing implementations, callers, and tests before adding a helper, hook, component, controller, endpoint, or policy. Reuse identical semantics; use typed adapters for specialized behavior. Do not copy entire screens or create competing owners for one workflow.
2. Start with `apps/web/src/app/` for contexts/routes/paging, `src/editor/` for authoring lifecycle, `packages/learning-engine/` for practice policy/runtime/plans/attempts, `src/practice/` for transports/stores/access cleanup, and `apps/api/acts.py` / `policy.py` / `publication.py` for Act facts, action policy, and publication. Here `src/` means `apps/web/src/`.
3. Reuse `apps/web/src/ui/controls.tsx`, `ui/tokens.css`, existing settings/panel components, and capability labels. Keep Act-specific stages/tools in Act components. Preserve keyboard/focus/accessibility and responsive behavior.
4. Keep server authorization, acceptance, publication eligibility, and role allowlists authoritative. Reuse `apps/api/policy.py` for shared action/capability decisions and `publication.py` for release/role rules. The browser can restrict the answer for device/evidence/learner state; it cannot enable server-denied actions. Regenerate catalogue facts/schema artifacts with the existing exporter; do not hand-edit generated descriptors or add policy copies.
5. Use `LessonContext`, audience-based `lessonPageUrl()`, and the existing generation-protected pager. Never infer routing from media keys or add independent Act-specific open/share branches across shell callbacks.
6. Use `PracticeRuntime` and existing plan/transport contracts. No additional authoritative session clock/controller. Visual animation loops may observe the clock. Use existing resource bags, access guards, abort/generation checks, and release acquired devices/audio/recording/workers/listeners on cancellation, access loss, route change, and unmount.
7. Scope progress/preferences/attempt fallback by account, lesson, revision, and plan as appropriate. Preserve the legacy body progress adapter; no silent persistence-authority switch or dual-write. Preserve exact revision identity and server-newer import protection.
8. Use strict private/public readers. Never fabricate pose data/GLBs, relabel video as JSON, or cast malformed content into another Act. Public video-only body has null landmarks and cannot enable assessed practice/challenge without an approved pose reference.
9. Keep private save, explicit review, and publication separate. Publishing an accepted revision must not publish newer private edits. Reuse existing revision handoff/invalidation functions.
10. Preserve literal lazy entries and editor/practice bundle isolation. Specialize in registry/adapter and typed format boundaries rather than spreading new Act-id workflow conditions across shared screens.

## Current state and compatibility

Consolidation is in progress. Inspect current imports and any `docs/act-platform-consolidation-ledger.md` status before assuming a phase is complete. Legacy shell dispatch and duplicated sharing/session coordination are migration targets, not templates to copy. Make bounded extractions with real migrated callers/tests when needed; do not add a parallel replacement framework or execute the entire plan during an unrelated task.

The application is in `apps/web/src/` and `apps/api/`. `web/dist/pose.js` is currently shared scoring source despite its directory name. Verify imports before treating a file as generated or obsolete.

Keep SAM default while MediaPipe qualification is pending. Preserve schema negotiation, pipeline identities, historical attempts/rubrics, accepted references, and existing URLs. Document deliberate architecture changes in the guide and affected contracts/tests; do not silently diverge.

## Verification and handoff

- Test affected behavior and existing Act compatibility. Import/source checks can verify boundaries; helper-name assertions do not prove workflow behavior.
- Use the existing web runner, e.g. `npm --prefix apps/web test -- --file tests/lesson-context.test.ts`; run `npm --prefix apps/web run build` for relevant frontend/type/bundle changes.
- Run relevant API/worker pytest suites using the appropriate installed environment. For contracts run `python -m apps.api.export_lesson_schemas --check`.
- Report what was reused, changed, tested, and remains unverified. Do not claim CPU, PostgreSQL, browser/device, or performance acceptance from mocks/build success. Preserve unrelated work; keep credentials/generated assets out of commits.

For runners without automatic repository-instruction discovery, pass: **Read `AGENTS.md` and `docs/act-platform-guide.md` before editing. Reuse shared functions/UI and preserve Engine/Act boundaries. Inspect production callers; consolidation-plan items remain pending until implemented.**
