# Piano hand estimates: baseline + midi2hands + consistent colours

## Goal and authorization

User wants the best musically plausible left/right assignment from the notes, NOT the actual visible pianist's hands. Implement both a lightweight musical baseline and real pretrained midi2hands inference, with explicit hybrid decision rules, editable assignment, and matching colours on waterfall and sounding keys. No video/hand tracking, training, retranscription, new audio/clock or unrelated redesign.

Checkpoint BEFORE this task: main=origin/main=91c7d1604d714af45a0d918e64c6dc7630e0ee60, clean. Preserve it and all existing functionality. New feature work stays uncommitted until requested; no push/deploy. DeepSeek implements source/tests, Codex reviews each phase. Four gated phases below; STOP after each handoff, next authorized by reviewer. Project D:\3d_trainer\developement; worker session82e56a90-cf22-4a9a-9a52-9e47c2475e46.

## Product and data semantics

- Each recorded PERFORMANCE occurrence has left/right/unassigned. Staff/clef is NOT hand; do not change notation staff or infer right solely from treble. Occurrence IDs are stable identity; repeated/same-pitch overlapping/tied attacks remain distinct.
- Store provenance: manual, baseline, midi2hands, hybrid consensus/fallback as appropriate; model/version and source fingerprint for automatic results. Optional nullable fields/versioned metadata maintain old documents/save/recovery/export compatibility. Keep transcriber note confidence separate from assignment reliability. No fabricated calibrated percentages. A small enum/reason such as clear/ambiguous/conflict is enough unless raw model scores are accurately labelled uncalibrated.
- Manual left/right/unassigned is an explicit locked override. Model refresh NEVER overwrites it, including manual unassigned. Undo/redo supports assignment changes. Reset-to-Auto explicitly removes override.
- Pending/missing/error model => useful baseline or unassigned, no blocked playback/editing. Existing lessons without metadata open normally. Cached estimates must match performance fingerprint (IDs,pitch,onset,duration; not playbackoffset/written-onlyspelling). New note/deleted note/edited pitch/time/duration invalidates automatic context; recompute baseline immediately; refresh model in debounced/batched bounded background, never every frame or keystroke. Written-only edits, selection, seek/rate/offset do not rerun hand inference. Manual choices persist.
- Inference outputs change metadata only, never note pitches/onsets/durations/velocity/IDs, audio, media position, notation grouping or source confidence. Save/reopen/local recovery preserves committed assignments. An in-flight old response cannot overwrite a newer document/revision or manual edit. Decide clearly whether pending automatic proposals are derived UI or authored changes: do not silently mark a saved lesson dirty just by opening. Persist applied automatic suggestions as part of next normal reviewed save, consistent with existing dirty/review gate. Document the precise approach.

## Hybrid rules (not just agreement = truth)

A model predicts binary label for each valid note; it may fail, omit, reorder, duplicate or produce low-quality/inapplicable output. Baseline may be ambiguous. Define deterministic, tested resolution:
1. Manual override wins.
2. Baseline+model agree => assigned, provenance consensus (still estimate, not verifiedtruth).
3. One missing/invalid: use other if usable, otherwise unassigned.
4. Baseline ambiguous/model valid: prefer model if no strong physical implausibility.
5. Model disagrees with a clear feasible baseline: assess limited documented continuity/span plausibility for both. Prefer clearly better candidate; otherwise model suggestion can be primary with conflict marker or unassigned if unresolved. Do NOT invent certainty or average categoricallabels; retain alternatives/reason for review.
6. Preserve all occurrences including notes beyondA0-C8; model-traineddomain21..108 => skip those safely and keep unassigned/heuristic reason, never clip musicalpitch.

Keep baseline readable, deterministic, and cheap. Use simultaneous/chord grouping with documented tolerance, reasonable overlapping-note span checks, previous/next hand continuity, low/high register as soft prior, ties/repeats stable. Sustained/sustain-inflated durations aren't always physical fingerhold; don't impose an absolute anatomical truth from them. No naive globalmiddleCsplit as sole rule, no hard guarantee that a specific span is impossible for every pianist. Explain ambiguous single lines/crossingpassages and give safeunknown. Cover scrambledinput sorting (stable id mapping), chords, arpeggios, overlap, samepitch, empty/single, extreme/invalid data.

## midi2hands integration requirements

Repository https://github.com/pianoviz/midi2hands; MIT reported. Actual ONNX file src/midi2hands/models/onnex/model.onnx ~252047bytes; runtime dependencies are much larger. Verify/pin exact source revision/artifact hash and package versions, retain required licence notices. Do not train or download datasets. Use CPU model in isolated optional worker environment, not browser mainthread/global Python env. Isolate NumPy1.26.4/onnxruntime/midiutils requirements if conflicts. No secret inspection. Prepare reproducible setup/verification commands and minimal optional requirements, avoid changing mandatory app runtime if possible.

IMPORTANT SOURCE QUIRK: GenerativeHandFormer.inference returns (original events,y_true,y_pred), does NOT apply y_pred to event.hand; CLI prints originalhand fields. Use returned predictions explicitly and verify index->ID mapping. Inspect actual pinnedsource/preprocessing and matching model dims/window, don't reimplement guessednormalization or falsely treat originalhand as inferred. Direct note-event adapter preferable to MIDI roundtrip (preserves timing, repeatedoccurrences, identity). Never hand fake defaultlabels as verifiedgroundtruth or let them leak into maskedmodelinputs. Confirm0=left1=right from interface. Model missing/unsupported runtime fails clearly; baselinefallback not a silent fake model success.

Measure real model startup/inference on controlled and existing transcribed longlesson (~1338events), record counts/runtime/memory if practical; no claimedqualityaccuracy without reference. Compare baseline/model agreement, disagreements/ambiguous/feasibility flags and latency; labels are agreement/plausibility, not accuracy. No need humanlabels for this user's scope. Cache CPU session and fingerprinted outputs, bounded event count/time/rate, avoid blocking server event loop or arbitrary filepaths; use existing auth/lesson scope patterns. No unrestricted model download API. Browser gets ID-labelled assignment results/provenance, not Pythonobject or modelweights.

## Colours and UX

- Left soft BLUE, right warm AMBER; unknown neutral grey-green. Same identity/palette on waterfallblocks and soundingkeys (both black/white). Atrest keys retain piano colours. Active notes stronger hand shade; selected note uses distinct dark/highcontrast outline/ring rather than painting everything selectionblue. Avoid conflict with old blue-selection semantics. Multiple activeoccurrences samepitch samehand stable; opposite/unknownmixedhand on onekey uses honest split/dual stripe or neutralmixedstate, not arbitraryfirstwins. Document rule and test.
- Tiny accessible Left/Right legend (Unknown only if useful), no large new toolbar. Colours notsoleidentification: selectededitor hand label, accessible key/block names/tooltips including hand; no per-frame screenreaderannouncements. Respect reducedmotion.
- Selectednote simpleeditor includes Hand Left/Right/Auto/Unassigned with clear manual/estimatedstatus. Keep friendly compactdefault: mobilepeek does not grow into aform, Editnote reveals controls. UsercanresettoAuto; unsure/conflictdetails inexistingTiming&more/Settings, not modalspam.
- Settings offers recompute/refresh and baseline/model status/version/unavailability explanation. Automatic initialbaseline works immediately. Model backgroundestimate once whenavailable, safe retries explicit iffails. No visible success ifmodelneverran. Optional model setup documented for deployment and actuallocalapp enabled before calling feature complete.
- Preserve full88desktop, mobileboundedpanA0-C8, Guide/Sheet/Place, selectedglyphvisibility, keyboardChoose/Replace/normal audition, Spaceguard, onevideo/clock,follow,save/recovery,staffalignment,normalviewportfit.

## Phase 1: canonical hand data + baseline + edit lifecycle

Inspectcontracts/save/edit/export/recovery before choosing minimum backwardcompatible schema. Implement deterministic baseline and resolver interfaces/provenance, explicit manualoverride commands, validation and lifecycle; APIs can remain notconnected untilphase3. Singlecanonicalbaseline code (browserTS pure or workerPython; documentchoice), avoid twodivergent implementations. Existingdocumentswithoutfields work. Focused meaningfultests baselineedgecases,manualpriority,serialization/save/recovery roundtrip,mutationinvalidation/undo. Typecheck; selected affectedchecks only. No modeldownloadneededphase1. Handoff.local/hands-phase-1-handoff.md + progress, STOPforreview.

## Phase 2: real pretrained adapter + comparison

Pinupstream+weightslicence/hash, isolated optionalruntime/setup, directNoteEvent adapter preserving IDs/order; realinferenceresult and honest fallback. Run actualinference if environmentpermits; if sandboxblocks installation/network/subprocess prepare exactcommands/artifacts forCodex to execute once ratherthan repeatedlyretrying. No substitute dummy output for realgate. CLI/script comparison emitsJSONreport pernote+summary agreement/runtime (notaccuracy), handles partial/malformedoutputs. Add narrowadapter/mapping/knownfailuretests, realCPU smoke onlonglesson andsmallchordfixture. Document modelavailability,rawscoresifany limitations,dependencyfootprint. Reuseexistingnoteevents no videoanalysis. Handoff.local/hands-phase-2-handoff.md, STOPforreview.

## Phase 3: bounded app integration + hybrid colours + correction UX

Connect adapter through suitable authenticatedbounded lesson/document operation using existingarchitecture, baselineimmediate/modelbackgroundsafe/fingerprinted. Hybridresolver exactrules/manualoverrideprotection, stale/cancel/racebehavior. Persistmetadata roundtrip correctly without changing oldnotedocuments or forcing saveonopen. Apply colours/legend/editorcontrols/Settingsstatus. Metadata must flow through real LiveKeyboard/Waterfall activation byoccurrence, notpitch-only map; avoid perframedocwork.

Tests targeted: responsemapping/stalegeneration/manualeditrace,modelunavailablefallback,save/reopen+undo,changingnotecontextrefresh/writtenonlynorefresh,mixedsamepitch,colourassignment/selectionmode. APIauth/limits andvalidation where endpointadded. Build/typecheck once coherent; reportenvironmentblockersonce. Handoffactualcounts/times/screenshotsavailable/localmodelstatus. STOPforreviewbeforephase4.

## Phase 4: integration verification, visual finish, docs

Review actual desktop1366x768/full88 andportrait360x740/390x844,compact740x390Guide/Sheet, rollopen/closed. Realpointerselectednote->manualhand->undo->resetAuto; modelresults/refresh; samepalettekey/block; mixedpitchstyle; modelunavailablebaseline; editsmodifyprojections andsavedroundtrip; noextradocumentoverflow/mediaremount/Spaceregression. Worker runs one final full maintainedJSsuite with10minbound, appropriate focusedPython/APIchecks (not entireunrelatedbackend suite), productionbuild once after coherentfeature. Do not rerun fullsuite aftercosmeticcorrections. Updateactualcontrolinventory and setup/behaviour docs, concise finalhandoff. Codex independentchecks meaningful browserflows+resultartifact and anyfailed/blockedchecks, thenfinalacceptance.

## Execution economy

HeavyworkbelongsDeepSeek. Maintain.local/hands-progress.md withphase,milestone,commandactualexit/time/blocker/nextaction; phasehandoffs distinguish actualpasses fromexpected. Use docs/frontend-test-workflow.md maintainedrunner selectedfiles; no repeatedbroadtests, skip/assertweakening, DOMobjectequalnull allocationtrap or massreformat. For permissionsmissing reportonce exactcommand; Codexwill executeauthorized dependencysetup/testing withappropriatepermissions. Allfourphases authorized inprinciple but eachstopsatgate untilnextmessage. No simultaneousworkers. Codexmonitorlogs roughlyevery10minutes ifstillrunning; no speculativeintervention or unnecessarynewanalysis. Modeltest/dependencysetup authorized bythis task withinproject; never touchglobalenvironment or commitmodelsecrets.
