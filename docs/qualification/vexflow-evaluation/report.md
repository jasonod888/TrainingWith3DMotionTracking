# VexFlow feasibility test on the real piano recording

Tested: 14 November 2026. VexFlow **5.0.0**, Chrome **157.0.8103.78**, desktop browser, SVG backend. This is an isolated feasibility experiment, not a change to Phase 6 or an acceptance review of the developer's current work.

## Finding

**VexFlow is a credible replacement for the sheet-rendering layer.** It rendered the real dataset, supported individual engraved-note geometry with a thin selection adapter, and worked as a horizontally virtualised grand staff. It does not supply the complete editor or replace our command, occurrence, alignment, playback and persistence layers.

Keep the current plan: finish and review Phase 6, then pause further work in the custom-rendering direction while comparing it with this prototype. No message was sent to the developer and their implementation files were not changed.

## Input and isolation

- Existing local Phase 1 audit snapshot of lesson `0df28929…`: **209.594 seconds, 1,338 performance occurrences**. This is actual extracted note data, not a synthetic song.
- Built its written interpretation with the repository's current notation builder: **127 measures, 1,146 events, 2,335 segments**, with all **1,338 occurrence ids mapped**.
- Rendered **2,078 sounding noteheads**. This exceeds the performance-note count because tied notes have multiple written segments.
- Used the existing interpretation; did not retranscribe audio, correct musical mistakes, alter recorded attacks, access a live account, save a lesson or modify the developer's workspace components.
- Loaded pinned VexFlow and Bravura/Academico fonts into a separate local prototype. Browser requests were to a temporary local static server; it was shut down after testing.

## Results

| Check | Final measured result | Interpretation |
| --- | --- | --- |
| Initial visible engraving | **39.9 ms**, 6 measures mounted | Rendering only; excludes library/font/data loading |
| Entire score | **127/127 measures**, 2,078 sounding noteheads, zero recorded rendering errors | Real dataset can be engraved by the library |
| Full-score render | **482.7 ms**, about 24,953 SVG descendant nodes | Avoid rerendering the whole score on each edit/frame |
| Horizontal navigation | 111 sampled positions across the whole strip; update median **4.7 ms**, p95 **8.1 ms**, maximum **10.2 ms** | Virtualised mounting is promising in this desktop run; not a 60 fps guarantee |
| Actual engraved-note centre geometry | **2,078 centres inspected**: 2,047 resolve directly, 31 require an overlapping-note candidate picker, **0 uncovered targets** | Use actual glyph geometry and explicit ambiguity handling |
| Native browser pointer selection | **20/20 sampled engraved-note clicks** selected the intended written segment | Pointer sample includes chord noteheads; this is not 2,078 independent mouse clicks |
| Narrow layout | At **390 px**, document scrollWidth = viewport width; 3 measures mounted | Horizontal scrolling remains inside the score surface; desktop emulation only |

The strip is approximately **53,546 px** wide in this density-based layout. Widths are based on notation density, not a uniform seconds-to-pixels scale. Playback must continue to map musical tick positions through our alignment layer.

## Readability assessment

Inspected the beginning, middle and narrow captures. VexFlow provides conventional clefs, staff lines, noteheads, stems, flags/beams, dots, accidentals, rests and ties. The prototype can retain readable note sizes while scrolling instead of squeezing the whole recording into the available width.

The screenshots also show why a renderer is not the entire solution: the existing score interpretation contains dense voices, rests and ties. Better glyphs do not establish that the transcription or voice assignment is musically correct. The prototype uses a deliberately generous vertical separation between the two staves, repeats clef/time context per measure, and has simple width heuristics. These need product design and musical review before calling the output publication-ready. Final page/system formatting and export are not tested here.

Captures:

- `beginning.png`: opening measures.
- `middle.png`: denser middle passage.
- `mobile.png`: 390 px viewport.

## Selection findings that matter for implementation

1. VexFlow's SVG root defaults to `pointer-events="none"`. Our selection overlay must explicitly enable pointer events.
2. One event/chord bounding box is insufficient. Chord seconds and multi-voice engraving can displace individual noteheads sideways. The first position-based adapter missed targets; the final adapter uses the **actual SVG notehead bounding boxes**.
3. Mapping must be per engraved segment → logical note → performance occurrence list. Multiple attacks can share one written note; ties can create several segments for one logical note. A written selection must not silently choose the first occurrence.
4. Some real glyph targets overlap. The prototype exposes a candidate picker for these cases. Enlarging every hitbox indiscriminately would make the ambiguity worse, especially on touch screens.
5. Changing the score layout changes note x positions. The shared playhead and reveal geometry need to use the rendered positions, not assume that horizontal pixels equal recorded seconds.

The synthetic handler-dispatch count retained in the raw test output is only a smoke check. The relevant geometry evidence is the actual glyph-centre scan and the separate native pointer sample above.

## Recommended integration boundary

Retain the existing document, occurrence ids, safe correction commands, selection/history, exact performance timing, video clock, alignment and Phase 5 persistence/recovery. Add a VexFlow adapter that reads written segments and produces SVG plus per-note geometry. Translate user gestures back into the existing commands; VexFlow must not become a second authoritative note store.

Virtualise by measure with a buffer, retain stable ids, and cache unchanged measure output. Rebuild changed measures after a completed edit; repaint cursors/highlights separately from engraving. This test did not implement those production optimisations or gesture transactions.

This is a stronger targeted reuse candidate than replacing the complete workspace without an integration trial. It does **not** establish that Signal or Smoosic should be adopted, since neither was benchmarked here.

## Limits

- Local audit snapshot rather than a fresh server fetch; the recording itself was not played during this engraving test.
- Desktop Chrome only; 390 px is viewport emulation, not physical-phone qualification.
- No 60 Hz video/playhead benchmark, drag/edit/cancel test, save/reopen test, accessibility audit or Phase 6 regression run.
- No direct benchmark against the developer's changing Phase 6 code, so this is not proof that VexFlow is faster or more usable than that implementation.
- Overlap-picker geometry is demonstrated, but touch-sized targets and the final interaction design remain work.
- Production integration must preserve tie/voice/accidental semantics and include appropriate dependency/font notices. VexFlow itself is MIT licensed.

## Reproduction

The isolated prototype and inputs are at `.local/vexflow-evaluation/`:

```powershell
node --import ./apps/web/node_modules/tsx/dist/loader.mjs .local/vexflow-evaluation/prepare.ts
python .local/vexflow-evaluation/test.py
```

The test starts and closes its own temporary localhost server and isolated headless Chrome instance. It writes this folder's `results.json` and screenshots. Prototype rendering/input code is in `.local/vexflow-evaluation/index.html`; the input snapshot is the existing `.local/phase1-audit/draft-document.json`. Do not substitute a new transcription without recording that the benchmark input changed.

Official project: https://github.com/vexflow/vexflow (v5), https://github.com/0xfe/vexflow (v4-era repository).
