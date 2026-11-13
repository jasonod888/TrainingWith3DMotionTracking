# Expression reference data contract

Status: annotation contract for future human/controlled qualification. No reference data
in this form has been collected yet.

## Performance record

```json
{
  "reference_version": 1,
  "performance_id": "unique-performance",
  "piece_id": "unique-piece",
  "instrument": "piano",
  "instrument_identity": "make/model or sample identity",
  "recording_identity": "room/microphone/gain note",
  "split": "development|calibration|holdout",
  "audio_sha256": "64 hex",
  "analysis_wav_sha256": "64 hex",
  "notes": [
    {
      "event_id": "reference-note-1",
      "pitch": 60,
      "onset_seconds": 1.25,
      "audible_end": {"earliest": 1.80, "latest": 1.96, "unscorable": false},
      "audible_end_note": "release still audible under room tail",
      "calibration_id": null,
      "key_release_seconds": null
    }
  ]
}
```

## Rules

- `audible_end` is the annotator’s interval for when the target note becomes inaudible.
  An exact timestamp is optional; the interval is authoritative.
- Mark masked, inseparable or ambiguous endings `unscorable: true`; they must never be
  counted as correct edits.
- `key_release_seconds` is diagnostic only and must not substitute for `audible_end`.
- Written duration is not accepted as a duration target.
- Dynamics references must identify the calibration artifact:
  `calibration_id`, instrument/recording domain, velocity layers and units. Linear
  rendering gain without a calibrated mapping is not a velocity reference.
- The same performance may not appear in development/calibration and holdout.
  Instrument or recording domains should be reserved for generalization claims.

## Scoring contract

`scripts/validate_expression_reference.py` validates this annotation form before it is
used: unique note identities, ordered audible-ending intervals, unscorable marking and
audio identity are required. `key_release_seconds` is retained only as a diagnostic and
cannot be substituted for an audible interval.

For each matched event, retain:

- event identity and fixed one-to-one pitch/onset match;
- source reference value or interval, units and tolerance;
- before/after values;
- candidate interval and abstention reason;
- correctness, improvement and damage derived from those values;
- exclusion reason for unscorable/calibration-missing cases.

An ending inside the same valid interval as the baseline is not a demonstrated
correction. Missing calibration or an unscorable target is never a correct edit.
