# UI-L0 library selection spike

10 November 2026. **Passed for piano and neck candidates; svguitar deferred.** No
production route switch, no application import and no flag change. The spike is isolated in
`apps/web/spike.html` + `apps/web/src/spike/` and built separately with
`vite.spike.config.ts`.

## Environment

- React **19.2**, TypeScript **5.9.3**, Vite **7.3.7**, Chromium 156 headless.
- Installed with `npm install --save-exact` and no peer-force/downgrade.
- `npm audit`: 0 vulnerabilities.

## Packages and integrity

| Package | Version | Licence | Result |
| --- | --- | --- | --- |
| `react-piano` | 3.1.3 | MIT | Compatible with React 19 Strict Mode after explicit callbacks |
| `@moonwave99/fretboard.js` | 0.2.13 | ISC | Compatible; no destroy API, container reset required |
| `svguitar` | 2.10.1 | MIT | Renders, but 69.93 kB gzip dependency chunk — defer |

Exact integrity digests and transitive licences: [`third-party/README.md`](third-party/README.md).

## Spike cases

1. **Piano highlighting** — controlled `activeNotes` `[60, 64]`, toggle off/on, destroy and
   re-mount under Strict Mode.
2. **Horizontal guitar neck** — fretboard.js with phrase markers, resize to 360 px and back.
3. **Hand-authored C chord** — svguitar, no demo chord data or bundled fonts.

All three are in one fixture page; a phone (390 px) and desktop screenshot were captured.
No audio context, sample pack, font request, camera, microphone or MIDI access occurs;
the browser check asserts this.

## Compatibility findings

- `react-piano` publishes **no TypeScript declarations**; the spike uses a local module
  declaration. It advertises a wildcard React peer; React 19 works in the tested paths.
- Its `activeNotes` prop is a number array and requires `playNote`/`stopNote` callbacks even
  for display-only highlighting; without them React 19 throws on note-off. The keyboard's
  own inline `height:100%` also needs a wrapper with an explicit height or it collapses.
- `fretboard.js` has `clear()` for dots but **no destroy/unmount**; Strict Mode and
  re-mounts accumulate SVG wrappers unless the container is cleared first. `setDots()`
  only stores data and must be followed by `render()`.
- The spike's fretboard marker positions demonstrate drawing, not validated string/fret
  semantics. Adapter tests must establish that string 1 is high E and 6 is low E, and that
  displayed frets match the reviewed pitch; do not copy the spike mapping.
- `svguitar` works but its SVG.js/rough/svgdom closure is far above the current music-screen
  budget. It also carries OFL fonts that were neither loaded nor copied.

## Measured browser chunks (gzip)

| Chunk | Gzip |
| --- | --- |
| Piano candidate JS | **6.53 kB** |
| Piano candidate CSS | **0.45 kB** |
| Fretboard + its dependencies (manual chunk) | **15.78 kB** |
| SVGuitar + SVG.js/rough/svgdom | **69.93 kB** |
| Shared React closure | 69.06 kB |
| Whole spike entry (all three) | 162.85 kB |

The application's initial closure is unchanged at **129,114 B gzip** and the music screen
closure at **14,046 B gzip**: the new packages are not imported by the app. Replacing the
custom keyboard/neck will add the candidate chunk but remove existing custom code; UI-L1
must measure the **net** music-screen closure, keep instrument imports separate (piano must
not download guitar dependencies) and keep the existing 16 KiB screen budget in view.
Adding svguitar's ~70 kB to that screen is not acceptable for the initial migration.

## Decision

- Adopt `react-piano@3.1.3` and `@moonwave99/fretboard.js@0.2.13` as the first candidates
  for UI-L1 adapters, pinned exactly, behind default-off flags.
- **Defer** `svguitar` until reviewed chord shapes exist and a lazy, measured chord view can
  stay within budget; it is not a prerequisite for the neck migration.
- Keep the existing implementations until the adapter, flag-off fallback, error/loading
  states and visual fixtures pass. This spike does not declare Phase 4/8 complete.

## Evidence

- `scripts/verify_music_ui_spike.py` passes: highlight toggle, resize, Strict Mode
  destroy/re-mount, phone/desktop screenshots, no device or sample/font requests.
- Existing `scripts/verify_music_guide.py` still passes, so the current guide remains the
  baseline.
- Screenshots: `test-results/music-ui-spike-phone.png`,
  `test-results/music-ui-spike-desktop.png`; baseline:
  `test-results/music-guide-phone.png`, `test-results/music-guide-desktop.png`.
- The spike build command is `npx vite build --config vite.spike.config.ts` (outputs to the
  ignored `.spike-dist/`; it is not part of `npm run build`).

## Limits

No production integration, accessibility audit, chord-shape review, string/fret semantics,
or long-session/memory test is claimed. React 19 compatibility was exercised through these
fixture paths, not every react-piano interaction.
