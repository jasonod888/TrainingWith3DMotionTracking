# Creator practice-feedback switch

Status: implemented and focused-validated. No commit, push, deploy, install, restart,
full suite or browser manual pass was performed.

## Contract

One optional, strict boolean is stored at the top level of an immutable lesson manifest:

```text
feedback_enabled: bool | null
```

- `true` / `false` is an explicit creator choice.
- `null` / absent is legacy and is derived for delivery only.
- Strings and numbers are rejected by Pydantic (`strict=True`); the TypeScript parser
  accepts only `boolean`, `null` or absent.
- It is deliberately separate from `assessment`, input permissions, scoring
  qualification and `reference_reviewed`.
- It is not written into the reviewed reference JSON, so `reference.sha256`,
  acceptance records and previously published revisions are unchanged.

No database migration was added. Pre-revision upload intent travels in the existing
`Conversion.preparation` JSON. New revisions/drafts carry the explicit boolean.

## Legacy fallback

`apps/api/music_assessment.py` resolves a delivery value without mutating stored JSON:

- explicit boolean wins;
- legacy music v2 with `assessment: none` stays **disabled**;
- legacy music with a non-none rubric stays **enabled**;
- legacy body v1 stays **enabled** (its prior availability).

Projection copies the manifest (`with_effective_feedback`). It never rewrites the
revision or its reference. Publication no longer requires note feedback, and the added
body pose-evidence publication gate was removed.

## Surface propagation

Upload:

- `apps/web/src/CreateLesson.tsx` has an **Enable practice feedback** switch, default On.
- `apps/api/conversions.py` accepts strict `feedback_enabled`, stores it in
  `Conversion.preparation`, and stamps it into the body manifest or music draft.
- The body worker completion test confirms Off survives processing while animation,
  preview and source assets are still produced.
- Replacements with no explicit new choice inherit the previous effective setting.

Review/save:

- Body: `apps/web/src/MoveCheck.tsx` reads and writes the setting; changed feedback
  creates an immutable new revision through `SaveSections` before acceptance.
- Music: `apps/web/src/music/MusicDraftReview.tsx` and the normal
  `PianoWorkspaceHarness` review surface read and write it.
- `apps/api/music_review.py` defaults new reviews from the draft (new drafts are On),
  preserves legacy watch-only as Off, and stores the explicit value.
- `apps/api/permissions.py` releases without a feedback/notes publication gate.

Editor:

- Body: `apps/web/src/SectionEditor.tsx` + `LibraryApp` + `api.saveSections`.
- Music: `PianoWorkspaceHarness` settings and save payload; `MusicLessonEditor` legacy
  form.
- Partial music/body edits that omit `feedback_enabled` preserve the current effective
  value; explicit false stays false. `assessment_for_subject` cannot reset the switch.
- The switch participates in dirty identity and save payloads.

Learner:

- `effectiveFeedbackEnabled` is shared by music and body surfaces.
- Creator Off shows **Feedback not enabled for this lesson**, disables learner
  overrides, and leaves the learner's localStorage preference untouched.
- `FeedbackChoice`, `PianoPracticeWorkspace`, `MusicLessonHome`, `MimicInterface` and
  `LessonExperienceHost` gate feedback/challenge/overlay paths.
- An active music listen/challenge/upload capture is cancelled when the setting turns
  Off; body scoring/pose overlays are suppressed while camera preview and ordinary
  playback continue.
- API attempt/history writes reject new feedback evidence with 409 when Off.

## Focused validation

All commands were run from `D:\3d_trainer\developement` unless noted.

| Check | Result |
| --- | --- |
| `.\.venv-saas\Scripts\python.exe -m pytest tests/api/test_universal_feedback.py -q -p no:cacheprovider` | 10 passed, 0.84s |
| `.\.venv-saas\Scripts\python.exe -m pytest tests/api/test_universal_feedback.py tests/api/test_workflow.py::test_body_feedback_off_persists_through_partial_section_edits tests/api/test_conversions.py::test_body_feedback_off_survives_processing_without_removing_preview -q -p no:cacheprovider` | 12 passed, 5.24s |
| `.\.venv-saas\Scripts\python.exe .local\dsh-practice\check_creator_switch.py` | exit 0, 3.4s. Seeded music review/edit/publish: review Off, omitted edit preserved Off, publish 200, attempt 409, strict string 422, reference hash changed, old revision preserved. |
| `apps/web`: `node --import ./tests/runner/register.mjs tests/feedback-choice.test.tsx` | 6 passed, 146ms |
| `apps/web`: `node --import ./tests/runner/register.mjs tests/feedback-preference.test.tsx` | 2 passed, 106ms |
| `apps/web`: `node --import ./tests/runner/register.mjs tests/music-feedback.test.mjs` | 13 passed, 17ms |
| `apps/web`: `node --import ./tests/runner/register.mjs tests/workspace-save.test.tsx` | 11 passed, 10.7s; includes an Off save-payload assertion |
| `apps/web`: `.\node_modules\.bin\tsc.cmd --noEmit` | exit 0, 11.1s |
| `python -m apps.api.export_lesson_schemas --check` | 3 schema artifacts current |
| `git diff --check` | exit 0 (line-ending warnings only) |

The normal web test runner could not spawn its file workers in this sandbox
(`spawn EPERM`). The approved in-process TypeScript loader was used instead; no runner
refactor was attempted.

`tests/api/test_music_review.py` and `test_music_attempts.py` were not completed through
their normal fixture: the real-media/music-worker path did not terminate inside the
90–120s bound. The seeded in-process check above exercises review, edit, publish and the
attempt gate without ffmpeg or a worker subprocess.

## Limitations

- No browser/manual device pass, screenshot or live-server check.
- No full repository suite, production build, install, restart, commit, push or deploy.
- Music upload-intent stamping in `conversions.draft` is type-checked but not exercised
  end-to-end by the seeded check (the seeded draft predates upload); body completion is
  exercised end-to-end.
- Existing pre-switch voice/music background changes were left intact.

## Try it

1. Upload a new body clip. Leave **Enable practice feedback** On, save the review, then
   edit it Off and publish. The learner should see the ordinary preview but no similarity,
   cues or new pose summaries.
2. Upload piano/guitar, turn feedback Off in review, save, edit and republish. The learner
   should see **Feedback not enabled for this lesson**; their stored learner preference
   must remain whatever it was.
3. Turn it back On, republish and reopen: feedback should follow the learner's own
   preference (default On, explicit learner Off preserved).
