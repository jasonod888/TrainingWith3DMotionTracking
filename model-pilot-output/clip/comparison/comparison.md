# Raw piano model comparison

Source `5fb6b8929f15…`, interval [0.0, 15.616009].

| attribute | basic-pitch-native | basic-pitch-current-app | kong-piano | transkun-v2 | onsets-frames-piano |
|---|---|---|---|---|---|
| detected_notes | notes=51, per_second=3.266 (measured) | notes=36, per_second=2.305 (measured) | notes=38, per_second=2.433 (measured) | blocked_license | blocked_license |
| note_correctness | reference_unavailable | reference_unavailable | reference_unavailable | blocked_license | blocked_license |
| fine_timing | reference_unavailable | reference_unavailable | reference_unavailable | blocked_license | blocked_license |
| key_release | not_estimated | not_estimated | not_estimated | blocked_license | blocked_license |
| audible_end | not_estimated | not_estimated | not_estimated | blocked_license | blocked_license |
| velocity | not_estimated | not_estimated | reference_unavailable | blocked_license | blocked_license |
| pedal | not_estimated | not_estimated | reference_unavailable | blocked_license | blocked_license |
| written_rhythm | unsupported_semantics | unsupported_semantics | unsupported_semantics | blocked_license | blocked_license |
| practicality | backend=onnx, checkpoint_sha256=2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec, device=cpu, inference_seconds=10.22 (measured) | backend=onnx, checkpoint_sha256=2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec, device=cpu, inference_seconds=2.579 (measured) | backend=pytorch, checkpoint_sha256=c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141, device=cuda, inference_seconds=23.21 (measured) | blocked_license | blocked_license |

## Blocked rows

- **Transkun**: transkun-checkpoint:model_selection=unresolved
- **Onsets and Frames**: maestro:model_selection=prohibited

## Limits

- Attribute rows are not combined into an overall score or an automatic winner.
- A diagnostic or reference-unavailable state is not a pass or a failure.
- Model agreement is not evidence of correctness; only the reference measures it.
