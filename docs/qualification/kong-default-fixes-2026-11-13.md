# Kong default: fixes and live verification

13 November 2026. Follow-up to `kong-default-review-2026-11-13.md`.

## Result

The ten reviewed defects have been addressed. Migration 0025 is applied to the local `form_ui_test` database, and an approved Kong worker is registered and running. Two real new uploads completed through `music-piano-kong-v1`, with zero automatic correction operations. Existing lessons were not retranscribed or replaced. No commits were created.

Full recording test lesson:

http://127.0.0.1:5173/?page=preview&id=c327a2b51fd3499cb4acecfa50d1b69c

Leading-silence test lesson:

http://127.0.0.1:5173/?page=preview&id=78d0d7dda0ee4e84b9f5aa019bfd239b

Both are private lessons in the existing owner test account. Neither was published. Original audio is the default without a saved device preference.

## Findings addressed

| Finding | Correction |
|---|---|
| Independent review keyboard/clock | Review keys and roll read source media time. Their independent transport is removed in this mode. All visible notes are rendered, including the real recording's 1,116 notes. Clock updates are isolated from the large editing form. |
| Double lesson offset | The canvas receives raw onsets and applies the offset once. Audio, keys, graph and pedal state use the same convention. |
| Negative starts discarded | Shifted intervals are intersected with the source window. Notes crossing zero stay visible/active; drawing is cropped without moving their endings. |
| Unsafe media lifecycle/failures | A shared controller handles mounted elements, readiness, seek, pause, buffering, end and cleanup. Failed Piano playback restores Original with a visible error. Buffered network stalls do not silence playback. |
| Fine adjustments ignored | Explicit offset/mode/seek changes force the signed mapping. Small continuous drift uses smooth pitch-preserving rate correction instead of repeated short seeks; large discontinuities still seek. |
| Stale audio after editing | Changed performance content clears the old preview and identity on finalisation or later edits. Unchanged/title-only edits can reuse it. Pedal spans survive in both edited reference and manifest. |
| Worker labels selected raw policy | The server-assigned route determines raw completion. Kong requires correct model/engine/adapter provenance, a route-approved profile and a bound preview. Wrong model/route/profile results are rejected. Worker startup also enforces profile/route agreement. |
| Incomplete profile/config pinning | Package contents/version metadata, helper implementation and relevant runtime versions are verified. The config must match its file; supported settings reach Kong and unsupported ones fail. Imported Kong code must be inside the verified bundle. Native NumPy values serialize safely. |
| Settings lifecycle | PATCH requires draft identity, settings revision, ownership and editable status. Replaced/finalized drafts reject changes. Temporary lesson offsets reset by revision and are bounded; mode/volume preferences persist separately. Pending sync saves block finalisation. |
| Missing deployment | Local migration, route-specific profile approval, worker registration and API/worker startup are complete. Both real uploads exercised the normal route. |

Estimated sustain-pedal state is shown in both guides. Encoded punctuation found during visual inspection was repaired on the affected pages.

## Preview loading and synchronization

The long recording exposed range-seek buffering that seeded tests missed. The frontend now fetches the complete authorized piano preview, verifies byte count and SHA-256, and creates a local Blob URL before enabling Piano. Invalid/unavailable audio is not played; Original stays available and download failures offer retry. This follows the existing 160 MiB output limit and trades download/memory cost for reliable seeking.

The controller avoids repeated same-value media assignments and repeated seeks on `canplay`. Minor clock errors use smooth rate correction, with pitch preservation, limited to 0.1 around the selected source rate. Explicit timing adjustments still use `piano time = source time - offset` exactly. Raw note times and saved audio are not edited by drift correction.

## Real input evidence

| Input | Result |
|---|---|
| Full owner `river flows.mp4` | 209.594 seconds, 1,116 Kong notes, raw-model receipt, zero automatic corrections, retained preview and raw-event analysis. Source SHA-256: `3fc2c583c9a7c4afca619909748f28e9da31b63a04a102083957bc5930a6cef4`. |
| Derived leading-silence clip | Three seconds of added silence plus eight seconds of the same source; 20 Kong notes, first onset approximately 3.917 seconds. Leading silence is retained; zero corrections. |

Chromium acceptance exercised source-driven keys, all notes, mid-play audio switching, fine signed adjustments, negative offset at zero, canvas positioning, finalisation, loop wrap, simulated playback failure/fallback/retry, settings reset and volume persistence. Mobile emulation at 390 x 844 and DPR 2 passed; canvas pixel width remained twice its CSS width.

Full-recording foreground Chromium measurements, after one second of settling:

| Window | Speed | Maximum observed media-clock difference |
|---|---:|---:|
| 2 s | 1x | 44.0 ms |
| 40 s | 1x | 43.6 ms |
| 100 s | 1x | 46.7 ms |
| 180 s | 1x | 43.3 ms |
| 40 s | 1.5x | 20.1 ms |

These are short transport measurements, not acoustic latency or transcription accuracy. The initial 40 ms target was not met in every sampled window; do not claim strict 40 ms qualification or sample-accurate synchronization. Physical mobile devices and Safari were not tested; this Playwright runtime lacks its matching WebKit executable.

Artifacts: `.local/kong-default-review/{live,silence}-upload.json`, corresponding draft and browser-acceptance JSON, `transport-acceptance.json`, `mobile-acceptance.json`, screenshots, test logs and XML. Private session and credential files must not be committed or shared.

## Verification

- Full Python run: **919 passed, 14 skipped, zero failures**, 496 seconds; `api-suite.log` and `api-suite.xml`.
- Final focused Kong/profile/playback/completion tests: **15 passed**, including the subsequently added native NumPy serialization case.
- Final complete web run: **339 passed, zero failures**.
- TypeScript and production build passed. The existing bundle-size advisory remains.
- Whitespace checks passed for affected tracked files.

Regressions cover actual controller/canvas behavior, async mounting, a 1,200-note review, wrong preview hashes, package/config mutation, route mismatches, correction bypass even with a report present, stale settings, stale edited audio and pedal conservation.

## Operation and limits

`scripts/prepare_kong_profile.py` prepares the installed bundle after checking the existing rights manifest and checkpoint identity. Profile: `model-pilot-output/kong-default-profile`; current approved digest: `c75ed4fdea373d2507728a730fb0e380e5e7c094df1ba6536175db97494558c7`. Model/helper changes require renewed verification and approval.

The local API launcher is `.local/piano-ui-test-runtime.py`; the worker launcher is `.local/kong-default-worker.py`. Both are running in the background for this development session. A machine restart still requires launching development services.

Edited-note Piano previews are safely disabled rather than automatically regenerated by this patch. Original audio and the edited guide remain usable; the immutable raw baseline remains retained. This closes stale playback without adding another inference/correction stage. Automatic edited-preview regeneration is a separate enhancement.

These fixes do not claim better transcription accuracy or identical synthesized timbre. Kong's predictions remain raw model output. Original mode plays the actual source audio.
