# Piano reconstruction: A0/B/C foundations, W1 hardening and W2 licensing — 12 November 2026

**Follow-up review:** the developer receipt below is a historical snapshot. Further issues
were found and fixed in qualification, sampler measurement/identity, split metadata and the
listening instrument. See [the independent follow-up fixes and verification](piano-reconstruction-followup-fixes-2026-11-12.md)
for the current result, protocol 0.3.0 and the real-source diagnostic. That diagnostic is not
evidence of better notes or a faithful piano renderer.

## Delivery status

Implemented and tested: rights preflight, versioned performance contract, resolved-request
renderer interface, objective v2 and the comparison harness, W1 hardening, W2 licensing, W5
Vienna ingestion, W4 inventory/probes/runner/measurement, the W3 listening instrument, and the
seven corrections raised in the independent handoff review. **Not implemented:** a real engine
render (no sfizz binary or Salamander samples), adapter benchmarking (W6), refinement (W7),
product integration (W8), qualification (W9) and activation (W10), and no human listener has
run the instrument. No accuracy, fidelity or indistinguishability claim is made or supported.

Corrections of earlier wording: paired-data readiness is **partial** (one audio file for 88
MIDI performances), W4 needed runner and measurement code as well as assets, and the Kong
runtime already exists in the research environment, so W6 is packaging and benchmarking work
rather than a runtime acquisition.

The renderer on the fidelity path is still absent. `SfizzRenderer` refuses to render until
an engine, a pinned asset and opcode probes exist. The harness renderer is an explicitly
approximate additive reference.

## W1 — foundation hardening

Every finding in the review's section 3 was reproduced against the working tree before it
was fixed, and none now passes as a valid comparison.

| Finding (reproduced) | Change | Regression test |
|---|---|---|
| A legacy duration changed the samples while the render identity stayed equal | Identity is now the hash of a resolved `RenderRequest` that synthesis also consumes: resolved note-off, `release_source`, pedal-derived `sounding_end`, `damped_by_key`, intensity, output extent, renderer version, asset hash and settings | `test_legacy_duration_changes_audio_and_invalidates_identity` |
| Source duration changed 8000 → 16000 frames with an unchanged identity | Resolved extent and frame count are part of the request | `test_source_extent_changes_output_length_and_identity` |
| A 2 s reference compared with its 1 s prefix scored objective 0.0 | `compare()` takes a declared interval; a short candidate raises `IncompleteCandidate` by default, and silent padding is scored when explicitly allowed | `test_a_short_candidate_cannot_score_a_perfect_prefix` |
| A fractional pedal value was silently thresholded | `pedal_semantics()` classifies binary/continuous; continuous values require `half_pedal` support or an explicit downgrade | `test_continuous_pedal_requires_half_pedal_support` |
| The harness scored its own `latency_samples` argument, ignoring the renderer | Latency is resolved from `RenderResult` by default; an override is recorded with `latency_source` | `test_latency_comes_from_the_renderer_by_default`, `test_latency_override_is_recorded` |
| The report hash identified the float buffer, not the file users hear | The delivered PCM is written, decoded and scored separately, with both hashes recorded | `test_delivered_audio_is_scored_separately_from_the_float_render` |
| Legacy-derived releases were not disclosed as estimates | Release sources are counted per note and warned about separately from assumed releases | `test_legacy_release_is_an_estimate_and_is_disclosed` |

Additional structural changes:

- `performance.render_identity()` was removed rather than patched. There is now one identity
  concept, and it cannot diverge from synthesis because both read the same request object.
- Notation-only and provenance-only edits leave the identity unchanged by construction;
  `test_identity_ignores_provenance_and_notation_only_edits` pins that.
- The harness emits `diagnostic_only`, `valid_for_qualification`, `blocking_reasons`,
  `advisory` and `blocked_targets`. An approximate renderer is always diagnostic only, so a
  reduced objective cannot acquire release approval.
- `inspect_wav()` validates the header and the bounded 900 s limit before any array is
  allocated; payload reading happens afterwards.

## Objective v2

`piano-reconstruction-objective-2` replaces v1. Changes: an implementation hash over the
measurement code, raw component distances beside smooth bounded display values, a
non-saturating `ranking` value, an octave-band component so a chroma match cannot certify
octaves, FFT windows derived from target durations per source rate, and streamed spectral
accumulation to bound memory.

v1 results are preserved below as history rather than overwritten.

## W2 — exact licensed model entries

The blanket block on ByteDance was too broad and is corrected. The training repository
stays restricted; the author's separately published inference package and checkpoint are
now separate approved entries.

| Source | Licence | Verified artifact |
|---|---|---|
| `bytedance-piano-transcription` (training repo) | none | no LICENSE file; all uses unresolved |
| `kong-piano-inference-package` | MIT (PyPI classifier) | wheel sha256 `64348200…` |
| `kong-piano-checkpoint-4034264` | CC BY 4.0 | md5 `22b961b7…`, sha256 `c3fa9730…6141`, 171,966,578 bytes |
| `transkun-checkpoint` | MIT code + bundled weights | upstream `Yujia-Yan/Transkun`; model use unresolved, publication approved |
| `veloest-sfproxy` | CC BY 4.0 **declared in README** (no LICENSE file) | base `8cede73a…`, adapted `d22e589b…` |
| `veloest-score-hpt` | MIT notice | same pinned revision |

The local `.local/piano-diagnosis/reference-packages/piano.pth` was independently hashed and
matches the Zenodo record exactly (md5, sha256 and byte count), so the checkpoint in hand is
the CC BY 4.0 release. Preflight now approves it for `model_selection`.

VelosEst's grant is a README declaration, not a licence file; that is recorded as the
evidence, and hosted inference remains unresolved pending a firmer grant.

## Review corrections (handoff review, 12 November)

Each finding is fixed and pinned by a regression that reproduces the reported probe.

| Finding | Fix | Regression |
|---|---|---|
| Qualification ignored unresolved identity and uncertain endings | Qualification takes verified source identity; undeclared or mismatched identity blocks **every** target; each target is judged separately | `test_missing_source_identity_blocks_every_target`, `test_uncertain_audible_ends_block_only_that_target`, `test_measured_attributes_leave_their_targets_qualified` |
| Included SFZ files were not hashed, yet the artifact claimed `dependencies_hashed` | Every expanded file is hashed with a root-relative path and an aggregate digest; the flag is derived from coverage; samples are counted and missing ones disclosed | `test_inventory_hashes_every_included_file`, `test_changing_an_included_value_changes_the_aggregate_digest`, `test_missing_include_disables_the_hashed_claim` |
| Split validation accepted duplicates, omissions and contaminated performer sets | Bijection over performance paths, one split per performer, assignment/mapping agreement, exact corpus coverage, and an independent inspected-material check | `test_validation_rejects_a_duplicated_assignment`, `_an_omitted_performance`, `_a_performer_moved_between_splits`, `_overlapping_performer_sets`, `_an_inspected_performance_in_holdout` |
| Listening submissions could be counted twice or without study identity | Study identity is required; a missing or different hash excludes; duplicate ratings and duplicate listeners are quarantined; timestamps must be valid and durations non-negative | `test_a_required_study_identity_is_enforced`, `test_duplicate_ratings_within_one_submission_are_excluded`, `test_duplicate_submissions_are_quarantined_not_double_counted`, `test_invalid_or_missing_timestamps_are_excluded`, `test_negative_session_duration_is_excluded` |
| Browser progress could cross studies | Progress is keyed and validated by analyst manifest hash, instrument version, listener and rotation; finished sessions are recognised; the logic moved to `protocol.js` and is tested with node | `selftest.mjs` (run from pytest), `test_instrument_protocol_selftest_passes` |
| Improvement had no paired interval and picked the winner post hoc | Predeclared comparisons with a paired clustered bootstrap over the same listener/excerpt cells; post-hoc derivations labelled exploratory; conclusions suppressed below minimum coverage | `test_analysis_decodes_roles_and_reports_paired_gain`, `test_paired_interval_reflects_listener_disagreement`, `test_a_predeclared_comparison_is_not_labelled_exploratory`, `test_conclusions_are_suppressed_with_too_few_listeners` |
| Candidate identities were visible in the browser | Opaque per-item asset names, a separate `study.browser.json` with no roles, and a shuffled candidate order so position carries no role; the analyst copy holds decoding, and the browser echoes only its hash | `test_browser_manifest_hides_roles_and_uses_opaque_names` |

Qualification is now target-specific: `targets` reports each of audio fidelity, stereo/room
fidelity, release, velocity, audible end and pedal separately, `qualified_targets` lists the
supported ones, and `blocked_targets` carries the reasons. An approximate renderer remains
diagnostic, and the mono-mixed objective keeps stereo/room unqualified.

## W5 — Vienna development subset

`scripts/prepare_vienna_dataset.py` parses Standard MIDI Files directly, so ingestion runs in
the numpy/scipy-only CI environment and the parser version is a recorded identity rather than
an undeclared dependency. It writes a dataset manifest, a feasibility table, a split proposal
and a validation report.

The counts independently reproduce the register using a different parser: **88 primary
performances, 24 excluded files (22 excerpt + 2 averaged), four works x 22 performers, 43,656
notes**.

Validation findings on the real corpus:

| Check | Result |
|---|---|
| Sustain CC64 present | 88/88 |
| Soft pedal CC67 present | 88/88 |
| Note-on/off pairing | complete; 0 unmatched, 0 unclosed |
| Captured releases under the pedal | 27,755 note offsets occur while CC64 is down |
| Excerpt variants shorter than the full work | 22/22 |
| Split disjoint and complete | 22 performers partitioned exactly once |

**Advisory, not a pass:** the paired `Chopin_op38_p01` performance's **last event** is
+2.326 s after the audio ends. Separated properly, the last note release is at 126.175 s
(inside the 128.199 s recording), while the last controller — the final pedal-up — is at
130.525 s. That is an end-of-file comparison, **not evidence of note-timing misalignment**, and
scoring must use an explicit interval inside the audio.

**Paired-data readiness is partial.** The manifest indexes 88 primary MIDI performances but
only **one** audio file, so `audio_pairs` has one verified-name pair with
`alignment_verified: false`. Metadata ingestion is complete; paired-data preparation is not.
A small explicitly paired development subset must be acquired and independently aligned before
any scored holdout.

**Split feasibility, computed before the split is frozen.** A held-out performer contributes
at most one performance per work, and fewer once no-edit or ambiguous cases are removed, so
these ceilings are optimistic:

| Held-out performers | Ceiling | Headroom over 40 | Remaining performers |
|---|---|---|---|
| 9 | 36 | -4 (fails at ceiling) | 13 |
| 12 | 48 | 8 | 10 |
| **13** | **52** | **12** | **9** |
| 14 | 56 | 16 | 8 |

The proposal defaults to 13 holdout / 3 calibration / 6 development performers, ranked by a
seeded hash so it is reproducible. `Chopin_op38_p01` is forced into development because it was
inspected during earlier work; it can never be presented as untouched holdout.

Not verified here: independent audio alignment (only duration agreement), and audible endings
(no human annotations exist yet).

## W4 — sampler inventory and probe suite

`scripts/probe_sampler.py` expands the pinned SFZ with **in-position** include handling and
in-order macro substitution, which the upstream mapping requires: its includes sit inline
inside `<group>` lines and a later include consumes macros an earlier one defined. Resolving
against the including file's directory instead of the root silently dropped 16 velocity-layer
files until corrected.

Inventory of `Salamander Grand Piano V3.sfz` (24 files expanded, no missing includes):

- sha256 `c8b282f0…7837`, 1,121 regions, 69 distinct opcodes.
- Headers: 1 control, 3 global, 4 master, 42 group, 1 curve, 1,121 region.
- Controllers: 7, 10, 20, 21, 22, 64, 72, 98, 99 — i.e. volume, pan, string resonance, hammer
  noise, pedal noise, sustain, release time, sample offset and velocity tracking.

`renderer-selection.json` is written with `decision: "blocked"` and explicit blockers: no
engine, no samples, and **641 of 641 referenced sample files absent**. Every included mapping
file is hashed with an aggregate digest, so changing an included value invalidates the mapping
identity even when the opcode counts are unchanged.

The runner and measurement code now exist. `execute()` renders every probe through a supplied
engine callable (or a command template), measures level, brightness, segmentation, tail and
determinism, and derives per-feature diagnostics with their evidence. Core note-off, repeated
strikes, dense-polyphony and sustain/lift behavior are mandatory even when implemented by the
engine without explicit mapping opcodes; optional mapping-specific features are added as needed.
Release-sample support remains untested without controlled ablation. The selection
artifact distinguishes `blocked`, `pending-probes`, `failed` and `passed`. A deterministic fake
engine drives these paths in the tests, so the evidence is that the harness works, not that
sfizz renders.

A static opcode inventory is still **not** a capability result: the runner exists, but no real
engine render has been produced here.

## W3 — listening instrument v0.1 (software)

`scripts/build_listening_study.py` builds a study from a spec, `scripts/analyze_listening_study.py`
analyses exported sessions, and `tools/listening-instrument/` is a dependency-free local
questionnaire (no build step, no framework).

**One common treatment.** Every stimulus is cut to the declared interval and multiplied by a
single gain derived from the *reference*. Candidates are never loudness-matched individually,
because that would hide the dynamic balance listeners are asked to judge. A declared fixed
latency is removed before slicing; a candidate at a different sample rate is refused rather
than resampled.

**Controls are generated, not supplied.** Each excerpt gets a hidden reference (identical
processing) and a degraded reference (a documented 120 ms shift plus 3 dB attenuation) used
only as a low anchor.

**Anonymity with an audit trail.** The builder emits 24 deterministic rotations ranked by
SHA-256; the label-to-role mapping differs per participant. A session picks its rotation by the
documented rule *sum of UTF-16 code units of the participant code modulo the rotation count*,
mirrored exactly in the browser. The role/rotation key stays in the analyst `study.json`, while
the browser loads `study.browser.json` with opaque per-item asset names and a shuffled
candidate order, so neither the filename nor the position reveals a role. The export records
the rotation and the analyst manifest hash, so roles are decoded without the listener seeing
them.

**Immutable studies.** Every stimulus hash is in `study.json`; `--verify` re-hashes the audio
and fails on any change, and the builder refuses to overwrite a non-empty study directory.

**Analysis with the declared rules.** A submission must declare the expected study identity.
Sessions are excluded for a missing or different identity, missing or duplicate ratings,
duplicate submissions from one listener (quarantined, not double-counted), invalid timestamps,
a negative duration, running past the session cap, or straight-lining; a listener is *not*
excluded for noticing a defect. Uncertainty is a percentile bootstrap resampling listeners and
excerpts separately, and improvement is a **paired** difference over the same cells with its own
clustered interval. Comparisons derived post hoc are labelled exploratory, and conclusions are
suppressed below five listeners or two excerpts. The report states the scale boundary in words:
the scores are similarity judgements, not an identity probability, and no objective value may
replace them.

Smoke evidence (wiring only, invented scores):

- A study built from the real 44.1 kHz stereo Vienna recording at interval 20-30 s produced
  **5 stimuli and 24 rotations**, and `--verify` reported `ok: true`.
- One synthetic session analysed end to end produced hidden reference **92**, degraded
  reference **18**, model-only **55**, refinement **63**, a **+8.0 point** gain and both
  attention checks passing.

**No human listener has used it.** The 12-listener pilot remains undone, so this is software,
not listening evidence.

## Verification receipt (developer snapshot, before follow-up fixes)

- Date: 2026-11-12, 12:26 (+08:00), after the review corrections.
- Command: `python -m pytest -q` from the repository root.
- Interpreter: `.venv-saas/Scripts/python.exe`, Python 3.12.2.
- Dependencies: `PYTHONPATH=.venv-music/Lib/site-packages` (numpy 2.5.4, scipy 1.18.1,
  soundfile 0.14.0, librosa 0.10.2, onnxruntime 1.31.1, basic-pitch). The instrument
  protocol self-test runs with node v22.18.0 from within pytest.
- Result: **684 collected, 670 passed, 14 skipped, 0 failed** (8 min 11 s).
- Focused package subset: **207 passed** across `test_piano_rights`,
  `test_piano_performance`, `test_piano_render`, `test_piano_reconstruction_metrics`,
  `test_piano_reconstruction_harness`, `test_prepare_vienna_dataset`,
  `test_probe_sampler` and `test_listening_study`.
- Worktree: `5f8e1b7d51082374efebaea8e6b88f51de127945` with uncommitted changes; the new
  piano-foundation files are untracked additions.

## History of earlier receipts

These are earlier runs under different dependency paths and are kept for auditing, not
repeated:

- CPU-only environment (`.venv-saas` alone): 562 collected, 546 passed, 15 skipped, 1
  failed — `test_piano_expression.py` imports `soundfile`, which exists only in the music
  environment.
- Music environment, before W1: 584 collected, 570 passed, 14 skipped, 0 failed.
- Music environment, after W1/W2 and before W4/W5: 606 collected, 592 passed, 14 skipped,
  0 failed.
- Music environment, after W4/W5 and before W3: 634 collected, 620 passed, 14 skipped,
  0 failed.
- Music environment, after W3 and before the review corrections: 652 collected, 638 passed,
  14 skipped, 0 failed.
- Objective v1 fixture: correct performance 0.000005, corrupted 0.459, spectral saturated
  at 1.0.

## Current synthetic sensitivity evidence (objective v2)

Local fixture in `.local/piano-reconstruction-demo/` (`make_fixture.py`). The reference is a
render, so the baseline is exact by construction and the increase is caused only by the
corruption: one onset dragged 60 ms, one note removed, one transposed, one velocity changed.

| Comparison | Objective | spectral | attack | loudness | pitch | octave | decay |
|---|---|---|---|---|---|---|---|
| Correct performance | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 |
| Corrupted performance | 0.354 | 0.587 | 0.438 | 0.242 | 0.236 | 0.153 | 0.100 |

The report also returned `diagnostic_only: true`, `valid_for_qualification: false` and
blocked targets `["audible_end", "audio_fidelity"]`, which is the intended honest outcome for
an approximate renderer with no measured audible ends. This demonstrates objective
sensitivity, not reconstruction quality.

## Remaining work and blockers

| Package | Status |
|---|---|
| W3 listening instrument v0.1 | done as software: builder, immutable study, questionnaire and clustered analyser; **no listener has run it** |
| W4 sampler spike | inventory, dependency hashing, probe runner and measurement done; **no real engine render**: no sfizz binary and no Salamander sample archive obtained |
| W5 Vienna development subset | metadata ingestion and validation done; **paired-data readiness partial** (1 audio file for 88 performances), alignment and audible-ending annotation outstanding |
| W6 adapter benchmark | **not blocked on runtime**: the research environment already runs Kong (PyTorch 2.8.0+cu128 per the review) and earlier VeloEst experiments exist. Remaining: dependency isolation, approved-distribution identity, a maintained adapter, common-input event benchmarking and resource measurement. Not started here; my own import check in this shell did not find torch on the default path, so the isolated environment is not yet wired into these scripts |
| W7 refinement | blocked on W4 rendering and W6 |
| W8 integration | blocked on a real renderer; would also touch worker/API/editor beyond this slice |
| W9 qualification | blocked: needs untouched holdout and a staffed, powered listening study |
| W10 activation | blocked on W9 |

## Known limitations of this slice

1. The fidelity renderer is absent; every harness result is diagnostic only.
2. Objective v2 is mono-mixed; stereo, room and waveform identity remain unsupported.
3. The `ranking` value is monotone and smooth but **not calibrated** against listener data.
4. The Vienna subset has not been scored with a real renderer, and only one performance has
   an audio file. The follow-up review exercised the harness on the user's real source with
   an approximate renderer; that diagnostic does not establish reconstruction improvement.
5. The 900 s bound is a guard, not a tested throughput claim.
6. Vienna feasibility is a ceiling, not a plan: 13 held-out performers give at most 52
   performances against a 40-performance gate, and every no-edit or ambiguous case consumes
   that headroom.
7. The sampler inventory proves what the mapping declares, not what any engine does with it;
   the runner exists but no engine render has been produced.
8. The listening instrument is unblinded only in the sense that the *analyst* copy holds the
   roles; the browser copy does not. It has still never been used by a human listener.
