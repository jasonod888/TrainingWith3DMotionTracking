# Follow-up review and fixes — 12 November 2026

## Outcome

The developer's first seven corrections were present and their original **207 focused tests passed independently**. Deeper review found remaining approval, measurement, blinding and compatibility issues. These have been corrected with regressions. Keep the foundations and proceed with the outstanding renderer/model work; this is not evidence that reconstruction is finished.

No production transcription thresholds, correction policy, model or model weights were changed. The existing uncommitted work was preserved. No commit or push was made.

## Changes made

### Qualification and playback intensity

- Unsupported velocity, key-release and pedal controls now block both the affected target and audio-fidelity qualification. An unrelated, independently supported target remains separate.
- Empty comparisons cannot qualify. No note evidence cannot qualify note-expression targets. An absent pedal trajectory is unknown, rather than a measured pedal-off performance.
- Skipping the second render reports `stable: null` and cannot approve audio fidelity on assumed determinism.
- The approximate renderer previously discarded legacy note amplitudes and used a constant intensity. Version **2.1.0** preserves those relative amplitudes as explicitly **uncalibrated render intensities**. It does not promote them to measured MIDI velocities. The resolved intensity changes the render identity, and a warning discloses the estimate.
- A tautological regression assertion (`... or True`) was replaced with a real exclusion assertion.

### Sampler evidence

- Mandatory measurements left absent or unknown no longer yield `passed`. Successful selection also needs engine identity. Core piano behavior—pitch, repeated strikes, dense chords, note-off and sustain/lift—is required even when an SFZ delegates that behavior to the engine without explicit opcodes.
- Pitch probing now checks the expected C4 frequency and attack timing. The chord probe checks spectral coverage of the twelve requested pitch bands. A wrong-pitch tone and a single-tone chord no longer pass merely for being audible. These remain conservative diagnostic checks, not perceptually calibrated proof of voice separation.
- Velocity measurements use windows following the actual MIDI strikes at 0, 0.5 and 1.0 seconds. The old equal-third windows did not correspond to those events.
- Sustain uses equal absolute-time windows across renders. Pedal lift is compared with the sustained control, so ordinary natural decay cannot itself prove damping at lift.
- A new held-key probe separates note-off response from release-triggered sample support. There are now **eight distinct probe MIDI files**.
- Ordinary audible decay/reverb no longer proves a release-sample layer. That feature remains **untested** until a controlled release-layer ablation is measured. Missing proof keeps the relevant selection pending.
- Sample lookup respects SFZ `default_path`. Present samples are hashed as well as mapping includes. Probe receipts bind the mapping, samples, canonical MIDI probe set and available engine fingerprint. Changed samples or MIDI invalidate evidence; changing assets during a render is rejected. Old WAVs are removed before each invocation so an engine that produces no file cannot accidentally reuse stale evidence.
- Engine commands support argv lists. Legacy strings are split before substituting paths, preserving Windows paths containing spaces; no shell is invoked. Engine calls have a timeout and translate launch/timeout failures to sampler errors.
- `SfizzRenderer` handles the selection artifact's feature-list format, checks passed state and current identities, and does not treat release samples as proof of key-release control. Its availability report explicitly says the performance-rendering adapter is still unimplemented; existing files alone cannot make it available.

### Dataset split protection

- Assignment performer/work labels must agree with the canonical performance behind the file path. The inspected-material exclusion uses that canonical identity, not editable assignment labels.
- Only development, calibration and holdout labels are accepted. Bijection and performer-disjointness checks from the developer remain in place.
- Real ingestion still reports 88 primary MIDI performances, 24 exclusions and 43,656 notes, with one audio recording and unverified alignment. No split was frozen or holdout audio used for tuning.

### Listening study

- Predeclared comparisons now survive study construction and enter the immutable analyst manifest. Previously the builder dropped them, leaving the analyzer to classify all comparisons as exploratory.
- Verification checks the entire browser projection—candidate mapping, rotations, instructions and identifiers—rather than just trusting its declared analyst hash. Missing or altered manifests, stimuli and published instrument scripts invalidate the build.
- Each build produces a self-contained **public/** bundle with HTML, scripts including `protocol.js`, stylesheet, anonymous manifest and stimuli. The analyst manifest, role mapping and consent records stay outside the HTTP document root. The generated instructions now serve only this folder and include the correct analyzer arguments.
- Opaque labels and rotation generation use a private per-study blinding key, rather than predictable public/default seed values. The private key stays in the analyst record so the build can be reproduced. Explicitly supplying the same private key supports deterministic research builds; it must not be published to participants.
- Study IDs are unique and filename-safe; duplicate candidate roles, invalid rotation counts and invalid planned comparisons are rejected.
- Invalid/mixed-time-zone timestamps are excluded without crashing the analyzer. Fractional/bool label indexes can no longer be coerced into another candidate's integer index.
- Progress uses the full study digest and verifies that each rating's embedded item/index agrees with its storage key. Starting a new session resets prior in-memory progress. Protocol version is **0.3.0**; historical studies are not silently rewritten or migrated.

## Verification and real clip

- Pre-change focused verification: **207 passed**.
- Intermediate complete focused verification: **228 passed** after the main fixes, including the intensity regression.
- Final additional guard verification: **74 passed**, including omitted-repeat-render and absent-pedal cases. These overlap the focused set and must not be added as independent test counts.
- Final full-suite result: **707 tests collected; 693 passed, 14 skipped, zero failures**, in **427.55 seconds (7 min 7 s)**. Two dependency deprecation warnings remain. This is **23 additional regression cases** over the developer's 684-test snapshot. Full API execution used the documented music dependency path and local networking. Earlier interrupted full runs are not counted as completed verification.
- Local HTTP smoke check against the real clip's published study: `/`, `/protocol.js` and `/study.browser.json` return 200; `/study.json` and `/../study.json` return 404. This verifies packaging/access, not a human browser acceptance or listening study.
- The original **14.6773696 s** analysis audio was checked with its cached **34-note** proposal, using the approximate renderer. Source identity verified; two renders were byte-stable; delivered audio was independently scored. The normalized diagnostic objective was **0.596754**. This number is not a similarity percentage or an improvement result: no competing faithful renderer or corrected-note candidate was compared.
- That real-clip report correctly has `diagnostic_only: true`, `valid_for_qualification: false` and **no qualified targets**. The generated four-stimulus study verifies successfully. No listener ratings were collected or invented.

Reproduction receipts are in `.local/repo-research/`: `round2-final-focused.log`, `round2-final-guard-tests.log`, `round2-full-final.log`, `round2-vienna/`, `round2-sampler/`, `round2-real-clip/summary.json` and `round2-http-smoke.json`. The new adversarial integration cases are in `tests/api/test_piano_foundation_regressions.py`; existing package tests also gained regressions.

## Work that still requires implementation/evidence

W4 needs the actual engine/sample distribution, the performance-to-engine adapter, real rendered measurements and controlled release-layer evidence. W5 still needs more explicit audio/MIDI pairs and independently verified alignment. W6 can use the existing research Kong/VeloEst runtimes but still needs reproducible adapters and common-input benchmarking. W7–W10, real listener data and untouched qualification remain outstanding.

These are substantial remaining deliverables. The corrections above strengthen the foundation and prevent false approvals; they do not establish improved notes, calibrated dynamics, faithful piano timbre or indistinguishability.
