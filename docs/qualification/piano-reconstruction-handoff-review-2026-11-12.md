# Independent review of the W1–W6 handoff — 12 November 2026

**Historical review:** this records the findings before the developer's corrections and the
subsequent independent fixes. See [the follow-up review and verification](piano-reconstruction-followup-fixes-2026-11-12.md)
for current behavior and remaining work. The issue descriptions below are retained as an
audit trail, not assertions that those original defects still exist.

## Verdict

Keep the implementation and continue from it. It provides useful foundations; it does not complete the reconstruction goal or demonstrate that corrected notes/playback match the user's video better. Several validation gaps still need correction before accepting all the delivered packages as complete.

This review checked the working tree at HEAD `5f8e1b7`, including uncommitted additions. Application code was not changed. Review probes and logs are under `.local/repo-research/`.

## Independently verified

- The eight package test files pass: **175 passed in 11.57 s**. There is a nonfatal Windows console destructor warning after pytest exits successfully.
- Full-suite collection reproduces **652 tests**. Independent full execution: **638 passed, 14 skipped, zero failures**, in **461.26 s (7 min 41 s)**. The two warnings concern deprecated Starlette/AnyIO and librosa resource APIs. The full run required local networking for API tests; the initial restricted run was interrupted and is not included in these results.
- The earlier legacy-duration identity, source-extent identity, incomplete-candidate and fractional-pedal defects no longer reproduce. The explicit permissive partial comparison pads and penalizes missing audio; it does not silently score just the matching prefix.
- Vienna ingestion reproduces **88 primary MIDI performances, 24 excluded variants, 43,656 notes, four works and 22 performers**. Its proposal assigns 24 development, 12 calibration and 52 holdout performances. These are proposal counts, not qualification results.
- Sampler inventory reproduces **24 expanded files, 1,121 regions and 69 opcodes**. Seven distinct probe MIDI files exist. The selection remains blocked and does not pretend to have rendered evidence.
- The existing listening smoke study passes stimulus verification: **one excerpt, five stimuli**. Its submitted ratings are synthetic wiring checks, not human listening evidence.
- The manifest preflight approves the exact Kong inference package/checkpoint for model selection. This confirms the configured policy, not a blanket approval of other distributions.
- An independent run of the existing research Kong runtime successfully transcribed the **first five seconds of the user's source audio on CPU**, producing 18 note events and two pedal events. This is runtime evidence only, not a transcription-accuracy result. PyTorch is `2.8.0+cu128`; checkpoint SHA-256 is `c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141`.

## Changes to send back to the developer

### 1. P1 — Qualification does not enforce unresolved identity or uncertain audible endings

Location: `scripts/piano_reconstruction_harness.py`, `verify_source_identity()`, `coverage()` and `qualification()`.

A missing declared source hash produces only a warning. `coverage()` counts uncertain audible endings, but `qualification()` never uses that count. In an independent direct guard probe with a non-additive renderer result, all releases marked measured, complete comparisons, a missing source hash and every ending marked uncertain, it returns `diagnostic_only: false`, `valid_for_qualification: true`, with no blocked targets.

The current additive renderer prevents this from becoming a real fidelity approval today. The guard nevertheless violates W1's contract and becomes unsafe when the real renderer is connected.

Required: pass verified source/asset/implementation identity into qualification; block missing or unresolved identity. Treat uncertain endings as unscorable coverage for the affected duration/audible-ending target. Make qualification target-specific so missing duration evidence does not incorrectly approve duration or unnecessarily forbid an unrelated independently qualified category. Keep unsupported stereo/room fidelity diagnostic until appropriate evidence exists. Add regressions using a non-additive test renderer; additive-only tests conceal these omissions.

### 2. P1 — Included SFZ dependencies are not actually hashed

Location: `scripts/probe_sampler.py`, `inventory()` and `selection_artifact()`.

`sha256` covers only the top-level SFZ bytes. `files` is a list of paths. Nevertheless the selection artifact claims `dependencies_hashed: true`. Changing an included region from `volume=-6` to `volume=-12` produces an identical inventory in an independent probe.

Required: record canonical relative paths, sizes and SHA-256 for every included mapping dependency and an aggregate digest. Once available, bind all referenced sample files and the engine binary/build too. Derive `dependencies_hashed` from verified coverage, and disclose missing samples. A changed include, sample or engine must invalidate the relevant identity and previous probe evidence.

### 3. P1 — Dataset split validation accepts contamination and missing performances

Location: `scripts/prepare_vienna_dataset.py:484` onward.

The validator compares assignment counts and the sum of performer-list lengths. Neither proves uniqueness, complete coverage or disjointness. Replacing one assignment with a duplicate of another passes validation. Replacing a holdout performer with a development performer, while preserving lengths, also passes.

Required: enforce a bijection between primary performance identities and assignments; reject duplicate, omitted and unknown files. Compare performer sets for pairwise intersection and exact corpus coverage. Verify assignment split labels against the performer-to-split mapping. Enforce inspected-material exclusions independently of the split generator. The current generated proposal appears sensible; the protection against a corrupted or edited proposal is missing.

### 4. P1 — Listening submissions can be counted incorrectly

Location: `scripts/analyze_listening_study.py`, `decode()`, `summarise()` and the CLI.

Independent probes show a submission with no study hash is included even when the expected hash is supplied; a duplicate candidate rating is included; and submitting the identical session twice counts it twice. The CLI also bypasses the schema-checking `load_sessions()` helper.

Required: require the expected study identity, validate the ratings schema, require exactly one rating per expected item/label, and apply an explicit duplicate-listener/session policy. Reject or quarantine conflicts instead of double-counting them. Require valid timestamps and reject negative durations rather than allowing invalid/missing timing to bypass the cap. Record exclusions with clear reasons. Make the analysis entry point verify the referenced stimulus build or require a verified study receipt.

### 5. P1 — Browser progress can cross-contaminate different studies

Location: `tools/listening-instrument/app.js`, `storageKey()`, `restore()` and `start()`.

Storage is keyed only by listener code. A JavaScript probe saved progress for study A, changed the study hash to B and successfully restored A's rating and position. Export then stamps the currently loaded study hash, so the analyzer cannot detect that those restored ratings came from another study. Resuming an already finished session can also restore an index beyond the item list.

Required: bind saved progress to study hash, instrument version, listener and rotation; validate those values and rating keys on restoration. Handle finished sessions explicitly. Test reload, changed study, changed rotation and completed-session resume.

### 6. P2 — Improvement uncertainty is missing

Location: `scripts/analyze_listening_study.py:193` onward.

Role means have clustered intervals, but the improvement report contains only an observed point difference. It selects the best practical role after seeing the scores and reports no paired interval. Separate role confidence intervals do not establish the confidence interval of their paired difference.

Required: predeclare the practical candidate-versus-baseline comparisons; bootstrap paired differences over the same listener/excerpt cells, retaining both clustering dimensions. Report coverage and the lower confidence bound for each planned comparison. Label post-hoc winner selection exploratory. Suppress qualification conclusions with inadequate independent listeners/excerpts. This is necessary to evaluate the plan's improvement gates.

### 7. P2 — Browser-facing candidate identities are disclosed

Location: `scripts/build_listening_study.py:222` onward and the browser study manifest.

The public manifest contains `role` values and filenames such as `hidden_reference.wav` and `model_only.wav`; audio elements use those paths directly. The source comment that inspection cannot reveal the hidden reference is incorrect.

Required before real blinded collection: produce an opaque browser manifest and neutral asset names, keeping the role/rotation decoding key with the analyst. Alternatively explicitly describe the current tool as unblinded development software. The standalone `tools/listening-instrument/` directory is appropriate for an internal research tool; moving it into the product is not needed to solve this issue.

### 8. Correct W4/W5/W6 completion and dependency claims

- **W4:** acquiring an engine and samples is necessary but insufficient. `probe_sampler.run()` and `SfizzRenderer.render()` unconditionally raise; an executable runner, measurement logic and renderer adapter still need implementation. The legacy required-feature list also includes blanket round-robin/half-pedal requirements: replace these with mapping-specific mandatory and optional capabilities as the continuation plan requires. These are engineering tasks, not proof of an external impossibility.
- **W5:** the manifest indexes 88 primary MIDI performances but currently only **one audio file**, with no general per-performance audio association and no independent timing alignment. Report metadata ingestion complete, paired-data readiness partial. Acquire a small development subset first; hash explicit audio/MIDI pairs and independently validate their scored windows. Do not consume the proposed holdout during tuning. The 52-performance ceiling assumes future audio acquisition and enough qualifying edits. Report last note release, last controller and recording end separately; the +2.326 s difference currently uses the last MIDI event and is not itself evidence of note timing misalignment.
- **W6:** the existing research environment already runs Kong and has earlier VeloEst results. Replace “no runtime” with the actual remaining tasks: reproducible dependency isolation, approved-distribution identity, a maintained adapter, common-input event benchmarking and resource measurements. Rendering/audio-objective comparison can wait for W4; event/velocity benchmarking need not. Existing exploratory results do not substitute for a frozen holdout benchmark.

## Recommended next sequence

1. Fix the identity, qualification, split and listening-data guards above; add meaningful regression cases based on the independent reproducers.
2. Continue W4 renderer acquisition/implementation and W6 model adapters/event benchmarks in parallel. Preserve the foundations; reuse maintained sampler/model repositories behind these interfaces rather than replacing the whole architecture.
3. Prepare and independently align a small explicitly paired development subset. Freeze a feasible untouched qualification split only after checking available audio and useful-edit coverage.
4. Run real renderer probes and build honest source/model/refinement listening material. Then run the human pilot. No invented score is acceptance evidence.
5. Implement/refine W7–W10 only against those measured results, preserving rollback and conservative acceptance rules.

The appropriate status is **foundations delivered, review corrections outstanding, fidelity path unfinished**. Test success establishes software behavior for tested cases; it does not establish better notes, sound matching or an indistinguishability claim.

## Review evidence

- `.local/repo-research/latest-foundation-verification.log`
- `.local/repo-research/collection-diagnostic.log`
- `.local/repo-research/full-foundation-verification-unrestricted.log`
- `.local/repo-research/latest-handoff-probes.json` and its independent producer `verify_latest_handoff.py`
- `.local/repo-research/verify_listening_resume.cjs`
- `.local/repo-research/kong-runtime-verification.json` and `.log`
