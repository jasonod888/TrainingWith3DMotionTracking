# Piano correction workspace — Phase 5 review

Reviewed: 14 November 2026.
Submission: `069bf3aef034f9d804f70ae63458d0ba91d4603c`.
Decision: **CHANGES REQUIRED — Phase 6 is not authorised.**

The repeated-attack builder fix preserves all occurrence ids instead of dropping quieter attacks. The new persistence work is substantial, but its client and server tests exercise different contracts. The workspace cannot complete the submitted first-save path against the real API, and several save/recovery states can lose or misrepresent authored work.

## Independent evidence

- Targeted API suites (`test_music_review`, `test_music_edit`, `test_music_alignment`): **12 passed**, exit 0.
- TypeScript `tsc --noEmit`: **passed**.
- New service-free cross-language reviewer reproducer: **0/7 passed**. It builds the real client save body, invokes the actual Python validators, and renders the actual harness for an offset-only change.
- Inspected the payload/restore/recovery modules, harness lifecycle and save handlers, server endpoint diffs, notation/alignment validators, component mocks and round-trip evidence generator.
- Full web-suite result is **not independently confirmed**. Automatic approval review rejected the run after an external Visual Studio telemetry request with an unverified payload. No bypass was attempted. The developer's 447-pass result remains developer-reported.
- No product code or service data changed. Only the reviewer diagnostic and review document were added.

## R1 — Workspace save payload does not satisfy the real API (blocking)

`buildSaveBody` and its caller never supply `draft_id` or `reference_sha256`, both required by `ReviewMusic`. The actual model rejects the generated body with those two missing fields. Working/verified drafts also require their current `verification_state_token`; the harness does not load or send it.

Separately, `serializeAlignment` discards `alignment.passages`. `validate_alignment` requires passages, so even after adding the missing draft fields the save fails with **"The alignment has no passages."** The same defect affects revision saves and recovery fidelity.

The component mock returns a revision for arbitrary POST JSON. The API tests construct a different, valid body by hand. `make-roundtrip-evidence.ts` constructs a hypothetical reference directly from the client body without ever asking the server to accept it. These tests therefore cannot establish a functioning client-to-server round trip.

Required: align the complete first-review and later-revision payloads with the actual API, including identities and verification state. Serialize the complete versioned map. Feed an actual generated workspace payload through the real endpoint and restore the actual stored reference. Cover initial save, subsequent save, reload and idempotent retry; include a working/verification-decision draft. Do not weaken identity checks or manufacture a reference to simulate acceptance.

## R2 — Dirty state, confirmation and recovery omit persisted changes (high)

`dirty` and confirmation reset depend only on `JSON.stringify(document)`. Anchors, alignment, offset, spans and title are absent. Actual harness probe: change offset to +0.5 s, tick Reviewed, and **Save remains disabled**. Such an edit also skips local recovery when the document itself is clean. Alignment changes after confirmation do not invalidate that confirmation.

`restoreCheckpoint` creates a fresh clean `WorkspaceState`, but does not establish its relationship to the server baseline. On an initial load, `savedSignature` is null, so restored local work is clean and cannot be saved until another note edit. That contradicts the recovery banner's promise to recover unsaved work. An unchanged initial draft likewise cannot be finalised merely by confirming review.

Required: define a saved-state signature for the complete persisted workspace and track server baseline separately from local restoration. Include every persisted edit in dirty state, confirmation reset and recovery. A recovered unsaved checkpoint must be saveable; a never-finalised draft must be finalisable without a gratuitous musical change. Test offset-only, anchor-only, recovery-only, undo/redo and confirmation-reset cases.

## R3 — Persisted integrity validation is incomplete (high)

Independent Python probes show that the server accepts:

- Ordered anchor times with **reversing ticks** (1 s → 1500, 2 s → 500).
- A written note changed to MIDI 127/G9 while its linked performance occurrence retains its original pitch.
- A document whose written notes all have empty `performance_ids`, leaving **every occurrence unowned**.

`validate_alignment` validates anchor times but neither monotonic ticks nor agreement of the authored points with the saved passage map. `validate_notation` verifies performance-array equality and that listed links exist, but does not enforce exactly-once ownership or linked written/performed pitch agreement. The latter validator predates this phase; reusing it alone does not meet Phase 5's new persisted integrity gate.

`restoreFromReference` also accepts contradictory reference events and notation performance; it checks only document duration against the reference and silently normalises/filters some invalid alignment fields. The reviewer probe changes the reference's first pitch while retaining notation and receives `ok: true`.

Required: enforce the agreed occurrence ownership and pitch/mapping invariants at the server boundary and restore boundary. Validate complete maps and anchors together, including monotonicity, ranges and point/map agreement. Preserve the distinction between written and recorded durations—do not require them to equal. Reject corrupted/unsupported saved data with a clear message rather than silently filtering authored content.

## R4 — Legacy revision saves silently drop authored notation/alignment (high)

In `music_edit.py`, omitted `notation` becomes `None`; omitted alignment is retained only in the special offset-only branch. The new reference includes those fields only when the local variables are non-null. Consequently an older client saving a reference that already contains notation/alignment silently removes them, even for an unchanged performance.

This violates the previously agreed validation-gated legacy retention contract. The legacy API test covers saving an originally legacy document, not an old client editing a rich reference.

Required: retain existing authored data when it remains valid against the submitted performance. Reject inconsistent retained notation with the agreed out-of-date/update-or-explicit-regeneration response. Do not silently discard it or infer deletion from omission. Add old-client tests against a previously saved rich reference, for both compatible and incompatible edits.

## R5 — Reopen and audio validity use inconsistent baselines (high)

The initial harness load always builds notation from `/music-draft`; it does not choose the stored reviewed reference/base revision when reopening a previously saved lesson. The manual Reopen action restores notation, but discards saved passage content and recomputes alignment from spans/tempo plus anchors.

That action also calls `setBaseline(restored.document)` without updating the draft's preview asset/identity from the returned manifest. `previewStale` compares the current document to this baseline. After reopening a changed performance it can therefore label the old draft preview current and enable Piano. The relevant baseline must be the performance identity the audio was generated from, not merely the most recently opened score.

Required: initialise saved lessons from the stored reference with the correct base revision; preserve the complete stored map. Restore preview metadata from the same revision and compare audio against its bound performance identity. Test save pitch/time edit → reopen/reload → stale Piano remains disabled, and spelling-only round trips preserve valid audio. Reset/revalidate anchor history when switching references; old-reference undo entries must not leak into the new map.

## R6 — Conflict, retry and in-flight save handling need complete state protection (high)

Every 409 is presented as "newer saved revision" and offered the same rebase action. The API also returns 409 for changed draft identity, verification state, accepted-suggestion conflicts and already-reviewed drafts. Those require distinct resolution; switching blindly to `/music-revision` is not a substitute for resolving verification decisions.

A page reload loses `savedRevisionId`, and recovery stores no base revision. A recovered revision edit can consequently be posted as a first review. If a save completes while further edits are made, its callback unconditionally clears recovery and displays Saved for the older request snapshot. There is no protection for newer local work or a reset/reopen during the request. The 600 ms checkpoint timer also is not a guarantee that a failed save has already retained work.

Required: retain the correct source/base/verification identity through recovery and retry; distinguish conflict causes and keep explicit user resolution. Bind save acknowledgements to the submitted snapshot and keep/rewrite a checkpoint for newer edits. A failure must preserve the current complete workspace with honest storage-failure messaging. Test delayed success/failure with intervening edits, save then reload/recover, verification conflicts and lost-response retry. Clear stale Saved messages when new unsaved work exists.

Also preserve existing sections/assessment when revising: `buildSaveBody` currently hard-codes one Whole lesson section and watch-only assessment, overwriting existing lesson settings as a side effect of note correction. Phase 7 may redesign those controls; Phase 5 must not silently reset saved settings.

## Reproduction and resubmission

From the repository root:

```powershell
node --import ./apps/web/node_modules/tsx/dist/loader.mjs docs/qualification/piano-workspace-phase-05-review-repro.ts
```

Requires the existing web dependencies and `.venv-saas`. No services, authenticated requests, telemetry code or product writes are used by this diagnostic. It exits nonzero for unmet assertions. Its seven checks are examples, not the complete acceptance matrix.

Continue the already authorised Phase 5 corrections, update the handoff and evidence, and resubmit. A contract-backed end-to-end test is needed; an authenticated screenshot alone would not repair these failures. Keep Phase 6 stopped.
