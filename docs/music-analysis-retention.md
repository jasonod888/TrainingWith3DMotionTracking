# Basic Pitch analysis artifact and retention

## What is retained

For each profiled Basic Pitch music draft the worker writes an internal `analysis.zip`:

| File | Content |
|---|---|
| `raw.npz` | float32 `note`, `onset` and `contour` activation arrays |
| `proposal.mid` | MIDI decoded with the recorded settings |
| `proposed-reference.json` | the original unreviewed proposal |
| `baseline-reference.json` | comparison decode with the legacy thresholds, when the piano peak decoder is used |
| `verification.json` | the optional diagnostic/qualified verification report: findings, evidence, proposed edits, phase-4 expression proposals and provenance |
| `verification-proposal.json` | an alternative proposal with supported edits applied, clearly marked as unreviewed; never replaces the baseline |
| `metadata.json` | model/version, weights/profile/config/audio/source SHA-256, sample rate, thresholds, decoding settings, array shapes, note count, MIDI hash, verification status/version/settings hash, correction mode and policy digest |

The verifier never changes `proposed-reference.json`. Its findings and any
suggested edits are separate; `metadata.json` records whether verification ran, its
version and whether it was unavailable. Owner accept/reject decisions are stored in
`music_verification_decisions` with the complete edit snapshots, report digest and
audio hash. Accepted decisions are reconstructed from those snapshots, not from the
expiring archive. Qualified corrections are applied before owner review to
`music_drafts.working_document`; the immutable baseline stays in `music_drafts.document`
and every automatic edit is retained in `correction_history`, including reverted entries.
The same history records applied phase-4 expression attributes (audible duration and
relative dynamics) with their original values and policy digests. This lets the owner
restore the original notes without deleting the audit trail.
`docs/music-piano-verification.md` documents the report schema, review flow and the
measured limits of the prototype.

The worker uploads it as the `analysis` role. The server copies it to
`lessons/{lesson_id}/{draft_id}-analysis.zip`, records a `LessonAsset`, and never adds it
to the lesson manifest or reference.

## Access

- Owner-only: `GET /api/lessons/{lesson_id}/music-analysis` returns metadata.
- Owner-only: `GET /api/lessons/{lesson_id}/music-draft` returns the normal working
  notes. When qualified corrections were applied automatically it also returns
  `working_corrected`, the original `baseline_events` and `automatic_corrections` for
  optional comparison/rollback.
- Owner-only: `POST /api/lessons/{lesson_id}/music-draft/corrections/rollback` requires
  the exact draft ID and current working-state token, restores the original notes and
  marks the retained correction history reverted. Stale or older-draft requests are
  rejected.
- Owner-only: `GET /api/lessons/{lesson_id}/music-analysis/artifact` streams the zip.
- Owner-only: `GET /api/lessons/{lesson_id}/music-analysis/verification?draft_id=...`
  returns the retained verification report when available, plus owner decisions and the
  reconstructed working proposal. Once the archive expires, it returns 200 with
  `available: false`, `report: null` and the decisions/working proposal instead of
  hiding accepted work behind a 404.
- Learners, invitees and public readers receive 404, including through the generic asset
  route.
- The bucket/object remains private; there is no public URL.

## Retention

Default retention is **30 days** (`MUSIC_ANALYSIS_RETENTION_DAYS`). The policy is
documented in API metadata and enforced by:

```powershell
python scripts/prune_music_analysis.py --dry-run
python scripts/prune_music_analysis.py
```

The pruner deletes only `*-analysis.zip` assets older than the window. It never deletes
the original reference, source video, MIDI export or lesson.

## Re-decode without inference

```powershell
python scripts/redecode_basic_pitch_analysis.py analysis.zip --output variant.json \
  --onset 0.35 --frame 0.3 --no-infer-onsets --no-melodia --no-pitch-bends
```

The raw activations are reused; the original proposal is preserved. This is for diagnosis,
not for automatic note correction.
