# Regular piano app: live comparison review

## Follow-up verification — fixes confirmed

The findings below describe the earlier implementation. After the developer's update,
an independent follow-up confirms the five reported fixes: native ending mappings,
Basic Pitch amplitude-to-render mapping, pre-saturation headroom, retained-source
registration, and the reported documentation/status/table updates are present.

All **58 focused render/job/scorer/API tests passed**. This was not a rerun of the full
915-test suite. Both live comparisons' regenerated default previews were checked on
disk: file hashes match their manifests, every model note has its native offset mapped,
all assumed-release counts are zero, Basic Pitch amplitude mappings cover every note,
and all six previews are clipping-free (peaks approximately -18.8 to -14.7 dBFS).

The regular local API/frontend/dependencies were stopped when checked, then started
with the updated code and existing `form_ui_test` database. Browser checks confirm
playback/model switching and the results table still work. Additional live checks
confirm the predicted-offset disclosure is visible for all three playable variants,
the clipping warning is absent for their clipping-free previews, and "Use this lesson's
retained source" is visible when entering from the lesson review page.

Receipts: `.local/live-piano-review-fixes-tests.log`,
`.local/live-piano-comparison-browser-fixed.log`, and
`.local/live-piano-comparison-fixed-verification.json`.

The original clip/public URLs below remain usable. These fixes improve faithful
presentation of native model results; they do not change the transcribed notes or
establish a universally best model. Transkun and Onsets and Frames still have no
executable adapters in the inspected implementation, in addition to their licence
blocks. Production leasing/cancellation and the absent video/keyboard views remain
separate limitations.

## Outcome

The comparison page is connected to the frontend and backend. It can now be opened in
the regular local test app, under the existing owner account, rather than only the
developer's temporary SQLite acceptance setup. It is suitable for preliminary note
inspection, but its current "as transcribed" previews are not yet a faithful duration/
dynamics comparison.

## Deployment gaps fixed for local testing

- No migration existed for the three comparison tables, although the readiness check
  queried them. Added `0024_piano_model_comparisons.py`, tested schema/index/foreign-key
  correspondence and reversibility, and applied it to the existing `form_ui_test` DB.
- The regular frontend/backend and Docker dependencies were stopped. Started them with
  the existing test DB/account; no account seeding or password reset.
- The regular owner account had no registered comparison sources. Registered the exact
  current clip and the public paired recording without modifying their source bytes or
  any lesson.
- The default dot-directory output location failed with Windows access-denied errors
  for both Basic Pitch subprocesses. The local test launcher now uses
  `model-pilot-output/live-comparisons`; first failed attempts remain recorded separately.

## Verified in the normal app

The actual owner login succeeds. A newly created clip comparison runs both Basic Pitch
variants and Kong through the API; all three produce ready previews, while Transkun and
Onsets and Frames remain blocked. No downstream correction is enabled.

Headless browser acceptance on that normal app confirmed: Original/Kong/both Basic Pitch
assets load, native audio playback advances, switching preserves the 5-second position,
both blocked model buttons are disabled, the 13-row result table is present, and no
browser page errors occur. Screenshot and receipt are under
`.local/live-piano-comparison-browser/`. The migration/API subset passes 13 tests.

Live comparison links:

- Owner clip: `http://127.0.0.1:5173/?page=music-comparison&id=7b40e5aaea794b01b04492e98f8c5f79`.
- Public recording: `http://127.0.0.1:5173/?page=music-comparison&id=b3e6a6955f6f477fa705bfb1c4c30058`.

Both parents have three ready model previews and two blocked rows, hence status
`partial`. The original 36-note lesson was checked again and remains unchanged, with
no working document or automatic correction history.

## Remaining issues to send the developer

### P1 — Native note endings do not reach playback or the note roll

`piano_model_adapters.canonicalise()` preserves offsets only in `native.json` and leaves
canonical `key_release_seconds`, `audible_end` and `legacy` empty. This correctly avoids
pretending a predicted offset is a physical release, but `render_piano_comparison`
passes only that canonical document to the renderer. Consequently every note uses an
assumed release. The current clip's manifests confirm assumed release counts of
**36 / 51 / 38**, covering every note from each model. The React roll independently
uses a fallback **0.5 s** duration for those same null release fields.

Add an explicit native-offset-to-preview bridge and use it consistently for render and
display. Preserve the declared offset convention; never relabel it measured physical
release. Bind the sidecar hash and mapping to the preview identity. Test two outputs
with identical starts but different native lengths: their default previews and roll
must differ accordingly. "Notes and timing only" may deliberately use fixed lengths;
"As transcribed" must not silently do so.

### P1 — Basic Pitch amplitude is preserved but ignored by the default preview

The adapter saves amplitude in `velocity_provenance.amplitude`, while canonical
`render_intensity` and `legacy.velocity_amplitude` remain null. The renderer reads the
latter fields, not the provenance value, so Basic Pitch falls back to a fixed intensity.
Kong does use its estimated MIDI velocities. This is an unfair, undisclosed difference
for a dynamics listening comparison.

For the derived preview, explicitly map Basic Pitch amplitude to an uncalibrated render
intensity, keeping `velocity_midi=null`. Include this mapping in identity and warnings.
Test a Basic Pitch output with soft and strong amplitudes; the default preview must
retain their contrast, while the intentional notes-only mode stays fixed-intensity.

### P1 — All current clip previews are clipped

The live manifests independently confirm `clipping=true` for all three models.
The underlying additive renderer clips floating synthesis internally, before the
comparison wrapper writes WAVs. Lowering browser volume or attenuating already clipped
samples cannot restore lost peaks.

Apply one declared common headroom policy before internal saturation, bound it to the
render request identity, test dense chords and all complete pilot previews, and
regenerate preview-dependent audio scores. Do not normalize each model independently
or modify native model velocities to solve rendering clipping. The UI currently only
warns that synthesis is approximate; it does not display the actual clipping flag.
Expose clipping/control omissions before allowing listening judgments.

### P2 — New uploads are not automatically available for comparison

The comparison page selects server-registered WAVs. The two pilot files are now
registered, but clicking "Compare AI models" does not extract/register an arbitrary
new lesson source. Add an owner-checked backend action to freeze and register the linked
lesson's retained source without accepting a filesystem path from the browser. This is
needed before calling the feature a general upload-to-model-comparison workflow.

### P2 — Documentation and completion status need correction

The pilot document's final "Remaining" section says Package 6 is not implemented,
contradicting its preceding HTTP/browser section and the actual code. Replace that
stale statement with the real remaining limitations. Also make parent status distinguish
fully successful runs from partial children: `_parent_status` currently treats all
`ready`/`partial` children as `complete` if every requested row has one of those states.
The initial five-row pilot remains partial because two variants are blocked, which
currently masks that general status issue.

The frontend's `formatCell` also omits useful values already present in result data:
the note-correctness cell shows F1/precision/recall but not matched/missing/extra counts,
and timing omits bias and within-tolerance coverage. Add accessible details or additional
visible metrics with plain-language explanations, so the user can inspect the promised
attribute evidence without downloading JSON. Do not claim the presence of 13 rows means
every metric is exposed or every attribute is measurable.

## Limits of this review

This confirms local test access and the specific integration gaps above, not a full
security/production audit or a rerun of all 907 tests. The development executor still
uses an in-process lock and does not interrupt an active inference on cancellation.
The comparison page currently has source audio and a note roll, without the planned
source-video panel or piano keyboard. Those limitations remain; no existing lesson's
notes, correction policy or published revision were changed.
