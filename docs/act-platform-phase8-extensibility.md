# Act platform Phase 8 — Extensibility evaluation (`drawing`)

Status: implementation record for the fourth Act. The point of this phase is to
measure how much of the shared core actually stays shared when a genuinely different
medium is added.

## 1. Capability and data contract

`drawing` is registered as a first-class Act with its own subject and family:

| Layer | Value |
| --- | --- |
| Act id | `drawing` |
| Subject | `drawing` (label “Drawing”) |
| Experience family | `visual` (a third family, not coerced into body/music) |
| Document | `schema_version: 3`, `experience_family: 'visual'`, `subject: 'drawing'` |
| Payload | ordered `steps[]` (`id`, `title`, `instruction`, optional `reference_guide`/`media_role`), `medium` (`pencil`/`charcoal`/`digital`), explicit `assessment: 'none'`, optional `poster`/`reference_guide` assets |
| Assessment | none; `canAssess` is `unsupported` with reason `no_assessment_adapter` |
| Practice | `watch` + `practice` (unassessed); no challenge; `pointer_stylus` input |
| Publication | `poster` + `reference` roles; the reference is the ordered steps themselves |

The Python and TypeScript readers both reject body fields (`animation`, `landmarks`,
`engine`) and music fields (`reference` events, instrument) on a drawing payload.
No drawing lesson is stored as a body or piano manifest.

## 2. Step-vs-time transport evaluation

Drawing authoring produces no video or audio timeline. Forcing it into the body/music
media clock would have meant inventing durations and showing a meaningless playhead.

Decision: the transport’s position **is the step index**. `duration = steps.length`,
`seek(i)` selects step i, `play/pause` only reflect whether the learner is in the
step sequence, and there is **no `advance` implementation**. `PracticeRuntime`
remains the only session authority; the adapter never creates a timer, and step
selection is explicit (`select`/`seek`) rather than wall-clock progression.

Trade-off: the runtime cannot auto-complete a drawing lesson from time alone. The
surface exposes explicit Previous/Next/Finish actions, and completion is an
unassessed personal attempt (`status: 'unassessed'`), never a score.

## 3. Shared-core touchpoints that had to change

| Touchpoint | Change |
| --- | --- |
| `apps/api/acts.py` | `ActId`, descriptor, subject mapping, publication policy, creation input `image` |
| `apps/api/subjects.py` | `visual` family, `drawing` subject, validation branch |
| `apps/api/contracts.py` | `DrawingStep`/`DrawingLessonManifest`; summary family `visual` |
| `apps/api/publication.py` | inline `steps` as the `reference` role; drawing `poster` field; private guide/poster/steps nulling |
| `apps/api/editor_lifecycle.py` | `visual` readiness: playback valid iff ≥1 valid step; assessment always unavailable |
| `apps/api/social.py` | steps count as a playable source; poster fallback |
| `apps/api/lessons.py` | drawing summary poster/section count/live input |
| `apps/api/drawing.py` | create + save private ordered steps; no processing route |
| `packages/lesson-schema` | drawing types, strict parser, `schema_version: 3` dispatch, summary `visual` rules |
| `apps/web/src/app/lesson-context.ts` | drawing compatibility adapter and asset/readiness mapping |
| `apps/web/src/acts/registry.ts` + `act-capabilities.ts` | drawing Act id, support descriptor, lazy practice loader |
| `apps/web/src/LessonExperienceHost.tsx` | drawing practice entry (lazy); no body editor |
| `apps/web/src/LibraryApp.tsx` | drawing state and practice route; public open builds drawing context |
| `apps/web/src/social/discovery.ts` | drawing label/subject mapping |
| Phase 1 Act-set tests | exact set now includes `drawing`; unknown `singing`/unknown ids still refused |

Nothing in the shared feed, lifecycle, publication or practice runtime branches on
drawing beyond these registration points; the drawing-specific code is under
`apps/web/src/acts/drawing/` plus two small backend modules.

## 4. No fabricated manifests, no second runtime

Confirmed:

- `DrawingLessonManifest` has no `animation`, `landmarks`, `section_set`, `engine`,
  `reference` events or instrument. The strict readers refuse them.
- Drawing practice uses the existing `PracticeRuntime` with a step-index transport.
  No timer, interval or second controller was added.
- Scores are never produced: the editor and practice surface say “Unassessed”, and
  the neutral attempt envelope records `status: 'unassessed'` with no adapter.

## 5. Verification

- `tests/api/test_drawing_act.py` covers create → private save → readiness → accept →
  public release (`reference` role) → discovery (`act=drawing`) → detail → like →
  private edit preserving the release → stale-base conflict.
- `apps/web/tests/drawing-act.test.tsx` covers the discriminated parser, context
  capabilities, step transport (no `advance`/fake timestamps), editor lifecycle
  labels, unassessed practice completion, and import isolation.
- Phase 8 did not re-run the full suite here (shell unavailable); the handoff lists
  the focused commands.

## 6. Deferred

- No drawing editor route in the shell yet; `DrawingEditorEntry` is implemented and
  tested directly, while the app opens drawing lessons in practice.
- No drawing image/asset pipeline; poster/reference-guide assets are optional
  pre-existing assets, and the public reference is the steps document.
- Public drawing detail uses the neutral social detail; a dedicated drawing viewer is
  a later presentation task.
