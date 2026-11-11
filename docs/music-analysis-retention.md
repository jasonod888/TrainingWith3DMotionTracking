# Basic Pitch analysis artifact and retention

## What is retained

For each profiled Basic Pitch music draft the worker writes an internal `analysis.zip`:

| File | Content |
|---|---|
| `raw.npz` | float32 `note`, `onset` and `contour` activation arrays |
| `proposal.mid` | MIDI decoded with the recorded settings |
| `proposed-reference.json` | the original unreviewed proposal |
| `metadata.json` | model/version, weights/profile/config/audio/source SHA-256, sample rate, thresholds, decoding settings, array shapes, note count, MIDI hash |

The worker uploads it as the `analysis` role. The server copies it to
`lessons/{lesson_id}/{draft_id}-analysis.zip`, records a `LessonAsset`, and never adds it
to the lesson manifest or reference.

## Access

- Owner-only: `GET /api/lessons/{lesson_id}/music-analysis` returns metadata.
- Owner-only: `GET /api/lessons/{lesson_id}/music-analysis/artifact` streams the zip.
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
