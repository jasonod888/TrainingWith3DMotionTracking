# Piano correction workspace — Phase 1 review

Reviewed: 13 November 2026.
Submission: `4583e74b7c2b069300fe8dc987785b70ee15ba66`.
Audited implementation: `ef4dfb6`.
Decision: **CHANGES REQUIRED — Phase 2 is not authorised yet.**

The audit is useful and substantially meets the investigation objectives. This decision requests a small documentation/evidence follow-up, not a restart of the audit and not product implementation.

## Confirmed decisions for the developer

1. **D1–D12 are an appropriate target set.** Preserve the distinctions between reproduced findings, static analysis and hypothetical/multi-mapping fixtures. D1–D7/D11 are data-integrity concerns; D10 is a performance/derived-identity concern, and D12 is a cross-workflow offset concern. Schedule fixes according to the phase boundaries, rather than attempting every UI issue in Phase 2.
2. **Changing the duration-overwrite behaviour is approved.** Ordinary written-duration edits must not delete/truncate other performance occurrences or rewrite recorded length. Split into an available voice or reject without mutation. Update the existing test that currently endorses destructive overwrite. A destructive replacement feature is not required for this correction workflow; defer it rather than add competing semantics in Phase 2.
3. **Fixtures for C4 and explanation passages are approved.** Use real A5 repetitions for real-data occurrence checks, plus explicit repeated-C4 fixtures. Add overlapping same-pitch occurrences, rubato and explanation-gap fixtures because this real clip does not establish those cases. C4 in the original specification was an illustrative pitch, not an assertion about the recording.

## Review performed

- Verified the submission commit is a direct child of the baseline and changes only audit documentation, scripts, measurements and captures; no product implementation changes.
- Read the full handoff, submitted scripts and local raw logs; inspected the implementation of overlap deletion, tie/untie, accidental respelling and performance validation.
- Independently reran `tests/music-engine/notation.test.ts` and `apps/web/tests/notation-editor.test.tsx`: **13 passed, 0 failed**. This includes confirmation that an existing passing test explicitly expects neighbour deletion and recorded-duration rewriting.
- Attempted the committed `audit-destructive.ts` using the application's installed tsx loader. It fails before loading data with **Cannot find module '../../packages/music-notation/index.ts'**.
- Inspected the local API-suite log: it records **836 passed, 2 skipped, 1 failed**, with the reported missing `soundfile` import. This review did not independently rerun the entire API suite or authenticate to the real lesson. The full web/API numbers remain developer-reported evidence, not fresh reviewer test results.
- Confirmed that raw `.log` evidence exists locally but is **absent from the submitted commit**, due to ignore rules.

## Required corrections before GO

### R1 — Make the submitted evidence reproducible from its committed location

The audit scripts appear to have been moved from a scratch folder without updating their paths:

- `scripts/audit-destructive.ts` and `scripts/emit-notation.ts` import `../../packages/...`, which does not reach the repository root from the committed scripts directory.
- They read `draft-document.json` beside the script, whereas the reproduction instructions place it in `.local/phase1-audit/`.
- `scripts/validate-notation.py` inserts `parents[2]` as the import root, which is the qualification directory, and also expects its inputs beside itself.
- `scripts/capture-forms.py` uses a `captures` directory beside itself without creating it. Its actual output differs from the handoff's evidence directory.
- Several commands/comments refer to old scratch paths. Normalise these paths across all scripts and the instructions.

Use an explicit repository-root resolution and a documented `--input`/`--output-dir` or equivalent configuration. Keep generated inputs/outputs in scratch; no requirement to commit the private raw recording or full draft. Include a fixture-only reproduction path where live local services are not available.

Commit shareable raw evidence as `.txt` or another tracked format, or explicitly add the reviewed log files if appropriate. Update the handoff to distinguish evidence included in Git from evidence available only locally. Include a tracked web-test summary/log as well as the API/destructive evidence.

Re-run the corrected documented commands from the repository root without relocating scripts or manually repairing imports. Missing service/data dependencies should produce a clear prerequisite error, not an unexplained path failure. Record actual command results and the new submission identity.

### R2 — Resolve contradictory scope and identity contracts

In section 9.1, “total and injective-on-notes” conflicts with the explicitly permitted `performance_ids: string[]` mapping. The intended invariant is:

- Every performance occurrence belongs to exactly one logical note.
- Every sounding logical note owns one or more occurrence IDs.
- Multiple occurrences may map to the same logical note when explicitly represented; this is many-to-one, not injective.
- Forward/reverse mappings agree, and no occurrence is missing or multiply owned. Rests have no sounding-note mapping.

Rewrite the rule and include a minimal valid multi-occurrence example and invalid duplicate-ownership example.

Remove Phase 2's proposed destructive `overlap: 'replace'` branch and fixture expectation, or mark it deferred and unavailable. It conflicts with the same section's explicit prohibition on collateral occurrence deletion. The normal correction commands should split or reject safely.

Clarify tie/untie semantics: notation-only tie operations preserve all recorded attacks and lengths. If tying two attacks would falsely imply one sustained sound, reject it or provide a separately scoped later performance-merge action; do not reintroduce D4 through a renamed command. Undo is not a substitute for a non-destructive default.

### R3 — Specify accidental and nullable-field behaviour correctly

`ApplyAccidental` currently says “spelling must exist for that pitch”, which is the limitation of the old respelling command, not the agreed accidental action.

- Applying sharp/flat/natural to a selected letter/octave derives the resulting sounding pitch and updates linked performance through explicit target scope.
- Enharmonic `Respell` preserves sounding pitch and performance/audio identity.
- State how multi-occurrence scope is handled: the normal selected-occurrence workflow must split or reject rather than change repetitions implicitly.
- Keep `velocity: null` and `duration: null` compatibility explicit. Unknown recorded length is not a zero-duration note and must not be silently converted to a written value on load. Define default visual duration separately from persisted truth; define the clear/unknown velocity action or explicitly state it is unavailable while legacy nulls remain preserved.

Include examples: C4 + sharp becomes MIDI 61; C-sharp4 respelled D-flat4 stays MIDI 61; applying natural to C-sharp4 becomes C4/MIDI 60 under the chosen letter-based action.

### R4 — Make alignment a continuous map with explicit gap semantics

The reported 26/52 ms residual measures the difference between performance data and score ticks generated by quantising that same data. It is not independent ground-truth musical alignment or a measured playback-drift result. A 103 ms quantisation grid does not by itself make `tick = seconds / secondsPerTick` a step function; that conversion is continuous. A nearest-event lookup could be stepped, but must be identified separately.

Correct the evidence labels and define which quantity Phase 4 will measure: continuous cursor interpolation, actual occurrence highlighting, and alignment against an explicit annotated/anchor fixture. Do not define success as merely beating a circular quantisation residual.

The proposed strictly increasing global anchor pairs plus boundary holding cannot represent an **internal** explanation gap/plateau. Specify separate timed playing segments/gap policy, or an equally precise representation. During a held interval the inverse is not unique: choose and document the next/previous valid boundary policy; do not claim global mutual inverses. State the estimated/no-anchor mapping and one-anchor behaviour explicitly.

Specify whether `source_seconds` anchors refer to effective video time or pre-offset performance time, and what a later global offset change does to alignment. Apply the offset once; do not silently double-shift the score.

This phase needs a corrected contract and examples only. UI and mapping implementation remain in the planned later phase.

### R5 — Correct the legacy-client persistence proposal

“Carry existing notation forward when an older client omits it” is unsafe if that client changes performance events: retained notation may contradict the new events.

Document this policy instead:

- Omitted notation may be retained only when the retained document still validates against the submitted performance and applicable alignment identity.
- If incompatible, reject with an explicit supported-client/reconciliation error, or use an expressly specified migration policy that reports what is lost. Never preserve stale notation silently or regenerate away authored work without disclosure.
- A v2 client document cannot be posted to the existing v1-only validator before compatible persistence exists. Phase 2 stays isolated; version migration must not break the normal reviewed editor or current save route.

No API implementation is requested in this Phase 1 follow-up.

## Non-blocking corrections to evidence wording

- The duration reproduction adds **960 ticks** (600 to 1,560), i.e. two quarter-note beats at ppq 480, not “one quarter”. The destructive finding remains valid.
- The “80 snapshots ≈120 MB” figure is an estimate from JSON sizes, not a measured JavaScript heap allocation. Label it a serialised-size estimate; actual retained heap may differ.
- Eight script sections are not eight destructive paths reproduced on the real recording: the same-onset duplicate check is synthetic, the overlap-neighbour check may skip, and chord-member deletion is a safe control. Provide a D1–D12 matrix stating real-data reproduction / fixture reproduction / static analysis / safe control / skipped, with the exact receipt for each claim.
- The handoff's claim that API changes become live without restart needs verification of the running server's reload configuration. Importing code from this tree alone does not establish hot reload.
- Audit authentication/capture scripts hard-code local test-account credentials. Move these to supplied environment values or a documented disposable fixture configuration; accurately describe that the scripts authenticate and generate local evidence, while not mutating musical/product data.

## Follow-up submission requested

Submit a documentation/evidence-only correction commit on the Phase 1 branch containing:

1. Corrected scripts and tracked/referenced evidence.
2. Revised sections 9–10 resolving R2–R5.
3. The reproduction classification matrix and corrected evidence wording.
4. Results from the repaired reproduction commands and exact commit SHA.

Do not begin Phase 2. The baseline does not need to be recreated. Once these contract/evidence issues are resolved, Phase 1 can receive GO without repeating the full seven-minute API suite unless new relevant changes justify it.
