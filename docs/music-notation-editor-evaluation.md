# Sheet-music editor: Smoosic vs RiffScore

11 November 2026. Phase 1 evaluation for the editable piano notation work. The two
candidates were pinned and exercised rather than assessed from feature lists. This
document records what was actually verified, what the candidates cannot do, and the
foundation recommendation.

## Pinned code

| Candidate | Pin | Package version | Evidence |
| --- | --- | --- | --- |
| Smoosic | `486c40442451da12c14a7c0a32fb9ff5f7929ff7` | `smoosic@2.0.3` (`package.json`) | Repository cloned; `release/smoosic.js` inspected and measured |
| RiffScore | `2d1d673c3ebbfb7310f24d810fff212b66628ec9` | `riffscore@1.0.0-alpha.18` | Repository installed and built; full Jest suite and a MusicXML import exercised |

The checkout copies live under the ignored `music-candidate-run/editors/` directory.
They are evaluation scratch space, not application dependencies.

## Capability matrix

Legend: **yes** = verified in source or a run; **partial** = present with a material gap;
**no** = absent or contradicted by the implementation.

| Requirement | Smoosic 2.0.3 | RiffScore alpha.18 | How this was checked |
| --- | --- | --- | --- |
| Grand staff, treble + bass | yes | yes | Smoosic `SmoSystemStaff`/`SmoScore`; RiffScore grand-staff layout and tests |
| Chords | yes | yes | Both models hold multiple pitches in one rhythm event |
| Independent voices on one staff | yes | **no** | Smoosic measures hold `voices[]` and has `selectVoice`/`voiceCopyPaste` tests. RiffScore's release scope says “does not add … multi-voice notation”; its MusicXML importer keeps only the first voice per staff and warns. |
| Editable per-note pitch | yes | yes | RiffScore `selectById()` + `setPitch()` are public API and covered by its API tests |
| Duration controls | yes | yes | RiffScore `setDuration(duration, dotted?)`; documented as implemented |
| Rests and ties | yes | yes | RiffScore `addRest`, `toggleTie`, `setTie`; Smoosic note/measure model |
| Add/delete events and measures | yes | yes | RiffScore `addNote`, `deleteSelected`, `addMeasure`, `deleteMeasure` |
| Undo/redo | yes | yes | Smoosic `UndoBuffer`; RiffScore command history and `undo`/`redo` API |
| MusicXML import and export | yes | yes | RiffScore importer/exporter and round-trip tests; Smoosic `XmlToSmo`/`SmoToXml` |
| React embed without globals | **no** | yes | Smoosic library mode expects global `Smo`, jQuery and jszip plus its own CSS; RiffScore is a React component with `RiffScoreSession` |
| Touch/pointer editing | **no** | partial | Smoosic source only binds `mousedown`/`mousemove` (no `touchstart` or `pointerdown`). RiffScore's UI is also mouse-event based; its alpha.18 QA notes claim touch selection and touch editing in Pixel 7 / iPhone 13 **emulation**, and explicitly say emulation is not physical-device certification. A real touch gesture layer or device test was not verified by us. |
| Drag notes between pitches/times | partial | **no** | RiffScore's “Move Operations: drag-and-drop …” is still “Coming Soon”; its documented dragging is lasso selection. Smoosic has mouse-driven editing but no touch path. |
| Programmatic selection and change events | via editor internals | yes | RiffScore `api.on('selection'`/`'score')` and `selectById`; Smoosic exposes internal tracker/event source but no stable public React-style contract |
| Preserve our performance-to-score mapping | no | no | Neither candidate owns Basic Pitch seconds, video-relative timing or our source-event identity |

## Bundle and integration cost

The application keeps the always-downloaded music shell under **16,384 gzip bytes**
(`docs/multi-discipline-bundle-baseline.json`). Measured production-sized assets:

| Candidate | Main JS | CSS | Font / other | Assessment |
| --- | --- | --- | --- | --- |
| RiffScore alpha.18 | `dist/index.mjs` 1,138,519 bytes / **212,281 gzip** | 51,182 / 7,157 gzip | Bravura 247,200 bytes | Too large for the shell; viable only as an owner-only lazy editor, and still several times the current editor chunk |
| Smoosic 2.0.3 | `release/smoosic.js` 29,699,873 bytes / **7,124,073 gzip** | several bundled CSS files | fonts, jszip, jQuery | Not viable in this product; a 7 MB script plus global UI would need an iframe or a separate application |

RiffScore additionally brings `tone` and `tonal` for playback/theory. The app already
synthesizes audition locally and does not need a second audio transport.

## Hands-on evidence

### RiffScore

- `npm test -- --runInBand`: **215 suites, 3,856 tests passed**, 87 snapshots.
- `npm run build` produced the ESM/CJS/DTS distributions used for the size measurement.
- `importScoreText()` (the public importer from the built package) read this feature's
  MusicXML export. A two-staff passage with one voice per staff imported with **zero
  warnings**. The representative passage with a second voice on the treble staff imported
  successfully but warned: “Staff 1 has more than one voice; only voice 1 was imported
  (the editor holds one voice per staff).” That is the documented, expected loss.
- Its API covers `selectById`, `setPitch`, `setDuration`, `toggleTie`, `deleteSelected`,
  `undo`, `redo`, `export('musicxml')` and `on('selection' | 'score')`. These are real,
  tested methods, not roadmap entries.
- Its alpha.18 scope explicitly excludes multi-voice notation. Its move/drag operations
  are still listed under “Coming Soon.” Do not treat the roadmap as implemented.

### Smoosic

- The release bundle is 29.7 MB raw / 7.1 MB gzip. The library-mode page loads jQuery
  and jszip as globals and calls `Smo.SuiApplication.configure()`.
- The event layer binds `mousedown`/`mousemove` only; no touch or pointer handlers were
  found in `src/`. Mobile editing would therefore require a compatibility layer before
  even reaching the editor's menu-driven controls.
- The score model genuinely supports voices, ties, MusicXML and undo. This is the one
  area where it is stronger than RiffScore.
- No product integration was attempted because the bundle, global UI and mouse-only input
  make the integration cost disproportionate to the prototype.

## Recommendation

**Carry RiffScore forward as the library foundation; do not embed it in this release.**

It is the only candidate that is React-native, has a real programmatic selection/edit
contract, and has vendor QA evidence for touch selection in mobile emulation. It is also
the only one that can plausibly fit an owner-only lazy chunk rather than a separate
application. But alpha.18 cannot represent the required second voice on a staff, cannot
drag a note, and would still add roughly 212 KB gzip of JavaScript plus a 247 KB font to a
single editor visit. Its touch evidence is emulation, not a physical-device matrix.
Adopting it now would force the product to drop a stated requirement.

**Smoosic is not recommended.** Its notation model is richer, but 7.1 MB gzip, a global
jQuery-based application shell, and mouse-only input are incompatible with the phone-first
editor and the bundle discipline in this repository.

The prototype therefore implements a small in-house notation core and editor. It keeps
the score surface behind an adapter boundary so the RiffScore surface can replace it if
(and only if) same-staff voices and event moving land. The delivered model is intentionally
RiffScore-like: stable event/note IDs, measures, voices, explicit staffs, ties, and a
change subscription. That keeps a later swap a renderer/editor change rather than a data
migration.

## Decision record

- If a library must be adopted immediately: **RiffScore**, accepting the loss of
  same-staff voice 2 and drag; this fails the “independent rhythmic voices” requirement
  and is not the recommended product path.
- If the requirement set is fixed: **in-house editor now, RiffScore re-evaluation later**.
- Never: Smoosic as an embedded editor in this web application.
