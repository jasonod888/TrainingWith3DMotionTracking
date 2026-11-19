# Act platform guide

## 1. Shipped architecture

The platform separates **Act identity** from **subject**, **experience family**, **instrument**
and **document schema**:

- `apps/api/acts.py` — versioned, data-only Act descriptors (capabilities, inputs, modes,
  assessment adapters, publication representations).
- `apps/api/subjects.py` — catalogue; one subject maps to exactly one Act.
- `packages/lesson-schema` — strict body/music/drawing readers and the only loading union.
- `apps/web/src/app/lesson-context.ts` — one neutral `LessonContext` per lesson/revision,
  with SHA-256 reference caching and permission/release revalidation.
- `apps/web/src/acts/registry.ts` — lazy practice entries per Act. Shared screens never
  import an Act editor directly.
- `apps/api/publication.py` — role-based public projection (`poster`, `playable_preview`,
  `reference`, `interactive_data`, reserved `instructor_media`); raw source never public.
- `apps/api/social.py` — Act-neutral discovery items, deterministic recommendations and likes.
- `apps/api/practice_progress.py` — plan-scoped progress and attempt envelopes.
- `apps/api/rollout.py` — four temporary flags with named removal conditions.

## 2. Capability matrix

| Capability | `full_body` (SAM) | `full_body` (MediaPipe) | `piano` | `guitar` | `drawing` |
| --- | --- | --- | --- | --- | --- |
| Document | v1 body | v1 body | v2 music | v2 music | v3 drawing (`visual`) |
| Creation input | video | video | video/audio | video/audio | image/video |
| Editor | sections, 3D stage | sections, video-only preview | notes/positions/feedback policy | TAB/chords/tuning | ordered steps |
| Review | check movement | video/landmark check | reference review | reference review | step review |
| Practice modes | watch, practice | watch, practice | watch, practice | watch, practice | watch, practice |
| Evidence input | camera | camera (or none when video-only) | MIDI/microphone | MIDI/microphone | pointer/stylus |
| Assessment | movement adapters | deployment-dependent | piano notes / unassessed | guitar notes / unassessed | **none** (`no_assessment_adapter`) |
| Challenge | supported when assessment ready | supported when assessment ready | deployment flag + reviewed reference | no | no |
| Public roles | `interactive_data` | `playable_preview` | `poster`, `playable_preview`, `reference` | same | `poster`, `reference` (steps inline) |
| Public requirement | Phase 5 policy | Phase 5 policy | Phase 5 policy | Phase 5 policy | Phase 5 policy |

Unknown Acts are still refused; title/filename never infer identity.

## 3. Adding another Act

1. **Catalogue**: add an `ActId`, descriptor and subject mapping in `acts.py`; add the
   subject/family in `subjects.py`; update the exact-set tests.
2. **Contract**: define a discriminated document with `extra='forbid'`; add a strict
   TS reader and dispatch in `parse.ts`; never reuse a body/piano schema.
3. **Capabilities**: map capabilities honestly. Empty `assessment_adapters` must produce
   `no_assessment_adapter`, not a fake score.
4. **Review readiness**: add a family-specific `readiness_for` branch (what "playable"
   means for this medium) and editor labels.
5. **Practice**: build one `PracticePlan`/transport adapter over the existing
   `PracticeRuntime`; do not add a second runtime or timer. Use `createResourceBag` for
   every acquisition/subscription.
6. **Publication**: choose allowed roles and how they map to representations; extend
   `role_assets`/`project_manifest` only if the medium has a new asset shape. Never expose
   private source.
7. **Social/discovery**: actions are derived from descriptor modes and actual assets;
   no shared screen may branch on Act ids beyond registry/labels.
8. **Frontend**: register a lazy practice entry, add a `LessonDocument` kind, extend
   `LessonContext` assets/feedback, and add a host branch. Keep the editor out of the
   practice graph.
9. **Tests**: backend journey (create → review → publish → discover → access loss),
   frontend parser/context/adapter/lifecycle, source boundary, query budget if listing.
10. **Rollout**: only add a flag if the surface needs an independent kill switch, and
    write its removal condition in the same commit.

## 4. Compatibility rules

- Body v1 and music v2 clients keep working for lessons they already understand.
- `X-Lesson-Formats` advertises supported document versions; music still requires `2`.
- Public projections are role-filtered; changing visibility never mutates a revision.
- Practice progress is scoped by plan; body legacy progress remains authoritative for body.
- Temporary flags gate surfaces only; stored revisions, acceptances, jobs and likes remain.

## 5. Source of truth

For measured costs see `docs/act-platform-phase7-measurements.md`; for the drawing
extensibility evaluation see `docs/act-platform-phase8-extensibility.md`; for rollout
steps see `docs/act-platform-rollout-runbook.md`.
