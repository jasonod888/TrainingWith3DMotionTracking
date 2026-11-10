# Real private piano loop: status

10 November 2026. The worker profile and end-to-end private wiring are implemented. **A real
transcription has not been run**: no approved model artifact, commercial code/weights
evidence, rights-cleared recording, or deployed staging worker exists in this checkout.
No fixture result is presented as real inference.

## Delivered: exact run profile

`scripts/music_run_profile.py` binds one run to:

- `model` and `model_version`;
- SHA-256 digests of the installed **weights**, **code bundle/lock**, **inference
  configuration** and retained **commercial evidence**;
- sample rate, preprocessing description and bounded numeric thresholds;
- a deterministic `profile_sha256` over the profile fields.

The worker refuses to start without either a verified profile or an **explicit**
`--fixture` flag; it does not download a checkpoint or fall back to fixtures. The verified
profile JSON is passed to the adapter as `MUSIC_RUN_PROFILE`, and the worker writes
`profile_sha256`, model and model version into the draft provenance. The server records
that provenance with the draft and can require a profile with
`MUSIC_REQUIRE_RUN_PROFILE=true` (default off; enable for a real staging worker).

Example operator command (paths are illustrative; the model is not present here):

```powershell
python scripts/music_worker.py --pipeline music-piano-v1 --work-dir outputs/music-jobs `
  --profile model-profile.json --weights model.onnx --code worker-lock.txt `
  --config inference.json --approval commercial-approval.json `
  --adapter-command .venv-music/Scripts/python.exe path/to/approved_adapter.py
```

Fixture tests must pass `--fixture` and are clearly labelled as fixtures.

## Delivered: private loop wiring (synthetic)

`tests/api/test_private_piano_loop.py` exercises prepared clip → profiled worker draft →
watch-only review → invite-only release → separate learner acceptance and v2 detail. It
proves the wiring and access rules with synthetic media and a fixture adapter; it is **not**
model accuracy or real-audio evidence.

Browser preparation/upload continues to be covered by `scripts/verify_music_creation.py`
(real browser encoding; mocked multipart API); review, sharing and recipient access have
their own tests.

## Blocked until external inputs exist

1. Select and approve exact model code and weights; retain commercial-use evidence.
2. Provide a rights-cleared short piano recording.
3. Deploy an isolated staging worker with the real profile and piano enabled for the test
   cohort only.
4. Run actual inference, open the draft, correct notes/sections, save a watch-only reviewed
   reference.
5. Invite a separate learner and verify synchronized video/keyboard playback, release
   updates, revocation and inaccessible private replacement assets.
6. Exercise cancellation/retry and confirm private temp-asset cleanup.
7. Retain a sanitized run record and add at least three real reviewed acoustic benchmark
   cases.

## Verification

- `tests/api/test_music_run_profile.py`: bytes binding, deterministic digest, missing/
  unknown fields, invalid thresholds/sample rate, worker profile requirement and draft
  provenance injection.
- `tests/api/test_private_piano_loop.py`: synthetic profiled loop through learner access.
- Existing worker, draft, review and sharing tests; browser creation/review/sharing checks.

**Not claimed:** real inference, real-audio accuracy, commercial approval, deployed worker,
scoring or physical-device qualification.
