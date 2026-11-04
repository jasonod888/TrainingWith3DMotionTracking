# Multi discipline lesson platform implementation plan

Status: revised implementation plan, revision 2, 4 November 2026. All phases below are planned, not completed. This file is the canonical plan. `requirement/mutli discipline.txt` is a pointer to it and carries no requirements of its own.

Revision 2 records twelve product and engineering decisions taken after a code-level review of the checkout. Where revision 1 left a boundary undecided, this revision decides it. Sections that changed materially are marked **[R2]**.

## 0 Decision log

| ID | Decision | Lands in |
| --- | --- | --- |
| D1 | The existing `LessonManifest` TypeScript type stays body-specific. Add `LessonSummary` and `MusicLessonManifest`; use a discriminated union only at validated loading and dispatch boundaries. Add `LessonExperienceHost` before `LessonWorkspace` constructs its body `Playback` or starts progress persistence. | §3.2, §3.3, §7 |
| D2 | Phase 1 delivers contracts, runtime readers, capability responses and compatibility behaviour. The library state migration to summaries is Phase 2 application work. Owned/shared pagination is deferred; public listing keeps its pagination. Legacy body-shaped endpoints stay body-only; mixed-subject clients use an explicit new representation. | §3.3, §7, §8 |
| D3 | Processing configuration becomes an explicit server-side route catalogue (subject/family, pipeline, provider, allowed assets, availability). Body route stays the default. Availability is reported per capability. | §3.5, §7 (1E, 1F) |
| D4 | Music uploads one prepared clip, starting at zero, as the authoritative processing source. No automatic fallback to the original file. Optional client-reported preparation provenance; scoring and synchronisation use the uploaded media timeline. | §2, §4.1, §9 |
| D5 | Audio preparation is qualified in Phase 0, ahead of Phase 3: MP4 AVC/AAC and WebM VP8/Opus are candidates, verified on our installed mediabunny and target browsers. Audio sidecars are deferred; if neither path works, an explicit export/import recovery path is required before broad rollout. | §6 (P0.8), §9 |
| D6 | Completion and asset handling use separate typed contracts selected against the leased job's pipeline. Explicit asset roles and family-specific enumeration replace scattered body allowlists. Private extracted audio gets the same protection as private source video. | §3.3, §9 (P3.6–P3.7), §18 |
| D7 | Music teaching sections stay contiguous and cover the whole lesson. Assessable playing spans are separate and may be sparse. No second sparse teaching-section model in the first release. | §3.3, §10 (P4.4) |
| D8 | Music uses its own controller with the existing four speed presets. Body `Playback`/`PracticeSession` and the progress contract are unchanged. Own-pace is an alignment mode, not a saved speed. | §4.2, §12 (P6.4–P6.5) |
| D9 | Movement attempt limits and the pose-typed endpoint stay unchanged. Music attempts get a separate contract and storage path with a separate 5,000-attempt limit per account across piano and guitar, counting completed attempts only, with bounded event detail. | §12 (P6.11), §18 |
| D10 | The instructor-alpha work is part of the agreed baseline or is explicitly isolated before overlapping music changes. No reset, discard or unauthorised commit. Phase 0 continues; Phase 1 waits for a reproducible baseline. "Freeze v1" means preserve the agreed body contract during music delivery. | §6 (P0.9), §23 |
| D11 | Add the omitted touchpoints: reproducible schema generation, per-artifact drift checks, `database_ready()` coverage, explicit music test discovery, the host before body controller initialisation, and acceptance-shortcut tests for publish and trim. | §3.4, §7, §19, §20 |
| D12 | One canonical plan, one subject catalogue. `movement_other` stays the compatibility identifier and maps to **Full Body Movement**; existing lessons keep that label until the owner chooses a more specific subject. No inference from titles or tags. | §1, §3.1 |

## 1 Purpose and product outcome

Extend the existing platform so one learner can use the same account to discover, receive, watch, practise, and revisit dance, taekwondo, boxing, piano, and guitar lessons. Instructors use the same account and creation lifecycle across subjects. Music introduces new reference generation and assessment capabilities within this product.

Preserve the current movement workflow throughout delivery. Keep the existing movement conversion, review, sharing, practise, camera setup, and competition behaviour operational. Add music incrementally behind server-controlled capabilities and feature flags. Introduce most subject-specific interface changes inside practise, while retaining the same layout, navigation, controls, and lifecycle.

The main deliberate differences before practise are the subject choice during creation, a subject badge/filter in discovery, and instrument-specific reference content inside the existing review screen. Accurate music authoring needs note correction; it cannot be hidden by making the review screen visually identical to movement review.

Implementation must satisfy the commercial-use requirement recorded in [the licensing review](model-commercial-licensing.md). The [music feasibility review](music-lessons-exploration.md) supplies background. This document controls implementation scope and sequencing; it does not approve unresolved model licences.

### Product acceptance scenario

A learner signs in once, opens a taekwondo lesson from the library, practises, returns to the same library, opens a piano lesson, connects a keyboard, and practises. They then open a shared guitar lesson without a second account, a separate app, or another onboarding flow. Back, preview, progress, sharing, and attempt review occupy familiar places. Each subject retains its own meaningful feedback and progress.

A person can teach piano and learn boxing using that account. Teaching is determined by ownership and permissions, rather than a second identity or mandatory global instructor role. Access to the platform's subjects does not grant access to somebody else's private lessons: existing lesson grants, groups, and public-release permissions still apply.

### First visible milestone

Complete Phase 0 and the Phase 1 slices, then deliver a single internal piano fixture through the existing library, preview, and practice destinations. The same account must then open an existing movement lesson with its behaviour and settings preserved. No real transcription, microphone, or guitar work is part of this milestone.

## 2 Fixed requirements

1. One authentication system, account, navigation shell, library, sharing system, and group system.
2. No automatic reprocessing, relabelling, republication, or scoring changes to existing movement lessons.
3. Existing movement manifests and job routes continue to work without music fields or music dependencies.
4. Users select a subject, never a model, provider, pipeline version, schema version, or technical processing mode.
5. Music retains the real instructor video alongside an instrument guide; showing a procedural guide does not imply reconstructed fingers.
6. Musical notes, rhythm, and visual technique are independent evidence dimensions. Camera use is optional for the initial music product.
7. No camera, microphone, MIDI permission, or recording begins merely from browsing or opening preview.
8. Existing acceptance and release rules remain authoritative. Music adds reference-review validation within that lifecycle.
9. No global score compares piano accuracy to movement matching, or microphone evidence to MIDI as if they were equivalent measurements.
10. A music model or dependency with unresolved commercial permissions cannot become a production default.
11. Faults in a music worker or module must not prevent movement creation or practice.
12. User-visible success must reflect actual completion. Unknown input, unavailable models, and unsupported devices produce recoverable states.
13. **[R2]** A music lesson uploads one prepared clip, starting at zero. That upload is the authoritative processing source. There is no automatic fallback to uploading the original file.
14. **[R2]** Client-reported original-selection offsets are provenance, not verified source timestamps. Scoring and synchronisation use the uploaded media timeline and measured offsets.
15. **[R2]** Availability is reported per capability. A missing or offline music route never renders movement creation or practice unavailable.
16. **[R2]** Unreviewed music cannot become accepted through the publish shortcut or the trim shortcut.

## 3 Domain and architecture decisions

### 3.1 Separate subject from processing family

| Concept | Proposed values | Meaning |
| --- | --- | --- |
| Subject | `dance`, `taekwondo`, `boxing`, `piano`, `guitar`, `movement_other` | Library organisation and subject-specific defaults |
| Experience family | `body`, `music` | Selects reference representation and practice integration |
| Instrument | `piano`, `guitar`; absent for body | Music configuration and renderer |
| Pipeline | Existing `sam-3d-body-v1`; proposed `music-piano-v1`, `music-guitar-v1` | Versioned backend execution contract |
| Assessment | Existing `pose-v1`; proposed versioned music rubrics | Interprets observations and computes feedback |
| Input evidence | Camera pose, MIDI, microphone; optional future hands | What the learner device can actually observe |

#### Subject catalogue **[R2]**

One catalogue is the single source of subject identifiers, display labels, family and default instrument. The server owns it; the client receives labels rather than duplicating a second table.

| Subject ID | Display label | Family | Default instrument | Availability default |
| --- | --- | --- | --- | --- |
| `movement_other` | Full Body Movement | `body` | — | Existing movement route |
| `dance` | Dance | `body` | — | Existing movement route |
| `taekwondo` | Taekwondo | `body` | — | Existing movement route |
| `boxing` | Boxing | `body` | — | Existing movement route |
| `piano` | Piano | `music` | `piano` | Subject to music routes |
| `guitar` | Guitar | `music` | `guitar` | Subject to music routes |

`movement_other` remains the compatibility identifier. Every existing lesson keeps it and displays **Full Body Movement**. An owner may later choose a more specific movement subject. The server does not infer dance, taekwondo, or boxing from a title, tags, filename, or thumbnail, and no migration rewrites stored manifests to guess one.

Dance, taekwondo, and boxing initially continue through the existing body pipeline and rubric. Adding a boxing subject does not establish validated boxing-specific judging or technique coaching. Such improvements require their own later scope.

Subject and family must agree. The server derives the allowed family and pipeline from subject and enabled capabilities. It rejects contradictory settings instead of accepting a client-supplied model route. Published subject/type changes require appropriate reference regeneration and a new revision; changing a piano lesson to guitar is not a harmless metadata edit.

### 3.2 Extend through a small integration boundary

Add a lesson experience host that dispatches body lessons to the existing components and music lessons to new modules. Keep body camera and reconstruction logic inside the body implementation. Do not rewrite `PracticeWorkspace.tsx` into a universal framework.

**[R2] The host sits before body controller initialisation.** `LessonWorkspace` currently constructs `Playback` from the lesson's sections in its first render and then owns progress loading and saving. `LessonExperienceHost` must therefore wrap or replace `LessonWorkspace` at the call site, so a music lesson never constructs a body `Playback`, never starts the progress saver, and never mounts the body practice controller. The host is not a prop inside `LessonWorkspace`.

Share stable shell elements: header/back behaviour, preview entry, practice toolbar, section list, settings-panel conventions, count-in/repeat lifecycle, and attempt-review placement. Extract individual shared components only when music needs them, verifying the movement presentation after each extraction. Initially, matching a small control component in two modules is preferable to destabilising the body practice controller through a large refactor.

The internal adapter boundary covers capabilities, reference loading, practice preparation, observation start/stop, clock mapping, feedback, and cleanup. Renderers receive approved reference data and playback state. Evaluators receive timestamped observations and approved rubrics. Neither renderer nor evaluator owns authentication, lesson access, or global navigation.

**[R2] Type discipline.** Body components keep receiving `LessonManifest` and never narrow a union. The host and the API client parse untrusted payloads with runtime validators and only then pass a typed value to either workspace. TypeScript casts from `unknown` are not an acceptable substitute for validation at these boundaries.

### 3.3 Contracts at the boundaries **[R2]**

Three named contracts, each with one job:

| Contract | Used by | Shape |
| --- | --- | --- |
| `LessonManifest` | Existing body components, preview, review, practise, competition, paired display | Body v1, unchanged. Already `extra='forbid'` with `schema_version: 1`, so it must not gain subject or family fields. |
| `LessonSummary` | Discovery, cards, filters, group lists, resume lists | No musical events and no body assets. Identity, title, subject, family, instrument, duration, section count, approved poster reference, and capability hints. |
| `MusicLessonManifest` | Music preview, review and practice modules | `schema_version: 2`, `experience_family: music`, instrument configuration, contiguous sections, reviewed-reference asset, assessment policy and rubric reference, approved public derivative. |

A discriminated union exists only at validated loading boundaries: the API client's lesson parser, the host's dispatch, the library's mixed list, and the music module's own loader. It does not propagate into body components.

Because v1 has no `experience_family` field, readers normalise its absence to `body`. Writers never add that field to a v1 object. A v1 reader rejects a v2 object; a v2 reader accepts both.

**[R2] Teaching sections.** Music manifests require contiguous teaching sections covering the complete lesson, reusing the existing section model and navigation. Introductions, explanation, pauses, and silence stay inside those sections. Assessable playing spans are a separate, possibly sparse list. Gaps between playing spans are never treated as required silence.

Create shared internal lesson identity and display interfaces without rewriting stored v1 JSON. Continue generating and checking JSON Schema from the API contracts. Deploy compatible readers before enabling v2 creation or publication.

Old clients must not receive v2 objects in endpoints they assume contain only v1. Add explicit supported-format negotiation, with the existing unversioned client behaviour defaulting to v1. A new client advertises v1 and v2. An old client requesting a music deep link receives a recoverable unsupported-format response and refresh guidance, rather than a body-shaped fake or an authorisation error. This is temporary client compatibility, not permanent subject separation.

### 3.4 Versioned schema artifacts **[R2]**

Three generated artifacts replace the single body schema:

| Artifact | Content | Compatibility rule |
| --- | --- | --- |
| `packages/lesson-schema/manifest.schema.json` | Body v1 contract | Byte-identical to today's file until an authorised body change regenerates it |
| `packages/lesson-schema/music-manifest.schema.json` | Music v2 contract | New; versioned with the music contract |
| `packages/lesson-schema/lesson-boundary.schema.json` | Combined boundary union of body v1, music v2 and `LessonSummary`, discriminated by `schema_version` and `summary_version` | New; the only artifact that describes a mixed response |

Generation is reproducible and checked in. A repository command (for example `python -m apps.api.export_lesson_schemas`) writes all three from the Pydantic models, and `--check` exits non-zero on drift. Each artifact gets its own drift test; the existing single-model drift assertion is replaced, not merely extended, so a music change cannot pass by matching the body file.

### 3.5 Processing route catalogue **[R2]**

Replace the single pipeline constant and single provider status with a server-side route catalogue. Each route declares:

- subject and experience family;
- pipeline version and the provider setting that supplies it;
- provider target or dispatcher setting, where applicable;
- required and optional asset roles, with the completion contract each route produces;
- the capability key used to report availability.

| Route | Family | Pipeline | Completion contract | Availability capability |
| --- | --- | --- | --- | --- |
| Body default (existing) | `body` | `sam-3d-body-v1` | `body-v1` | `conversion` |
| Piano | `music` | `music-piano-v1` | `music-v2` | `music_piano` |
| Guitar | `music` | `music-guitar-v1` | `music-v2` | `music_guitar` |

The body route stays the default and keeps its current configuration and credentials. The server selects the route from subject, instrument and enabled capabilities; the client declares only the subject and instrument it displayed. Availability is reported per capability in the existing capabilities response, with an additive per-route status in the conversion limits response. An offline guitar worker must not report body conversion as unavailable.

Account-wide storage and active-conversion limits remain in force initially. The budget review must now include audio-bearing uploads, extracted audio, reference JSON, previews, temporary outputs and cleanup, before any quota is changed. Do not introduce silent quota increases or separate subject subscriptions.

### 3.6 Keep authorisation independent of subject

Use the same account/session, ownership, independent access reasons, group membership, accepted release pointer, and public-listing rules. A category filter is never an authorisation filter. Apply server checks to music references, preview media, waveform assets, optional MIDI exports, attempts, and paired displays.

Keep public-source media private by default. A virtual instrument animation can be public-safe when explicitly published. Public instructor audio/video needs a separate approved preview asset and permission policy; a public lesson does not automatically expose its original video or extracted audio. **[R2]** Private extracted audio, waveform data and derived audio assets receive the same protection as private source video, in storage, delivery, projection and cleanup.

## 4 User journeys and interface continuity

### 4.1 Instructor journey

| Existing step | Multi discipline behaviour | Change visible to the user |
| --- | --- | --- |
| Add video | Same entry point, with subject selection inside it | One compact choice: Dance, Taekwondo, Boxing, Piano, Guitar, or Full Body Movement |
| Choose and trim | Same file selection, timeline, title, and limits | Music preview can play sound; guitar has optional tuning/capo details with defaults |
| Create | Same upload action and progress card | Subject-appropriate action text; no model/provider choice |
| Preparing | Same queued, processing, ready, and failed card behaviour | Plain stages such as "Preparing lesson" and "Finding notes" |
| Check | Same review page, Back, trim controls, and "Looks good" action | Keyboard/note roll or guitar guide instead of a body model; correction tools appear when needed |
| Accept | Same owner review and acceptance lifecycle | Music confirms assessed passages and notes are reviewed |
| Share | Same people, links, groups, and public controls | Subject badge and supported preview options only |
| Adjust | Same entry back to editing | Notes/chords become an additional editor tab; advanced work remains optional Studio content |

Subject must be known before local clip preparation because music requires audio retention. Movement remains the default during the compatibility rollout. Do not silently reuse a last-selected music type for an unconfirmed movement upload. Changing subject before submission invalidates any incompatible prepared clip, explains that preparation must restart, and preserves the original selection for rebuilding.

**[R2] Preparation provenance.** Music always uploads the standalone prepared clip, starting at zero, and that clip is authoritative. Conversion creation may carry optional client-reported preparation metadata: the original selection start and end, a preparation version, and prepared-file identifiers. These are provenance for diagnostics and re-editing. They are not verified source timestamps, and no scoring or synchronisation depends on them. Prepared-file identity is the server-computed checksum of the uploaded clip. The original file is never uploaded as a fallback.

Preserve mobile completion for selection, trim, correction of a few events, acceptance, and sharing. Dense piano-roll editing may be optimised for desktop Studio, but a phone user must be able to fix or exclude a problem passage and finish a simple lesson.

### 4.2 Learner journey

The default library includes all accessible subjects. Keep the existing All, My practices, Shared with me, and Public audience filters. Add a separate optional subject filter; selecting Piano does not replace or reset the ownership filter. Search and pagination honour both. Mixed-subject group collections use the existing cards.

Opening a lesson uses the current preview destination and Back behaviour. Display the same familiar practice entry. Video sound remains an explicit playback action. No permission prompt appears until the learner chooses live feedback or its input.

At practice entry, adapt the setup content in the same panel location:

| Lesson | Setup | Main reference | Feedback |
| --- | --- | --- | --- |
| Dance, taekwondo, boxing, full body | Current camera and height flow | Current avatar/real instructor choices | Current movement comparison |
| Piano with MIDI | Select/connect keyboard and play a test note | Instructor video plus animated keyboard | Played notes and attack timing; releases/pedal where supported |
| Piano with microphone | Select mic and play a short sound check | Same piano layout | Confidence-aware feedback for supported exercises |
| Guitar | Select mic and confirm tuning/capo | Instructor video plus chord/fretboard guide | Supported notes/chords and attack timing |
| Any lesson without live input | Watch or practise without feedback | Same reference controls | No score; practice remains available |

Use the existing play/pause, repeat, section navigation, speed, and settings positions. The reference stage becomes an instrument guide; a music feedback strip occupies the existing feedback region. Hide irrelevant controls such as height calibration and body observation angles in music. Introduce watch-then-play and own-pace choices inside practice settings, not as separate apps or global navigation destinations.

Keep movement's real/3D choices intact. Music may use "Instructor", "Guide", and "Both" in the corresponding selector. With a single stage, switching view must preserve time and practice settings. Provide a compact layout on portrait phones, side-by-side where space allows, and user-controlled focus between video and guide.

**[R2] Controller.** Music runs on its own controller. It implements the same user-facing controls and lifecycle concepts, the same four speed presets (0.25×, 0.5×, 0.75×, 1×), and the same count-in, repeat, section and attempt behaviour. It owns a continuous audio clock, input alignment, and reset semantics. It is not a modification of body `Playback` or `PracticeSession`, and it does not require body components to narrow a union. Arbitrary tempo and continuous tempo adjustment are out of the first release.

Own-pace is a separate alignment mode, not another saved playback speed. Switching modes resets pending alignment and does not overwrite body practice preferences.

### 4.3 Preferences and progress

Keep accessibility, account, and navigation preferences shared. Scope camera/height preferences to body, MIDI/mic choices to music input/device, guitar tuning to lesson/instrument, and tempo/range to lesson revision. Changing subjects must not copy movement calibration or stale scoring state into music. Preserve the existing body preference keys until a compatible migration is proven.

One history screen can show all subjects, but results display the rubric and evidence mode. Resume remains per account and lesson/revision. Lesson updates show the existing recoverable update flow; do not silently apply old note progress to a changed reference.

**[R2]** Body progress keeps its current endpoint and literal constraints. Music resume and mode preferences use additive versioned fields or a dedicated settings record. Music attempts never write into the movement allowance or the pose-typed endpoint.

## 5 Phases and dependency map

Phases are release gates, not dates. Each can contain several small changes. Reader compatibility, regression protection, and licence evidence precede user rollout. Instrument inference research must not delay the shared app or the MIDI path.

| Phase | Outcome | Depends on | Exposure |
| --- | --- | --- | --- |
| 0 | Baseline, workflow contracts, commercial artifact policy, audio-preparation qualification | None | Documentation, spikes and internal checks |
| 1 | Contracts, runtime readers, capability and route responses, compatibility behaviour, host boundary | 0 | Flags off |
| 2 | Shared discovery, summary migration and experience dispatch | 1 | Internal cohort |
| 3 | Audio-preserving music upload and isolated jobs | 1, P0.8 | Internal instructors |
| 4 | Reference contracts, fixtures, and piano guide | 1, 2 | Synthetic/internal lessons |
| 5 | Music drafting, review, acceptance, and sharing | 3, 4 | Internal instructors |
| 6 | Piano MIDI practice and event assessment | 4; 5 for uploaded lessons | Closed learner pilot |
| 7 | Microphone model licensing and qualification | 0; 4, 6 for integration | Lab only until qualified |
| 8 | Beginner guitar lessons and practice | 5, 7 | Separate closed pilot |
| 9 | Unified history, safe recording, and shared displays | 5, 6; 8 where applicable | Cohort rollout |
| 10 | Full qualification and staged commercial rollout | 6, 9; 7/8 by capability | Instrument-specific release |
| 11 | Advanced technique, notation, and hand animation | Qualified core product | Separate later scope |

Phase 2 and phase 3 can progress independently after phase 1. Phase 4 can use approved fixtures while phase 3 is being built. Phase 7 licensing and measurement can begin early, but no unresolved model is released to learners. Piano MIDI can ship before acoustic piano or guitar. Phase 9 core history support is required before commercial release; optional recording/display expansions can remain unavailable per capability.

## 6 Phase 0 Establish the baseline and delivery controls

### Work

- P0.1 Record current behaviour for upload, local trim, conversion, check/accept, preview, sharing, mixed access reasons, practice, Compete, recording, and paired displays. Include desktop, portrait phone, and landscape layouts.
- P0.2 Run the existing relevant API, engine, interface, build, and workflow verification suites. Record failures already present instead of attributing them to music work. Existing documentation leaves real-device and hosted-service qualification open; do not claim these have passed.
- P0.3 Accept the domain decisions above and write a screen-level continuity checklist. Keep internal "lesson" terminology separate from any gradual change to user-facing "move" labels.
- P0.4 Create a commercial artifact inventory template: code/weight/runtime source, version, hash, licence, notices, distribution mode, reviewer, and decision. Only approved entries can appear in a production worker/browser model allowlist.
- P0.5 Start with official Basic Pitch. Transkun remains a comparison candidate under the qualified bundled-MIT interpretation; use Basic Pitch if explicit checkpoint-specific clearance is required. Keep the unresolved candidates identified in the licensing review out of production.
- P0.6 Select consented test material: simple piano melody, simultaneous notes, repeated notes, silence, pedal, beginner guitar notes, chords, and intentional mistakes. Use authorised MIDI/recordings, not an unreviewed public dataset for commercial evaluation. The Phase 2 fixture needs owned or licensed video and audio under the same rule.
- P0.7 Record operational budgets: body-worker capacity, API memory, upload/storage quotas, expected music duration, and test devices. Agree provisional thresholds before looking at final model results. Extend the budget to audio-bearing uploads, extracted audio, references, previews, temporary outputs, retention, and cleanup.
- P0.8 **[R2] Audio-preparation qualification spike.** Using the installed mediabunny version and the target browsers, verify the two candidate preparation paths on real material: MP4 with AVC/AAC, and WebM with VP8/Opus. For each path record whether the browser can encode it, whether the resulting file contains the expected audio and video streams, duration and A/V sync, playback behaviour, cancellation, size behaviour against the current limits, and whether the prepared file is stable enough to resume an upload. Test desktop Chrome/Edge/Firefox/Safari and Android Chrome and iPhone Safari where available.
  Record the outcome as a supported-path table, not a claim of universal support. If neither combination works acceptably on a target browser, define the explicit export/import recovery path and record the acceptance cost of that path. Broad rollout waits until that recovery experience is acceptable. Audio sidecars are deferred because they add synchronisation and resumable-upload complexity.
- P0.9 **[R2] Baseline reproducibility and isolation.** The checkout has uncommitted movement work (transparent instructor video and stage controls) touching the contracts, schema artifacts, conversion worker and practice workspace — the same files early music changes need. Establish a reproducible baseline with its owner: include that work in the agreed baseline, or isolate it on a separate branch/worktree, before Phase 1 slices that touch those files begin. Do not reset, discard, or commit another person's unfinished work to unblock this plan. Record which commit or working-tree state the baseline represents.
- P0.10 **[R2] Ratify the plan-level quality gates** in §16 against measured Phase 0 observations, including the per-capability reporting rule and the audio-preparation recovery path.

### Deliverables and exit gate

Baseline verification record, product-flow checklist, approved model starting point, fixture list, feature-flag design, audio-preparation supported-path table, and a recorded baseline state. Existing failures have explicit dispositions. No production flags enabled and no existing lessons rewritten. Documentation and read-only validation need no rollback beyond discarding new artifacts.

## 7 Phase 1 Add compatible contracts, shared metadata, and the host boundary

**[R2]** Phase 1 establishes contracts, validators, route and capability responses, compatibility behaviour and the host boundary. It does **not** migrate the library's state to summaries; that is Phase 2 application work. It does not paginate owned or shared lists. It does not create music lessons through a worker.

Phase 1 implementation starts only after P0.9 records a reproducible baseline.

### Slice 1A — Subject catalogue and additive lesson metadata

Additive migration after the current head (`0014_silhouette_capability.py` at the time of writing; re-verify at implementation time). Add subject, family and instrument metadata to mutable lesson records and to revision metadata, with the catalogue in §3.1 as the source of allowed values. Legacy records default to `movement_other`/`body` without rewriting stored manifests. Subject edits follow the existing release-projection rules. Extend `database_ready()` for every added table and column.

Acceptance: migration applies cleanly to a disposable PostgreSQL database containing legacy revisions, grants, group releases, worker credentials and an in-progress body conversion; existing API/engine tests pass unchanged; a legacy lesson lists as `movement_other` and renders "Full Body Movement"; an owner can set a specific movement subject; a contradictory subject/family pair is rejected; no stored v1 manifest changes; `database_ready()` fails if a new column or table is missing.

### Slice 1B — Schema artifacts, generation command, drift checks

Add `apps/api/export_lesson_schemas.py` (or an equivalently named module) that generates the three artifacts in §3.4, with `--check`. Keep the body artifact byte-identical. Add per-artifact drift tests and remove the single-model assertion they replace.

Acceptance: `python -m apps.api.export_lesson_schemas --check` passes on a clean tree and fails after any manual schema edit; the body artifact matches the current committed file byte-for-byte; all three drift tests fail independently when their artifact is edited; generation is deterministic across two runs and does not depend on dictionary ordering.

### Slice 1C — Music manifest v2 contract

Add the Pydantic music model and its TypeScript projection. It requires `schema_version: 2`, `experience_family: music`, instrument configuration, contiguous teaching sections covering the duration, reviewed-reference asset role, assessment policy and rubric reference. It carries no body coordinates, standing time, GLB animation, or landmarks. Unknown fields are rejected. Add Python, JSON Schema and TypeScript fixtures, including negative fixtures for: missing instrument, sparse sections, v1 fields present, and a v2 object offered to a v1 validator.

Acceptance: the positive fixture validates in Pydantic, against the generated JSON Schema, and in TypeScript; every negative fixture fails with a specific reason; the v1 validator rejects the v2 fixture; the v2 validator accepts the v1 fixture only through the normalising reader, never through the strict model; section contiguity is enforced.

### Slice 1D — Runtime readers and boundary parsers

Add `parseLessonManifest`, `parseMusicLessonManifest` and `parseLessonSummary` in `packages/lesson-schema`. They validate untrusted JSON and return typed values or structured errors. No new runtime dependency is added to the browser bundle without a licence review; hand-written validators alongside the existing section validators are the default.

Acceptance: each parser accepts its valid fixture and rejects malformed, extra-field and wrong-version input; a v2 payload passed to the body parser returns an `unsupported_format`-classified error rather than throwing an untyped exception; unit tests cover the mismatch cases; the bundle does not grow by a validation library.

### Slice 1E — Format negotiation, summary projection, capability and route responses

Add explicit negotiation with unversioned clients defaulting to v1. Keep existing body-shaped endpoints body-only. Add a new mixed-subject representation (for example `GET /api/lessons/summaries` and its shared counterpart) returning `LessonSummary` values filtered to the formats the client advertised. Add the route catalogue of §3.5 and report availability per capability in the capabilities and conversion-limits responses, additively.

Acceptance: a client sending no format header receives no music objects and no changed response shape; a client advertising v1 and v2 receives both through the new representation; a music deep link requested by a v1-only client returns a recoverable unsupported-format response with refresh guidance, not a body-shaped object and not an authorisation error; disabling the music route leaves body creation and availability true; disabling the body route does not claim music availability; existing clients' body behaviour is unchanged by contract test.

### Slice 1F — Music route registration and preparation provenance

Register the music route entries without enabling them. Add optional additive conversion-creation fields for subject, instrument and the client-reported preparation metadata in §4.1; the server derives pipeline and provider from the route catalogue and rejects contradictions. Body creation keeps its current required fields, default route and pipeline snapshot.

Acceptance: a body conversion created by an old client is byte-compatible in behaviour and reports the same pipeline; a body conversion created by a new client without a subject defaults to body; a music conversion with a disabled route is refused with a recoverable message and no job row; a contradictory subject/instrument pair is rejected; the job snapshot records the selected pipeline and provider; preparation metadata is stored, never trusted for timing.

### Slice 1G — Internal music fixture import

Allow an operator-controlled import of one music fixture lesson (video plus approved reference JSON) using the existing import path philosophy: no arbitrary HTTP-supplied paths, checksums verified before writes. The fixture is internal-only and is not publicly listable.

Acceptance: the fixture imports into a disposable database and opens through the existing lesson endpoints; its assets are served only to authorised accounts; the public projection excludes it; the body fixture import is unchanged; no worker, transcription model, or music dependency is required.

### Slice 1H — LessonExperienceHost before body controller initialisation

Introduce the host at the existing preview, check, practice, review and edit destinations, ahead of `LessonWorkspace`. Body lessons render the existing workspace with their unchanged `LessonManifest`. Music lessons go to a lazily loaded music module, which in this slice may render only a validated "not available for this client" state. Validation happens in the host.

Acceptance: movement layout, controls, timings and settings match the recorded Phase 0 baseline; `verify_practice_flow.py`, `verify_practice_preview.py`, `verify_practice_feed.py` and `verify_compete_flow.py` pass; a body lesson constructs exactly one body `Playback` and starts one progress saver, as before; opening a music fixture constructs no body `Playback`, starts no progress saver, and requests no camera, microphone or MIDI permission; a malformed payload produces the recoverable error screen.

### Slice 1I — Acceptance-shortcut guardrails

**[R2]** Close the two existing bypasses for music: `publish` currently records an acceptance through `ensure_release` when no acceptance exists, and `trim` with `accept` accepts directly. Neither may accept a music lesson without its reviewed-reference acceptance. Keep both shortcuts unchanged for body lessons.

Acceptance: publishing an unreviewed music fixture returns a conflict and leaves the release pointer unchanged; trimming a music fixture with accept succeeds only when the required music acceptance exists and otherwise returns a conflict without advancing the version; the same two operations on a body lesson behave exactly as today; tests cover both shortcuts and both outcomes.

### Validation and exit gate

Old fixtures deserialize and serialize without semantic changes. New fixtures validate in Python, JSON Schema, and TypeScript. Existing body jobs can be claimed and finished by the original worker. A v1-only client does not receive v2 unexpectedly. A body lesson journey is unchanged through the host. The music fixture opens without permissions. No production flag is enabled and no lesson is rewritten.

Deploy additive schema, dual-format readers, route responses and the host with music creation disabled. Rollback leaves additive columns and tables in place and disables the host's music dispatch. Do not drop columns or downgrade a live database to hide a feature.

## 8 Phase 2 Integrate discovery and shared navigation

**[R2]** Phase 2 is application work: migrate library and shared state to summaries, add subject discovery, and dispatch music.

- P2.1 Migrate the owned and shared library state from full manifests to `LessonSummary`, keeping cards, filters and resume behaviour. Owned and shared lists remain unpaginated, matching current behaviour; public listing keeps its existing pagination. Where pagination exists, filtering happens before it; do not add owned/shared pagination merely to satisfy this sentence.
- P2.2 Add subject badges and a secondary subject filter to existing cards and audience filtering. Preserve All as the default. Avoid renaming every movement label as part of this phase. A category filter never becomes an authorisation filter.
- P2.3 Extend owned, shared, group and public summary queries consistently. Group collections already return summary-shaped rows; add subject and family to that projection.
- P2.4 Dispatch music at the existing check, preview, practice and edit destinations through the host. Music modules stay lazy-loaded and have a recoverable loading and error screen.
- P2.5 Retain query-based deep links and current Back/refresh behaviour. Music invitations use existing sign-in and return-path handling. No `/piano-login` or independent guitar account state.
- P2.6 Add inert music fixture cards for internal accounts. Selecting a fixture previews the guide without requesting camera, microphone or MIDI.
- P2.7 Keep library/category selection separate from session settings. Leaving piano for boxing destroys the piano runtime and releases resources; returning restores appropriate lesson preferences only.
- P2.8 Add subject-aware capability messaging at the point of use. If live microphone feedback is unavailable, opening, watching and non-scored practice remain possible.
- P2.9 Keep initial library download close to baseline by lazy-loading Three.js music renderers, audio code, MIDI helpers and model assets. Avoid adding music downloads to body practice.

### Validation and exit gate

One account can navigate body and music fixture lessons, groups, preview and Back. Permission prompts occur only after explicit input setup. Existing movement layout and controls match the baseline. Empty, search and filter states distinguish no matching lessons from missing access and service failure. A mixed summary list renders every card without loading musical events or body assets.

Rollback disables music dispatch and visibility for the cohort. Body paths continue using existing components and routes. Do not delete music drafts or alter grants.

## 9 Phase 3 Build audio-preserving creation and isolated conversion

- P3.1 Put the subject selector before media preparation in `CreateLesson.tsx`. Keep current movement trim/transcode behaviour. Add a separate music preparation function rather than globally changing `prepareClip.ts` to retain audio.
- P3.2 **[R2]** Produce one standalone audio-bearing clip and treat it as the authoritative source, starting at zero. Use the preparation path qualified in P0.8. Verify encoder support, actual resulting audio presence, duration, channel layout, sample rate, timestamp origins, cancellation and size limits. Never silently fall back to uploading an untrimmed original.
- P3.3 Offer a recoverable alternate export path when browser preparation cannot preserve audio. Tell the user to export a selected audio-bearing clip or choose another supported file. Do not upload a silent clip and report successful transcription. Audio sidecars are out of scope; if a sidecar would be required, the export path is the answer.
- P3.4 Store lesson type, instrument settings, preparation version, client-reported selection provenance and prepared-file identity with resumable uploads. Resume must use the exact prepared artifact; stale caches from body clips must not satisfy music uploads.
- P3.5 Validate uploaded media server-side, including decodability and a usable audio track. Detect clipping and silence as quality findings; do not equate detectable sound with a valid music demonstration.
- P3.6 **[R2]** Add a dedicated music worker and environment with its own pinned dependencies, model cache, resource limits and completion contract. Select the completion contract from the leased job's pipeline; the body completion contract and its required files stay intact. No SAM body reconstruction, floor correction, body segmentation or avatar conversion runs for music.
- P3.7 **[R2]** Reuse leases, attempt tokens, cancellation, checksums, bounded retries and idempotent completion. Bind staged outputs to the job attempt and pipeline version. Register explicit asset roles per route for completion, storage, delivery, public projection and cleanup, rather than adding filenames to scattered body allowlists. A cancelled or expired worker cannot publish late results.
- P3.8 Decode a continuous audio timeline from the uploaded clip and record its mapping to the clip's video and measured offsets. Preserve source audio for demonstration and avoid repeated lossy conversion before transcription.
- P3.9 Reserve capacity independently. A music batch on the same GPU must not starve movement jobs; initially use a separate process/device window, CPU route where adequate, or a separate worker host with explicit scheduling. Keep account-wide storage and active-conversion limits; do not silently raise them.
- P3.10 Add source, extraction and model identity to diagnostics, with bounded retention. Source media remains private. Exclude raw media and personal audio from operational logs.
- P3.11 Generate a public-safe instrument poster or guide derivative as a separate approved asset. Never promote extracted private audio or source-frame thumbnails by default.

### Validation and exit gate

An instructor can upload, resume, cancel and process an audio-bearing piano clip through an isolated music job. Timestamp mapping agrees with known audio/video markers on the uploaded clip, and the recorded client provenance never overrides measured timing. Body uploads remain silent as before and claim/finish exactly as before. Restarted jobs do not duplicate lessons or assets. Unsupported input produces the existing failed-card/retry pattern with a music-appropriate explanation.

Rollback disables new music submissions and drains or cancels music jobs according to policy. Existing body workers never receive music jobs. Staged orphan outputs are cleaned by bounded, attempt-aware cleanup, not broad deletion.

## 10 Phase 4 Define reference events and render a piano guide

- P4.1 Create versioned music reference JSON. Required fields include stable event IDs, lesson-relative seconds, source-time mapping to the uploaded clip, instrument configuration, event provenance, review state and assessment policy.
- P4.2 Represent notes with sounding MIDI pitch, onset, optional key release, optional sounding end, velocity only when known, attack grouping, required/optional status, and teacher-approved alternatives. Unknown values remain unknown.
- P4.3 Keep continuous source timing and optional beat/tempo map separately. A note timeline is not automatically a score with meter, enharmonic spelling, hand allocation, or finger identity.
- P4.4 **[R2]** Define assessable spans separately from contiguous teaching sections. Teaching sections stay contiguous and cover the whole lesson; explanation and pauses remain inside them without becoming required silence exercises. Assessable spans may be sparse. Add explicit rests only when the instructor intends them to be assessed.
- P4.5 Define trim semantics: exclude notes outside the kept interval; preserve stable identity where possible; mark boundary-spanning notes so pre-existing sustain does not become a newly required attack at time zero. Rebase mappings consistently.
- P4.6 Build a piano guide driven entirely by approved events: key highlights, upcoming-note cues, optional falling notes, position cursor, and accessible note names. Separate pressed keys from pedal-held sound. Hand colours require reviewed hand annotations.
- P4.7 Match video, guide and toolbar layout to the existing practice shell. The renderer uses elapsed music time, not body-frame quantisation. Stop animation and release graphics resources on exit.
- P4.8 **[R2]** Add the separate music controller behind the music module: continuous audio clock, count-in, repeat, section boundaries, four speed presets, and reset on seek, loop, section change and input replacement. Preserve body `Playback`/`PracticeSession` behaviour and their tick semantics unchanged.
- P4.9 Create deterministic synthetic/MIDI fixtures for visual, timing and editor development. Label these as fixtures, not model-accuracy demonstrations.

### Validation and exit gate

A fixture lesson opens from the shared library and shows real or synthetic test video synchronised with animated keys. Seek, pause, section boundaries, repeated notes, speed and loops are deterministic at each of the four presets. No camera, MIDI or microphone is required to watch. Instrument assets do not load on body routes. Body playback behaviour is unchanged by the new controller.

Rollback hides the music module. The v1 reader and original body playback remain intact.

## 11 Phase 5 Draft and review real music lessons

- P5.1 Add a Basic Pitch adapter for uploaded playing passages. Preserve raw model outputs separately from normalised draft events and reviewed reference events. Pin model files and include notices in worker packaging.
- P5.2 Handle chunk context, overlap, edge notes, duplicate events, pitch bends and resampling offsets. Treat bends as expressive metadata or exclude affected exercises initially; do not turn every bend into a new semitone requirement.
- P5.3 Suggest likely playing spans using lightweight diagnostics. Instructor confirmation remains authoritative for speech, pauses, backing tracks and simultaneous explanation. Start with manual span selection if automatic segmentation is unreliable.
- P5.4 Offer optional MIDI import as a correction aid. Validate bounded file sizes and events, and align its timeline to video through teacher-confirmed anchors; do not assume both recordings start together. Manual notes/chords remain available when transcription fails.
- P5.5 Reuse the existing Check shell: video/guide toggle, trimming, warnings and acceptance. Add a simple note/chord list with inline pitch/time correction, delete/add, mark optional, and exclude passage actions. Keep advanced piano-roll editing inside an expanded editor or Studio.
- P5.6 Show low-confidence or ambiguous draft regions as review tasks. Do not create confidence probabilities when the model does not provide calibrated ones. Allow a teacher to approve corrected content regardless of model uncertainty.
- P5.7 Add draft save with optimistic concurrency based on revision ID. Saving corrections creates a new immutable reference and revision; repeated saves and network retries are idempotent. Preserve unsaved local edits through recoverable request failure.
- P5.8 Extend acceptance validation for music: all required assessment events must have a reviewed reference policy and valid timing/configuration. Demonstration-only spans may remain unscored. Acceptance refers to the exact reference hash and revision, and to the rubric.
- P5.9 **[R2]** Keep the movement publication contract, while the music path requires its additional review evidence before release. Neither the publish shortcut nor the trim-with-accept shortcut may accept unreviewed music. Extend the Phase 1 guardrails with real reference validation and keep the shortcut tests in the suite.
- P5.10 Reuse direct sharing, links, group releases and public listing. Publish the separate public-safe instrument poster/guide preview produced in Phase 3. Never promote extracted private audio or source-frame thumbnails by default. Private extracted audio follows private source-video rules in storage, delivery and cleanup.
- P5.11 Keep re-transcription as a new draft operation. Model upgrades do not rewrite the shared release. Show the instructor changed events before they accept or publish an update.

### Validation and exit gate

One real piano video can be uploaded, transcribed, corrected, accepted, privately shared, opened by another account and previewed without exposing private source media to public-only viewers. A recipient continues following the accepted release while the owner edits a newer draft. Concurrent edits, stale acceptance, malformed events, trim boundary cases, and direct/group/public permission combinations are covered. Both acceptance shortcuts are proven closed for music and unchanged for movement.

Rollback disables new music authoring and publication. Keep existing approved music readable by compatible clients where safe. Do not move published pointers back automatically or invalidate body acceptances.

## 12 Phase 6 Deliver piano MIDI practice

- P6.1 Add a keyboard setup panel at the existing practice-start location. Feature-detect Web MIDI, request permission on explicit action, select an input, and verify a played note. Keyboard connection is never required to watch.
- P6.2 Normalise note-on, note-off, velocity-zero note-on, sustain controller, all-notes-off, repeated same-pitch attacks, channel/device identity and disconnect. Support the selected keyboard only; unrelated MIDI devices must not contribute notes.
- P6.3 Define input selection and channel policies for split keyboards and layers. Preserve notes already held at setup or start separately from scored attacks. Handle hanging notes without a false perfect result.
- P6.4 **[R2]** Add fixed-tempo alignment on the music controller: count-in, source-to-practice time mapping, the four speed presets, chord attack spread, input-delay calibration and bounded early/late matching. Each observed attack can satisfy at most one required event.
- P6.5 **[R2]** Add own-pace mode using bounded online sequence alignment. It is an alignment mode, not a saved playback speed. Permit recovery after omitted or repeated notes while preventing an unrelated later note from satisfying arbitrarily distant events. Own pace assesses content and sequence; fixed-tempo rhythm remains separately labelled.
- P6.6 Define event statuses: pending, matched, wrong pitch, missed, extra, optional, and unassessable. Missed requires an expired matching window and usable observation coverage. Input loss must not produce a stream of missed-note penalties.
- P6.7 Keep pitch/content, timing, release/duration and coverage as separate dimensions. Sustain processing does not turn pedal-held notes into fresh key attacks. No fingering or wrist claim comes from MIDI alone.
- P6.8 Use the audio clock for metronome and synthesis scheduling and map monotonic MIDI capture times into it. Record both capture and delivery time for latency diagnostics. Reset pending alignment on seeks, loops, input replacement and tempo changes.
- P6.9 Add familiar cues in the feedback strip and a detailed phrase result in the existing review position. Use text and icons as well as colour. A synthesis or tone fallback must have licensed assets; simple oscillator previews avoid unlicensed sample packs.
- P6.10 Preserve controls and body feedback behaviour. If a shared component is extracted, run its movement regression checks in the same change. Stop MIDI listeners and sound on exit, logout, and background interruption.
- P6.11 **[R2]** Add music attempt persistence through a separate versioned contract and storage path, leaving the pose attempt endpoint and `pose-v1` validation intact. The initial limit is 5,000 completed music attempts per account across piano and guitar, separate from the movement allowance. Count completed attempt records, not note events; bound stored event detail; keep practice usable when history saving reaches its limit. Phase 9 adds the shared history presentation.

### Validation and exit gate

Known MIDI fixtures produce deterministic event matches for single notes, chords, repeated notes, pedal and intentional errors, at each of the four speed presets. One learner can switch from taekwondo practice to piano MIDI practice and back without losing body preferences or leaving device streams active. Missing MIDI support offers watch and non-scored practice and a clear future microphone path. Movement history limits and payloads are unchanged.

Run a closed pilot with real keyboards, authorised reference videos and deliberate mistakes. Assess input latency separately from model accuracy because this phase does not use microphone inference. Rollback disables MIDI feedback while keeping approved lessons watchable and body feedback unchanged.

## 13 Phase 7 Qualify browser microphone feedback

- P7.1 Resolve the complete commercial licence trail for the chosen detector's code, trained weights, converted artifacts and vendored runtime. PitchPlease is a candidate under review, not the production default. If unresolved, choose another documented-commercial detector or narrow the capability; no silent exception.
- P7.2 Build a detector adapter that exposes supported pitch ranges, polyphony, event and active-frame outputs, model identity, load state, timestamp semantics, and meaningful confidence and health indicators.
- P7.3 Capture microphone audio after a user gesture with tested music-oriented settings. Inspect whether devices honour requested suppression and gain settings. Provide sound-level and clipping checks, and permission and disconnect recovery in the familiar setup panel.
- P7.4 Keep inference off the main interface thread where the implementation permits; profile AudioWorklet and Worker load with video and guide animation active. Load models on demand and cache only approved versioned artifacts.
- P7.5 Convert active-note frames to events with validated hysteresis and attack detection. Repeated articulation of the same note must not disappear into one sustained note. Harmonics and decay must not become automatic extra-note accusations.
- P7.6 Preserve wrong-note detection. Reference expectations can help alignment, but do not restrict the detector to expected pitches and then claim the learner played correctly.
- P7.7 Compare the same piano performance's microphone observations to synchronised MIDI or human annotations. An offline transcription model is a comparator, not ground truth. Stratify by note range, chords, pedal, repeated notes, tempo, room and device.
- P7.8 Use watch-then-play as the initial microphone mode to reduce instructor audio leakage. For simultaneous play-along, recommend headphones and validate metronome and backing leakage. Generic echo cancellation alone is not a demonstrated solution.
- P7.9 Define supported exercises per model and device. Begin with controlled single notes and small simultaneous-note sets if necessary. Unknown or overloaded input causes reduced coverage or unscored feedback, not a confident zero or a fabricated pass.
- P7.10 Measure full capture-to-feedback latency, temporal localisation error, false corrections, coverage, memory, startup cost, sustained compute and thermal degradation. Headless desktop tests do not qualify physical phones.

### Validation and exit gate

Only release the exercise and device combinations that pass the agreed accuracy and responsiveness gates. Support is advertised per capability rather than "all piano/guitar works". If the gate fails, piano MIDI remains releasable and microphone practice remains watch or non-scored. Rollback switches off microphone assessment without stopping lesson viewing or other input modes.

## 14 Phase 8 Add beginner guitar authoring and practice

- P8.1 Start with standard six-string tuning, clean acoustic/electric single-note exercises and a bounded beginner chord set. Record capo, handedness, tuning and reference concert pitches explicitly. Defer distortion-heavy material and expressive techniques until validated.
- P8.2 Reuse the same video/audio upload, draft worker, Check shell, acceptance and sharing. Basic Pitch provides pitch and attack proposals. A teacher supplies or confirms chord labels and guitar shapes.
- P8.3 Define guitar shapes with explicit low-to-high or numbered string order, muted/open/fretted states, sounding pitch mapping and capo-relative fret convention. Document one canonical internal ordering and convert at display boundaries.
- P8.4 Build a procedural fretboard and chord guide in the existing reference stage. Support left-handed display without incorrectly reversing note identities, string order or source-video interpretation.
- P8.5 Render chord changes, expected attack windows, melody positions and an optional tab cursor. Show one reviewed playable position; do not claim audio recovered the instructor's actual hand.
- P8.6 Reuse the microphone adapter with guitar-specific qualification and decoding. Distinguish a chord-class exercise from exact note/voicing assessment. Audio evidence for a chord does not establish that every string sounded or was muted correctly.
- P8.7 Handle arpeggios and strums as different attack policies. Allow a bounded attack spread for strummed chords instead of requiring all notes at one instant. Do not infer upstroke or downstroke from pitch alone.
- P8.8 Provide a tuner or setup cue and confidence warnings for wrong tuning or background sound. Teacher-approved alternatives determine accepted chord voicings.
- P8.9 Evaluate Guitar-Transcription's MIT-licensed weights only as optional draft-position assistance. Keep its failure and correction burden separate from Basic Pitch pitch accuracy. Do not make the lesson lifecycle depend on experimental tab inference.
- P8.10 Run the same mixed-subject navigation, access, revision and device-cleanup checks as piano. Guitar settings must not modify the learner's piano or body configuration. Guitar gets its own route, capability key and kill switch.

### Validation and exit gate

A beginner guitar lesson moves through the same creation and learner lifecycle as piano. The guide displays reviewed shapes correctly, and a held-out test set includes incorrect chords, partial chords, harmonics, alternate valid voicings, arpeggios and room noise. Unsupported feedback dimensions remain unavailable.

Rollback disables guitar scoring or creation independently from piano and body. Approved guitar videos and guides remain watchable when the release policy permits.

## 15 Phase 9 Unify results and complete optional session capabilities

- P9.1 Introduce a shared history projection over existing pose attempts and new music attempts. Do not change old pose payloads to fit music. Include subject, lesson/revision, rubric version, evidence mode, completion or interruption reason, assessed coverage, and nullable dimension results. The projection combines both types without changing their underlying scoring contracts.
- P9.2 Keep a stable attempt ID for idempotent retries. Validate that account access, reference revision, rubric, event span and input mode agree. A browser-submitted score remains a client report, not a trusted competition result.
- P9.3 Preserve resume through the existing progress mechanism where compatible. Store new mode and range preferences in additive versioned fields or a dedicated settings record; do not put invalid new values into old literal-constrained fields.
- P9.4 Show subject-appropriate summaries in a common visual layout: movement match for body; note, chord and timing results for music. Avoid a cross-subject rank or average. Expose skipped and unassessable events alongside accuracy.
- P9.5 Integrate music recording only after explicit design and permission checks. Existing movement takes are video-only. Using a microphone for detection is not consent to save or export audio. Music recording must clearly name what is recorded, preserve bounds, and use the same review/save/discard pattern.
- P9.6 Prevent accidental instructor or backing-track recording. Document the audio mix for any export. If this work is deferred, hide or disable music recording with an explanation while preserving movement recording.
- P9.7 Adapt the paired display protocol through explicit capabilities and version negotiation. Keep learner input and scoring on its authoritative device and send timestamped presentation state. Measure clock drift; reconnect without creating duplicate attempts. Do not broadcast private audio without a separate explicit feature.
- P9.8 Show the same practice mode entry conventions for music. Enable Compete only when a music-specific full-run rubric and reliable input are available. Preserve current body Compete. An unavailable music challenge displays its reason and a Practice action rather than entering camera calibration.
- P9.9 Music full-run challenge, when enabled, fixes mode, tempo, reference and rubric, starts at zero, invalidates on incompatible input or transport changes, and uses event coverage. No recording begins automatically. Treat it as personal practice, not a cross-subject leaderboard.
- P9.10 Audit local caches, preferences and pending drafts on logout and account switch. A second account on the same browser must not inherit private music assets, unsaved references or device-session listeners.

### Validation and exit gate

History and resume work for all enabled subjects with one account. Older attempts remain readable. Account isolation, revoked access, publish updates, failed persistence, local take limits and explicit export are verified. Unsupported optional capabilities degrade deliberately without disturbing body features.

Rollback disables new optional capabilities independently and retains historical records. Core music history remains available to compatible clients; no downgrade rewrites pose attempts.

## 16 Phase 10 Qualify and roll out commercially

### Release sequence

1. Deploy additive schema, compatible readers, route responses and diagnostics with all creation flags off.
2. Enable internal music fixtures, then internal music creation and review.
3. Enable piano MIDI for a small closed learner cohort.
4. Enable acoustic piano only for detector, device and exercise combinations that pass phase 7.
5. Enable beginner guitar for its own qualified cohort and reference set.
6. Expand by subject and input capability. Keep separate kill switches for creation, transcription adapters, MIDI, microphone, guitar tab suggestions, recording and challenge modes.

Turning off creation does not automatically remove access to published lessons. Use distinct flags for stopping new jobs, stopping live assessment, and disabling unsafe or unreadable artifacts. Access-control revocation remains governed by normal permission rules. A disabled route is reported as unavailable through its own capability key and never through the body key.

### Required checks

- P10.1 Full existing body regression suites and source-media workflow smoke run. No unacknowledged movement workflow changes.
- P10.2 Real PostgreSQL upgrade and compatibility verification, plus object-storage checks including range requests, checksum validation, signed access, public withdrawal, and stale private URLs.
- P10.3 One-account, multi-subject browser journeys, including login return, invite acceptance, mixed groups, filter and search pagination, preview, practice, Back, refresh and revoked access.
- P10.4 Physical-device testing on supported desktop browsers, Android Chrome and iPhone Safari; MIDI availability is detected rather than assumed. Include permission denial, audio routing, Bluetooth where supported, backgrounding and thermal load.
- P10.5 Accessible controls, visible focus, keyboard-only MIDI and device setup, large text, colour-independent feedback, reduced-motion option, portrait and landscape layouts, and meaningful screen-reader event summaries.
- P10.6 Media and capability failures: missing audio, corrupt upload, worker restart, dropped lease, failed model download, model hash mismatch, no MIDI, noisy microphone, stalled video, unsupported codec, storage pressure and input disconnect.
- P10.7 Release inventory contains exact commercially usable models, runtime and dependency licences, and shipped notices. Unresolved models are absent from production images and browser assets, not merely hidden in the interface.
- P10.8 Verify music resource isolation: queue pressure, model cache, disk limits, retries, and GPU/CPU load do not starve body conversion or API traffic.
- P10.9 Rehearse flag rollback, job drain, compatible application rollback and retained-data recovery in staging. Avoid destructive database downgrade as an operational rollback mechanism.
- P10.10 Record teacher editing time per minute, learner false-correction reports, preparation completion, assessment coverage, queue latency and job cost. Use those observations to prioritise later phases.

### Proposed initial quality gates

These are planning targets to ratify in Phase 0 (P0.10), not measured product claims. Quality is reported by subject, input, exercise complexity and device, with sample counts and confidence intervals where useful.

| Area | Initial gate |
| --- | --- |
| Legacy compatibility | Existing supported body journeys pass; v1 data and processing semantics remain intact |
| MIDI evaluation | Deterministic fixtures match exactly; real-input timing checked separately |
| Reference synchronisation | Absolute A/V/guide error within 50 ms over representative five-minute clips, after offset correction; clock drift and codec delay reported separately |
| Live response | Target p95 capture-to-feedback below 250 ms for supported exercises on qualified devices; otherwise narrow support or show delayed feedback explicitly |
| Microphone trust | Fewer than 5% false corrections on assessable correct events, with at least 80% required-event coverage on the agreed held-out set; both metrics must pass |
| Authoring quality | Teacher-approved reference passes event validation; editing burden measured and an acceptable product target agreed before broad release |
| Permission safety | Private source video, audio, references and attempts never leak through public or unrelated-account routes |
| Account continuity | One account can move among all enabled subjects without losing access, calibration isolation or session cleanup |
| Commercial artifact coverage | Every shipped model and runtime has documented commercial terms, exact identity and required notices |
| Audio preparation | At least one qualified preparation path on each target browser, or an accepted export/import recovery path; no silent audio loss |

Low correction rates obtained by abstaining on almost every event do not pass. Overall average accuracy cannot hide an unsupported chord class or a failing device. A polished synthetic demo is not a substitute for held-out real-performance testing.

### Rollback policy

Prefer disabling the failing music capability while preserving watch and guide access. Stop unsafe jobs from being claimed and prevent late workers from completing. Maintain a compatible reader build after any v2 lesson has been published; rolling the application all the way back to a v1-only build is not a valid full rollback. Retain new rows and assets for recovery unless the normal deletion or retention process requires removal.

## 17 Phase 11 Later capabilities with separate validation

The following do not block the first commercial music release:

- Acoustic piano with larger polyphony, sustained pedal, expressive timing and advanced repertoire beyond the qualified initial set.
- Automatic guitar string/fret inference, bends and slides, alternate tunings, strum direction and complex voicings.
- Camera-based hand landmarks and calibrated key/fret geometry. Add explicit visibility and uncertainty policies; likely fingertip position is not proof of pressure or contact.
- Teacher-approved fingering suggestions and procedural hand animation. Label illustrative fingering separately from recovered instructor motion.
- Notation engraving, MusicXML and Guitar Pro import/export, richer meter and tempo editing, and accessible sheet music.
- Curricula and structured progression across lessons. Keep these as an organisational layer over existing lessons and access, not a second account system.
- Future body-specific rubrics for dance, taekwondo and boxing. Validate independently from the generic pose similarity already present.
- Arbitrary tempo control, continuous tempo adjustment and audio sidecars.

Each requires its own licence check, test set, product scope and exit gate. Do not bundle them into the initial pipeline milestone or market them as an implication of note recognition.

## 18 Data contracts and server boundaries

### 18.1 Proposed records

| Record | Contents | Compatibility rule |
| --- | --- | --- |
| Lesson metadata | Subject, family and instrument, with release-aware projection | Existing ownership and published pointer remain authoritative |
| Subject catalogue | Subject ID, display label, family, default instrument | Server-owned; no second client table; `movement_other` maps to Full Body Movement |
| Route catalogue | Route ID, subject/family, pipeline, provider and target settings, asset roles, completion contract, capability key | Configuration, not lesson data; body route is the default |
| Music manifest v2 | Shared identity and sections, instrument config, approved reference asset, assessment capability and rubric | V1 body shape stays unchanged |
| Music draft | Raw proposal identity, editable events, reviewed spans, base revision, model provenance | Owner-scoped; never served through public projection |
| Reviewed reference asset | Versioned events, source mapping, review and rubric identity, hash | Immutable; acceptance and publishing bind the exact revision |
| Music attempt | Account, lesson/revision, input mode, matcher/rubric/detector versions, bounded event results or summary, coverage, timestamps | Separate from strict pose-v1 input and from the movement allowance; common history projection |
| Music session preferences | Versioned own-pace or fixed-tempo mode, input choice, applicable lesson settings | No body calibration values; device references are best-effort local hints |
| Artifact approval inventory | Exact models and runtimes, commercial terms, hashes, notices, distribution mode | Production workers and browser builds use an allowlist |

Per-event storage must be bounded. Begin with compact summaries plus a capped event result list when useful; raw microphone audio is not a required database input. Set retention and event-size limits before release. Do not silently add a new global history quota different from the current product without a migration and product decision. Music attempts have their own explicit 5,000-attempt allowance, counted as completed attempts; movement's existing allowance is unchanged.

### 18.2 API additions and adaptations

Reuse existing authentication, library, conversion, acceptance, publishing, grants, groups and source-asset authorisation endpoints. Proposed additions fit under the same `/api` application:

- A mixed-subject summary representation for new clients, with the existing body-shaped list endpoints unchanged.
- Explicit supported-format negotiation; unversioned clients default to v1; a music deep link requested by a v1-only client returns a structured unsupported-format response with refresh guidance.
- Subject and instrument configuration in new conversion creation, plus optional client-reported preparation provenance; the server selects the processing route.
- Owner-only music draft retrieval and save with `base_revision_id` and bounded typed input.
- A music-reference finalisation operation that creates a revision and validates assessed spans.
- A seconds-based music trim operation; do not reinterpret the current frame-based body trim payload.
- A versioned music attempt endpoint and a shared history projection. Preserve the existing pose attempt endpoint during compatibility.
- Typed asset enumeration by role for reference JSON, private source audio and video, waveform data, optional MIDI, approved preview and approved public poster. No arbitrary filesystem or object-key access.
- Additive per-route availability in the capabilities and conversion-limits responses; keep the existing `processing` object valid.

Exact route names should follow existing conventions during Phase 1 rather than introducing a second API service. Keep CSRF, account status checks, revocation, quotas and error conventions consistent. Validate client-submitted results structurally; do not present them as authoritative anti-cheat evidence.

## 19 Repository implementation map

Paths identify likely touchpoints, not files already changed by this plan.

| Area | Existing locations | Proposed additions or changes |
| --- | --- | --- |
| Navigation and library | `apps/web/src/LibraryApp.tsx`, `PracticeFeed.tsx`, `FeedCard.tsx`, `Groups.tsx`, `Public.tsx` | Summary state migration in Phase 2, subject filters, deep-link compatibility |
| Experience host | `apps/web/src/LessonWorkspace.tsx`, `LibraryApp.tsx` | New `LessonExperienceHost` before `Playback` construction and progress persistence |
| Creation | `apps/web/src/CreateLesson.tsx`, `prepareClip.ts`, `clipCache.ts` | Subject choice; new music-only preparation module and cache identity; preparation provenance |
| Review | `apps/web/src/MoveCheck.tsx`, `SectionEditor.tsx`, `Studio.tsx` | Shared review shell with lazy music correction tools; body review remains intact |
| Preview/practice | `PracticePreview.tsx`, `PracticeWorkspace.tsx`, `PracticePanel.tsx`, `PracticeTimeline.tsx` | Thin host and stable control reuse; new `apps/web/src/music/` workspace, controller, setup and renderers |
| Shared lifecycle | `packages/learning-engine/` | Narrow adapter interfaces; body `Playback`/`PracticeSession` unchanged |
| Music engine | new `packages/music-engine/` | Clock, events, alignment, rubrics; tests discovered explicitly by the web test script |
| Contracts | `apps/api/contracts.py`, `packages/lesson-schema/` | V1 preservation, v2 model, summary model, boundary parsers, three schema artifacts |
| Schema tooling | new `apps/api/export_lesson_schemas.py`, `tests/api/test_schema_artifacts.py` | Reproducible generation with `--check`; per-artifact drift tests |
| Conversion | `apps/api/conversions.py`, `processing.py`, `provider_adapters.py` | Route catalogue, family-specific completion contracts, per-route assets and availability |
| Workers | `scripts/saas_worker.py`, `scripts/instructor_pipeline.py` | Leave body behaviour; add `scripts/music_worker.py` and an isolated locked environment |
| Access and releases | `apps/api/permissions.py`, `lessons.py`, `workflow.py`, `sharing.py`, `public.py`, `groups.py` | Music projection and asset roles, strict music acceptance, group summary subject |
| Persistence | `apps/api/database.py`, `apps/api/migrations/versions/` | Additive metadata, drafts, music attempts; extend `database_ready()` for every new table and column |
| Attempts | `apps/api/mimic_attempts.py`, browser API helpers | Preserve pose-v1; add typed music attempts and a shared history projection |
| Display/recording | `MimicReceiver.tsx`, pairing and session helpers, `usePracticeRecording.ts` | Versioned music capabilities; explicit music recording only when implemented |
| Test discovery | `apps/web/package.json` | Add explicit music-engine test path alongside `tests/engine` |
| Operations | Existing configuration, Docker and hosting scripts, model preparation | Separate music worker image, flags, licence notices, resource budgets, retention |

## 20 Verification strategy

Use deterministic fixtures for contract and controller correctness, then real annotated recordings for model claims. Do not write tests that merely repeat implementation logic.

| Layer | Required evidence |
| --- | --- |
| Contract | V1 snapshots and fixtures; v2 validation; Python, TypeScript and JSON Schema parity; bounded events; invalid spans; summary and boundary union fixtures |
| Schema artifacts | Per-artifact drift test; byte-identical body artifact; deterministic generation; `--check` failure on manual edit |
| Database | PostgreSQL upgrade with legacy data, compatibility defaults, immutable revision and release behaviour, `database_ready()` coverage for new tables and columns |
| API | Ownership, direct/group/public combinations, draft secrecy, media asset access, stale revision, idempotent jobs and results, format negotiation, per-route availability |
| Acceptance shortcuts | Publish and trim-with-accept reject unreviewed music and behave unchanged for body lessons |
| Audio worker | Sample and time mapping on the uploaded clip, silent or corrupt media, chunk edges, cancellation, lease expiry, retry cleanup, codec variants from P0.8 |
| Music engine | One-to-one attack matching, missing and extra, chord spread, pedal, own pace, count-in, speed, loop reset, input loss, four speed presets |
| User flow | Same-account cross-subject creation, invitations, library, preview, setup, practice, review, history, Back and refresh; body lesson immediately after a music fixture |
| Movement regression | Current upload, check, share, practice, Compete, record and paired-display behaviour against the Phase 0 baseline |
| Model qualification | Held-out ground truth, intentional mistakes, uncertainty coverage, per-device latency, editing burden |
| Device and accessibility | Physical devices, keyboard navigation, large text, reduced motion, audio permission and routing, cleanup |
| Licence and build | Approved artifact hashes and notices; unresolved models absent from release outputs |

Run the current repository test commands appropriate to changed areas, including API and engine tests, `npm.cmd --prefix apps/web test`, and the production build. Existing `scripts/verify_practice_flow.py`, `verify_practice_preview.py`, `verify_practice_feed.py` and `verify_compete_flow.py` are useful body workflow checks. Infrastructure tests require the actual local PostgreSQL and storage setup described in `docs/saas-development.md`; synthetic fixtures and SQLite are not substitutes for those gates.

Each phase and each Phase 1 slice produces a verification note stating what ran, device and browser versions, fixtures, outcomes, unresolved failures and enabled flags. A slice is complete only when its acceptance checks are evidenced.

## 21 Operational controls and unresolved dependencies

Use server-side flags for music reads, creation by subject, each pipeline, each live input, optional recording and challenges. A flag hides unavailable entry points, but backend authorisation and routing also enforce it. Check flags again when creating or claiming work so a cached page cannot bypass a disabled pipeline. Report availability per capability; never collapse route availability into one boolean.

Track pipeline job duration, retries and failures, queue age, model version, output sizes, reference correction time, setup completion, input loss, assessment coverage and reported false corrections. Keep raw recordings out of telemetry. Set per-job resource, time and output caps, and clean up expired staged artifacts without deleting published references.

Key dependencies to resolve during the phases are exact live-detector commercial permissions, target phone and browser support, authoring correction burden, public-preview media rights, and resource capacity. These are controlled gates. They do not require redesigning the shared account or delaying a qualified MIDI-only piano release.

Calendar and staffing estimates should be set after the Phase 0 baseline, the audio-preparation spike and initial worker and browser spikes. Plan work in vertical slices: compatible readers; fixture lesson; real uploaded reviewed lesson; MIDI feedback; qualified microphone feedback; beginner guitar; unified release. Avoid committing to an all-instruments launch date before the uncertain inference paths have evidence.

## 22 First implementation milestone

Complete Phase 0 and the Phase 1 slices, then deliver a single internal piano fixture through the existing library, preview and practice destinations. The same account must open an existing movement lesson immediately afterwards with its behaviour and settings preserved.

The next milestone replaces the fixture with an uploaded audio-bearing piano video, reviewed Basic Pitch notes and MIDI feedback. Broader acoustic recognition and guitar follow only after that complete instructor-to-learner path is reliable.

The intended final product is one learning platform with several subjects. The parts that vary are the generated reference, practice setup, instrument or body presentation, and evidence-based assessment; users retain the same recognizable journey throughout.

## 23 Remaining blockers

| ID | Blocker | Blocks | Resolution owner |
| --- | --- | --- | --- |
| B1 | Baseline is not reproducible: uncommitted instructor-alpha work touches `contracts.py`, `conversions.py`, `lessons.py`, the schema artifacts, the worker, and the practice workspace | Every Phase 1 slice except 1D's new parser files; any music change in those files | Owner of the in-flight work, with this plan's author |
| B2 | Audio-preparation matrix unverified: browser encoding of MP4 AVC/AAC and WebM VP8/Opus on the installed mediabunny and target devices | Phase 3 start; the recovery-path decision | P0.8 spike |
| B3 | Music fixture media rights not recorded: the Phase 1 fixture needs owned or licensed video and audio | Slice 1G content | Product and legal review |
| B4 | Music attempt event bound and retention not agreed | Phase 6 persistence and the shared history projection | P0.7 budget review |
| B5 | Public preview rights for instructor audio and video unresolved | Phase 5 public derivative and Phase 10 rollout | Commercial review |
| B6 | Commercial licence trail for the selected transcription and detector artifacts not yet inventoried with hashes and notices | Phase 5 transcription and Phase 7 microphone | P0.4 inventory |
| B7 | Physical-device MIDI qualification not started, including iPhone Safari availability | Phase 6 closed pilot | Phase 6 pilot plan |
| B8 | Per-route storage and cleanup budget for audio-bearing uploads, extracted audio, references, previews and temporary outputs not sized | Phase 3 and Phase 9 rollout | P0.7 budget review |

No Phase 1 detail is blocked by the music model decisions; those gate later phases. B1 is the only blocker that prevents starting Phase 1 slices, and Phase 0 documentation plus the B2 spike can proceed while it is resolved.

## 24 Deferred decisions

These are deliberately out of the first release and require their own scope, evidence and gate:

- Owned and shared list pagination.
- Arbitrary or continuous tempo control beyond the four presets.
- Sparse teaching-section models for music.
- Audio sidecars as a preparation path.
- Microphone-based guitar assessment beyond the qualified subset.
- Music recording, export and paired-display audio.
- Curricula, notation import and export, and hand animation.
