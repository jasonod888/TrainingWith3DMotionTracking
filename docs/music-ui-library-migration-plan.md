# Piano and guitar UI library migration — developer handoff

10 November 2026. **Planning only: no libraries installed and no application code changed.**

Parent: [Multi discipline lesson platform implementation plan](multi-discipline-implementation-plan.md).
This is its instrument-rendering implementation addendum, not a replacement roadmap or
a restart of the music work. Read the current delivery status in
[music-delivery-status.md](music-delivery-status.md).

## 1. Decision and product outcome

Replace the hand-drawn keyboard/fretboard internals with reusable instrument-rendering
libraries. Keep the existing lesson page, instructor video, transport controls, sections,
practice setup, feedback, login, history and account navigation. The instrument diagram
should look more consistent without teaching users a new workflow.

Initial recommendation:

| Surface | Candidate / published version checked | Licence | Decision |
| --- | --- | --- | --- |
| Piano keyboard | `react-piano` **3.1.3** | MIT | First candidate; prove React 19 compatibility before adoption |
| Full guitar neck / timed pitch markers | `@moonwave99/fretboard.js` **0.2.13** | ISC | First candidate for the existing neck view |
| Compact guitar chord diagrams | `svguitar` **2.10.1** | MIT | Add only when reviewed chord-shape data is available; not a prerequisite for the neck migration |
| Staff notation or tablature | VexFlow | MIT | Later notation work; do not install in this migration |

These published versions/licence labels were checked against npm metadata on the date
above, not installed or benchmarked. Pin the exact versions that pass the first spike;
do not use `latest` or a caret range in the final migration. Upstream source can differ
from published packages. The library choices are conditional on the small compatibility
spike below; the developer is not being asked to adopt an incompatible dependency.

Primary references:

- React Piano [component API](https://github.com/kevinsqi/react-piano#props),
  [package manifest](https://github.com/kevinsqi/react-piano/blob/master/package.json),
  [MIT licence](https://github.com/kevinsqi/react-piano/blob/master/LICENSE).
- Fretboard.js [API documentation](https://moonwave99.github.io/fretboard.js/documentation-fretboard.html),
  [source/package](https://github.com/moonwave99/fretboard.js),
  [ISC licence in README](https://github.com/moonwave99/fretboard.js#isc-license).
- SVGuitar [API/source](https://github.com/omnibrain/svguitar),
  [MIT licence](https://github.com/omnibrain/svguitar/blob/master/LICENSE).
- Optional later [VexFlow](https://github.com/vexflow/vexflow) and its
  [MIT licence](https://github.com/vexflow/vexflow/blob/main/LICENSE).

MIT and ISC permit commercial use with their notice conditions. Retain the installed
versions' copyright/licence files and include applicable notices for transitive code or
assets actually distributed. Code permission does not automatically cover demo samples,
fonts, chord databases, recordings or model weights. Use system fonts and existing
instructor audio initially; do not copy a demo's soundfont/CDN assets. This is a normal
UI dependency review, separate from model/checkpoint approval.

A library owns drawing/layout. Our code still owns reviewed musical meaning, source
clock, MIDI normalization, feedback and access. It cannot infer an instructor's actual
fingering, approve a transcription or make an unsupported tuning correct automatically.

## 2. Fit within the multi-discipline plan

| Existing workstream | What this migration contributes | What it does not complete |
| --- | --- | --- |
| Phase 4, P4.6–P4.8 | Library-backed piano stage and the existing video/time integration | Reference semantics, actual transcription or an audio-clock redesign |
| Phase 5, P5.5–P5.8 | A reusable diagram that can appear in instructor review | Post-review editing, assessable-span authoring and music sharing |
| Phase 6, P6.1–P6.11 | Clearer piano display alongside existing optional MIDI practice/history | Hardware qualification, scoring thresholds, own-pace or microphone feedback |
| Phase 8, P8.3–P8.5 | Library-backed neck; later teacher-reviewed chord diagrams | Full guitar authoring, strum/voicing assessment or inferred hands |
| Phase 10 | UI licence notices, measured bundles and controlled rollout | Commercial AI-model approval or broad production qualification |

A watch-only guitar visual can be migrated now, independently of the microphone
assessment dependency for the full Phase 8 release. Do not declare Phase 8 complete
because a guitar diagram looks correct.

## 3. Current platform status — how much remains

There is no defensible single percentage: substantial foundations exist, but several
complete user capabilities are still absent. Use these completion states instead.

| Parent phase | Delivered / in place | Remaining work |
| --- | --- | --- |
| 0: baseline and controls | Baseline, compatibility decisions, licensing/qualification tools | Target-device audio qualification and actual artifact evidence |
| 1: contracts and host boundary | Body/music separation, runtime readers, routes/capabilities and subject snapshots | Maintain regression protection; no architecture rebuild needed |
| 2: discovery/navigation | Summary-driven mixed library, subject filters, group routing and cleanup | Validate additions through existing user journeys |
| 3: creation/processing | Audio-preserving preparation, recovery import, upload identity, validation, isolated worker/draft contracts | Real supported-browser upload, deployed pinned worker, approved actual inference and resource-isolation checks |
| 4: reference/guide | Reviewed reference identity, video/timer guide, custom keyboard/neck and timed controls | This rendering migration; richer reference semantics and qualified timing as needed |
| 5: authoring/release | Private draft corrections, review finalisation and watch/MIDI policy | Real-model drafting, explicit assessable spans, post-review revisions and normal teacher-to-learner music release |
| 6: piano MIDI | Opt-in input, unscored matching, practice controls and bounded summaries | First physical keyboard test, observation coverage, qualified scoring; own-pace and broader timing/release policies |
| 7: microphone | Future workstream defined | Detector selection/licensing, implementation and browser/exercise qualification |
| 8: guitar | Basic illustrative pitch guide and instrument routing | Reviewed chord/position authoring, supported capo/tuning/handedness, microphone assessment and actual guitar pilot |
| 9: results/session capabilities | Explicit personal music history, account view, pagination and deletion | Remaining shared-results/optional session capabilities from the parent plan |
| 10: commercial rollout | Migration execution, quota/retry races, backup recovery and evidence tools | Actual model/media rights, real end-to-end lesson pilot, device evidence, operating deployment and broader load checks |
| 11: advanced capabilities | Deliberately deferred | Not required for the first useful private piano release |

The immediate platform milestone remains one real piano lesson from instructor upload
through corrected reference, private release and learner practice. This UI migration can
run alongside that work; do not put the entire remaining platform behind a visual rewrite.

## 4. Scope and invariants

In scope: piano keys, guitar neck/markers, diagram sizing/theme/accessibility, renderer
wrappers, visual fixtures, targeted capability flags, bundle measurement and fallback.

Do not change in the core migration:

- Login, account/subject choices, discovery, sharing flow or route destinations.
- Body `LessonManifest` v1, `LessonWorkspace`, body controller/camera calibration or pose history.
- Reviewed-reference hashes/revisions, note identities, matching tolerance, optional-note
  policy, MIDI parsing, source/video timing, summaries or persistence contracts.
- Existing practice speeds or repeat/count-in semantics. The plan currently lists
  0.25/0.5/0.75/1 while implemented music uses 0.5/0.75/1/1.25. Record a separate controller
  reconciliation ticket; this drawing migration must not silently change saved speed meaning.
- Device permission timing. Watching/drawing must not request MIDI/microphone/camera,
  create an audio context, fetch sample packs or save any summary.

No new backend lesson schema or migration is required for a keyboard/neck replacement.
Teacher-reviewed chord shapes are a separate Phase 8 contract extension, not data to
invent in a rendering adapter.

## 5. Architecture and ownership

Keep `LessonExperienceHost` as the family boundary. `MusicLessonHome` continues owning
video/guide timing, reference validation, section transport and practice. Introduce a
presentation boundary inside that page:

```text
Validated reviewed reference + existing source time
                    |
             presentation adapter
                    |
       InstrumentGuideStage (music only)
              /                 \
     lazy PianoGuide       lazy GuitarNeckGuide
       react-piano          Fretboard.js
                                   \
                      later reviewed chord card
                               SVGuitar
```

The stage receives immutable reference-derived values; it does not start another clock,
load the lesson itself or handle scored input. A DOM renderer may own its private SVG
subtree. React owns the host, labels, resize lifecycle, errors and navigation.

Proposed files (names may follow repository conventions):

- `apps/web/src/music/renderers/InstrumentGuideStage.tsx`
- `apps/web/src/music/renderers/PianoGuide.tsx`
- `apps/web/src/music/renderers/GuitarNeckGuide.tsx`
- `apps/web/src/music/renderers/GuitarChordGuide.tsx` — later, with reviewed data
- `apps/web/src/music/renderers/guide-view-model.ts`
- `apps/web/src/music/renderers/legacy/` — temporary rollback path
- `apps/web/src/music/renderers/instrument-guide.css`
- `apps/web/tests/instrument-guide.test.tsx` and focused adapter tests
- `scripts/verify_music_library_guides.py`
- `docs/music-ui-library-verification.md`

Use application-owned view models: MIDI pitch remains a number; positions retain
string/fret identity; a position's provenance is `illustrative` or `reviewed`. Never
serialize vendor-specific classes/options into lesson manifests or database rows.

## 6. Phased implementation and developer tickets

### UI-L0 — package, compatibility and visual spike

**Status: passed 10 November 2026.** React 19.2 Strict Mode, TypeScript 5.9 and the Vite
spike build pass. Piano and neck candidates are compatible with the fixes recorded in
[`music-ui-library-spike.md`](music-ui-library-spike.md); svguitar renders but its ~70 kB
gzip closure is deferred. Exact versions are pinned and notices retained. This does not
switch any production route.

Deliver one small fixture page/harness containing the three useful cases: piano
highlighting, horizontal guitar neck and a hand-authored chord diagram. No production
route switch yet.

Tasks:

1. Snapshot existing phone/desktop guides and timing/device/history network behavior.
2. Inspect the exact published packages, licences, transitive dependencies and assets.
   Record pinned versions and integrity in the lockfile and a short selection record.
3. Prove React 19.2, TypeScript 5.9, Vite production build and development Strict Mode.
   React Piano advertises a wildcard React peer, but upstream tests use an older React
   stack; the wildcard is not proof of current compatibility. Check actual behavior.
4. Measure built browser chunks, including CSS/dependencies; verify no Node-only module
   or font/polyfill is accidentally pulled into the browser. Fretboard.js brings D3/
   Tonal dependencies; SVGuitar publishes SVG/rough-drawing/server-DOM dependencies.
   Do not judge cost from a package download-size badge.
5. Confirm controllable highlights, resizing, destruction/re-mount and zero unsolicited
   device/audio/network activity. Do not use `--force`, React downgrades or broad dependency
   upgrades to make a candidate install.
6. Select the first candidates if they pass. For a neck failure, evaluate SVGuitar's
   horizontal configurable-fret renderer or `traste` as one bounded alternative, checking
   exact published API/licence before adoption. For piano compatibility failure, record
   a small maintained-fork strategy or evaluate another focused keyboard renderer; do
   not rebuild the app or import a whole music-learning platform.

Exit: a package-selection record, comparison screenshots, measured browser size and
clear supported capabilities. A blocked optional chord library does not hold up piano.

### UI-L1 — extract presentation and add independent switches

Tasks:

- Move existing keyboard/fretboard JSX/CSS behind `InstrumentGuideStage` without changing
  behavior first. Keep reference validation and the controller outside the stage.
- Add independent default-off capabilities, e.g. `music_piano_library_ui` and
  `music_guitar_library_ui`, with server settings, safe absent-field defaults and typed
  propagation through `LibraryApp` / `LessonExperienceHost` / `MusicLessonHome` entry paths.
- Keep vendor imports dynamic and instrument-specific. Body lessons must not download
  them; piano must not load guitar packages and vice versa.
- Add renderer-level loading/error handling. A drawing failure keeps the video, time
  controls, text notes and Back working. Preserve the current time during fallback.

Exit: flag-off behavior matches the baseline, both music entry paths receive the flags,
and movement navigation/control behavior is unchanged.

### UI-L2 — replace piano geometry with React Piano

Tasks:

- Feed programmatic highlights from the existing active-note calculation. Do not wire
  renderer callbacks into `MidiNotes`, feedback, capture counts or history.
- Use the library's controlled `activeNotes` and verified input suppression. Do not assume
  an undocumented `readOnly` prop exists. Supply required audio callbacks without starting
  audio, omit keyboard-shortcut capture, and test that clicks/touches cannot manufacture
  played MIDI attacks or hijack Space/transport keys.
- Derive a stable range from the whole reference, clamped to physical piano 21–108.
  Range endpoints must be natural notes for this library. Do not zoom or shift the range
  on every attack. Default sensibly for empty or unsupported-pitch references and show
  accessible text for out-of-range notes instead of silently changing their pitch.
- Let the library determine white/black geometry. Restrict CSS to theme, sizing and
  highlight states; do not override individual key positions back into custom geometry.
- Use a measured container width and a cleaned-up ResizeObserver. For wide ranges on a
  phone, contain horizontal scrolling inside the diagram instead of shrinking 88 keys
  into unreadable targets or overflowing the page.
- Keep teacher/reference highlights distinct from physical pressed/pedal-held state.
  Initially the instrument stage may show reference notes only, with the existing input
  panel unchanged. Do not invent hand colours or fingering.
- Preserve accessible note text outside a rapidly changing graphic; avoid live-region
  announcements every frame. Respect reduced-motion preferences.

Exit: A0=21, C4=60, A4=69, C8=108; accidentals, polyphonic highlights, repeated attacks,
seek, rest, end, video fallback, resize and lesson switching all match the reference.
No soundfont, Tone.js or synthesis package is needed for this visual replacement.

### UI-L3 — replace the guitar neck with Fretboard.js

Tasks:

- Mount one SVG instance inside a ref-owned host; update markers when the active position
  set changes. Do not recreate the entire SVG on every animation frame. Remove listeners,
  SVG nodes and ResizeObserver on unmount/reference replacement; verify Strict Mode does
  not produce duplicate necks or handlers. Use actual documented lifecycle methods and
  explicit host cleanup rather than assuming a `destroy()` method.
- Establish one adapter convention: standard string 1 is high E; 6 is low E. Tuning is
  stored low-to-high as MIDI `[40,45,50,55,59,64]`. The existing `guitarPosition()` uses
  low-to-high indexes numbered 1–6; convert at the boundary (`7 - legacyString`) and test
  against the installed library. Do not rewrite stored pitch events for orientation.
- Verify 40→string 6/open, 45→5/open, 55→3/open, 59→2/open and 64→1/open. Render frets
  0–12 with clear nut/open-string treatment, labels and contained responsive layout.
- Retain the illustrative-position warning. A lowest-fret location is not confirmed
  fingering. When simultaneous candidates conflict on a string, retain the current
  honest unavailable/review-needed behavior; do not show an impossible chord.
- Retain unsupported capo/tuning behavior until the application validates the mapping.
  Library custom-tuning capability alone does not qualify our lesson data or assessment.
  If left-handed display is added, mirror layout deliberately without reversing pitch
  identities or the source video; otherwise label that mode unavailable.
- Keep examples for scale/chord auto-generation out of learner lessons. Teacher-reviewed
  event/shape data remains authoritative, not a vendor's inferred scale or chord database.

Exit: open strings and selected frets produce the expected pitches; marker clearing,
unsupported settings, conflicting positions, resize, orientation and Back are correct.
A clean standard-tuning watch-only guitar guide can ship before guitar assessment.

### UI-L4 — reviewed chord diagrams (Phase 8 follow-on, optional for initial migration)

SVGuitar is for compact chord cards, not automatic recovery of guitar finger positions.

Tasks:

- First add an application-owned, versioned reviewed-shape contract with explicit string
  order, muted/open/fretted state, capo convention, optional barre/finger labels, chord
  interval and review provenance. Extend runtime validation, fixtures and instructor
  editing/acceptance. Existing references remain readable without shape data.
- Feed only confirmed shapes to SVGuitar. Do not turn the current lowest-fret guesses
  into "teacher approved" chords or assume a chord name determines its voicing.
- Show a chord card only when its reviewed time interval is current. For absent shape
  data retain the pitch/neck guide and instructor video; no schema migration is needed
  merely to keep those existing lessons working.
- Use normal SVG rendering, system fonts and plain-text labels. Include licence/notices
  for any assets actually shipped. Test teacher-entered labels are text, not executable SVG/HTML.

Exit: reviewed shapes render consistently and retain musical meaning across orientation,
capo and chord transitions for explicitly supported configurations. Do not claim strum,
voicing, left-hand technique or microphone assessment from this card.

### UI-L5 — integration, verification and staged rollout

Tasks:

- Render the same stage in review/preview/practice wherever instrument visualization is
  present, without forcing a new route or replacing the instructor correction workflow.
- Add a vendor-independent visual fixture suite, plus browser checks listed below. Test
  supported library mode and flag-off fallback. Assertions should use application-owned
  roles/labels/state, not vendor-private DOM class names.
- Record notices, screenshots, exact package versions, limitations and measured bundles.
- Enable piano and guitar separately for internal test accounts/environments. Rollback
  selects the existing renderer; it must not roll back references, history or database schema.
- Keep the legacy path for one internal comparison/release window. Remove obsolete
  geometry CSS and legacy-only tests after acceptance; retain musical adapter tests.
  Do not maintain two unrelated production renderers indefinitely.

Exit: the acceptance checklist passes for the enabled instrument. Hardware/model/release
qualification remains in its own workstream; it is not needed to verify a read-only drawing.

## 7. Test and acceptance checklist

| Check | Required evidence |
| --- | --- |
| Musical mapping | Piano golden pitches/accidentals; six guitar open strings and fret boundaries; canonical string conversion |
| Time behavior | Same reviewed note IDs highlighted for the same source time, including chords, seeks, loops, speed changes, count-in/rest and end |
| Existing workflows | Same instructor upload/review, learner entry, video controls, settings, Back and account history destinations |
| Permissions and persistence | Zero camera/mic/MIDI prompts from renderers; zero automatic summary save or sample/CDN request |
| Lifecycle | No old diagram after lesson change, no duplicate SVG/listeners on remount, clean exit/background handling and stable fallback |
| Input isolation | Clicking a diagram or using page shortcuts cannot increment physical MIDI counts or create feedback evidence |
| Responsive/accessibility | 390×844, 812×375, 1280×800; contained instrument scrolling; meaningful text; focus and reduced-motion checks |
| Scope honesty | No false fingering, unsupported tuning/capo marker or unreviewed chord shape |
| Compatibility | React 19.2, TS/Vite build, runtime readers, existing reference fixtures and absent capability fields |
| Movement regression | Existing feed/preview/practice/compete browser scripts continue passing with new UI capabilities off and on |
| Private history regression | Exact save retries, separate session IDs, late response protection, account pages/delete unchanged |
| Commercial UI use | Installed licences/transitives/notices recorded; no unreviewed sample/font/chord content bundled |

Use existing music guide, screen, review, MIDI, practice, feedback, history and mixed-
discovery scripts as applicable. Add one focused library-guide script. No need to rerun
hardware or database stress tests for a CSS-only correction; broaden checks when actual
changed paths justify it.

## 8. Performance and bundle contract

Current documented measurements are approximately 129,114 gzip bytes for initial JS/CSS
and 14,046 for the music screen static closure. They are prior measured baselines, not
measurements of the proposed libraries. Rebuild/re-measure the developer's checkout.

Preserve existing checks in `scripts/check_web_bundle.mjs` and
`docs/multi-discipline-bundle-baseline.json`: initial-library growth remains within the
existing 16 KiB headroom, and the music shell's music-only static closure stays within
16 KiB. Import the renderer dynamically by instrument instead of hiding growth behind
an unchecked dynamic import.

Extend the checker to report/check the complete active-instrument lazy closure, including
transitive JS/CSS and any fetched assets. A **proposed starting budget** is 25 KiB gzip
additional unique renderer code per instrument, with no renderer/samples on movement-only
navigation. UI-L0 must accept or explicitly revise that target using measured package
costs before the default-on switch; do not delete assertions or silently raise budgets.
This is a planning target, not a claim that any candidate currently meets it.

Prefer updates only when highlighted pitches/positions or size actually change. Keep
our one source clock; renderers do not run a second RAF loop. Profile a dense reviewed
fixture and repeat/seek interactions. Record update latency on the tested browser; do
not invent universal device-performance guarantees.

## 9. Suggested handoff slices

1. Selection spike and notices/bundle report — UI-L0.
2. Presentation extraction, fallback and independent capabilities — UI-L1.
3. Piano library integration with musical/lifecycle/browser tests — UI-L2.
4. Guitar neck integration with explicit string mapping — UI-L3.
5. Instrument-specific acceptance, rollout and legacy cleanup — UI-L5.
6. Reviewed chord authoring plus SVGuitar cards — UI-L4, separately within Phase 8.

The developer should provide a small reviewable change per slice, screenshots and a
short record of what was verified. Do not combine library migration with model upgrades,
scoring, publication changes or a new lesson schema in the same change.

## 10. Broader next milestone, in parallel

While visual work proceeds, continue the real piano release path: one commercially
approved artifact/run profile, rights-cleared acoustic fixtures, browser audio preparation
and isolated-worker operation, reviewed private invite release, then one teacher/learner/
keyboard/browser smoke test. Physical keyboard, actual observation coverage and scoring
thresholds remain open. Microphone feedback and full guitar assessment remain separate.

This plan does not install packages, approve a model, enable music processing/sharing/
scoring, change login or alter the movement workflow. Existing local qualification fixes
must be preserved/checkpointed before overlapping work. The canonical plan remains the
source of product requirements; this addendum controls the renderer migration work.
