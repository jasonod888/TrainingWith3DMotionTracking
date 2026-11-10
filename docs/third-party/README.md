# Third-party UI libraries (UI-L0 spike)

10 November 2026. These packages were installed for the isolated UI-L0 spike. They are
**not yet used by the application**; no production route imports them. Exact versions are
pinned in `apps/web/package.json` and `package-lock.json`.

## Direct packages

| Package | Version | Licence | Integrity (lockfile) |
| --- | --- | --- | --- |
| `react-piano` | 3.1.3 | MIT | `sha512-5SDFzprP+ICEMOJRkB0iqHo1qGcZpinRJ0ZW4HZu0pT6NftK+MpVN19VhXzd+MMN9C7QyGNB0nO4nd/cpGko/Q==` |
| `@moonwave99/fretboard.js` | 0.2.13 | ISC | `sha512-ON/PklMVbD3fXa8CXvdw4FS+2yJ50SD9GglhC4r2bhRLeglKU+ofcGrZXCVLhnAAYoXyVYDU9Ib1rYRIv+nkzQ==` |
| `svguitar` | 2.10.1 | MIT | `sha512-+olgGUvwjdhVeFj38gIxU1lpBcVj0O3r0iabvcoXP0nulxeuR3YT1CdSRTB2TaUO/AeE3RyegJWqEjypymadaA==` |

Licence texts: [`react-piano-3.1.3-MIT.txt`](react-piano-3.1.3-MIT.txt),
[`fretboard.js-0.2.13-ISC.txt`](fretboard.js-0.2.13-ISC.txt),
[`svguitar-2.10.1-MIT.txt`](svguitar-2.10.1-MIT.txt).

## Transitive packages relevant to distribution

| Package | Version | Licence |
| --- | --- | --- |
| `classnames` | 2.5.1 | MIT |
| `just-range` | 2.2.0 | MIT |
| `lodash.difference` | 4.5.0 | MIT |
| `prop-types` | 15.8.1 | MIT |
| `@tonaljs/interval` | 4.8.2 | MIT |
| `@tonaljs/mode` | 4.9.4 | MIT |
| `@tonaljs/note` | 4.12.3 | MIT |
| `@tonaljs/scale` | 4.13.6 | MIT |
| `change-case` | 4.1.2 | MIT |
| `d3-selection` | 1.4.2 | **BSD-3-Clause** |
| `throttle-debounce` | 2.3.0 | MIT |
| `svgdom` | 0.1.29 | MIT |
| `roughjs` | 4.6.6 | MIT |
| `@svgdotjs/svg.js` | 3.2.5 | MIT |

If a package is actually distributed, retain and include its copyright/licence notice.
`d3-selection` is BSD-3-Clause, not ISC like the direct fretboard package. The npm
dependency data is not a substitute for reading the distributed package's own licence.

## Assets and samples

- The spike uses system fonts and no audio, images, soundfonts or demo chord data.
- `svguitar` ships OFL-licensed fonts (`OpenSans-Regular.ttf`, `PatrickHand-Regular.woff2`)
  inside its package, but the spike does not load or copy them. Any future font use needs a
  separate OFL/notice review.
- No library demo assets or chord databases were copied. The only chord is the
  hand-authored C shape in the spike.

## Adoption condition

UI-L1 must bundle the notices for whatever actually ships, keep instrument imports
dynamic, and re-check transitive licences from the built artifact rather than trusting
this table. This record is a selection aid, not legal approval.
