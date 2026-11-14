# Piano correction workspace — Phase 5 acceptance

Reviewed: 14 November 2026.
Accepted submission: `97f6af5` (`phase5/persistence-recovery`).
Decision: **GO — Phase 5 accepted. Proceed with Phase 6 only.**

## Acceptance basis

The previously blocking client/server payload, ownership validation, saved-reference loading, recovery identity, stale-audio and editable-map findings are closed for this phase. The latest changes compare recovery base revisions and retain stale work for explicit recovery; valid anchors authored in a different order serialize canonically and satisfy the real server validator.

The controlled-route Chromium script now actually exercises saved-only revision saving, with the saved base id and no draft identity, as well as reopened-map apply/undo/redo/removal. Its committed report also covers delayed success/failure with newer edits, reload recovery, spelling versus pitch preview validity and invalidated-preview reopening. Browser tests are a valid substitute for the removed unreliable jsdom component scenarios; duplicate coverage in that format is not required.

## Independent verification and limits

- Original cross-language/actual-harness reviewer diagnostic: **7/7 passed**.
- Saved-reference lifecycle diagnostic: **4/4 passed**.
- Recovery-base and canonical-anchor diagnostic: **2/2 passed**.
- TypeScript `tsc --noEmit`: **passed**.
- Reviewed the code diff, browser assertions, committed browser report and new persistence unit assertions.
- Browser script was not independently rerun. Its reported successful execution remains developer-supplied evidence reviewed against its assertions and result file.
- The **454-test web suite** and latest **14-test API suite** remain developer-reported, not newly independently confirmed. Earlier suite attempts were rejected by automatic approval review following an external Visual Studio telemetry request with an unverified payload. No bypass or new suite attempt was made in this acceptance review; the service-free diagnostics above ran successfully.
- An authenticated browser session was not used. The controlled workspace evidence, cross-language endpoint test and independent contract diagnostics are sufficient for this development-phase gate. This is not production or deployment qualification.
- No product implementation, service data, server process or authentication state changed during review. Only this acceptance record was added.

## Phase 6 authorisation

Implement **Complete visual editing interactions** from the existing phased plan and detailed specification. Keep the isolated workspace and the Phase 5 persistence/recovery protections.

Required scope:

- Roll selection, pitch drag, axis-locked onset movement, recorded-length resize, explicit snap and precise numeric alternatives.
- Individual sheet chord-note selection, staff pitch dragging, written-duration controls, accidentals and separate enharmonic respelling.
- Keyboard audition, active-occurrence selection and overlap candidates, explicit Replace pitch mode, confirm/cancel and Escape.
- Note insertion with a ghost preview, explicit time/pitch and insertion/cancellation; deletion, shortcuts and shared undo/redo.
- Clear selection/sounding/preview/scope feedback, collision rejection and voice-limit messaging. Keep unsupported tie operations unavailable unless their agreed lossless semantics are implemented and qualified.
- Touch editing handles with pan/edit separation and numeric alternatives.

Phase 6 acceptance must demonstrate:

- Every relevant section 6 journey in the detailed plan passes across the three connected views.
- One completed gesture creates one history transaction; cancellation or pointer loss restores the prior document and creates no accidental edit.
- Editing a chord member or linked occurrence changes exactly the intended target. Empty-key audition never edits an unrelated note.
- Written rhythm remains distinct from recorded duration; accidentals that change pitch remain distinct from respelling that preserves it.
- The resulting edits, including exact timing and authored spelling, save/reopen through the accepted Phase 5 pipeline. Include a saved/reopened correction on the long example.
- Submit reliable interaction tests and short recordings for the major editing journeys, together with regression evidence for save/recovery and shared playback.

Stop for review before Phase 7. This GO does not authorise normal review-page replacement, publication or deployment; those remain under their existing later-phase gates.
