# Phase 8 handoff — read-only formatted score

Branch `phase8/formatted-score`, based on Phase 7 baseline `97172c2`. Phase 8 development only; release/deployment and Phase 7 acceptance remain separate.

## Delivered

- `FormattedScore.tsx` renders a read-only formatted score directly from the **same working `NotationDocument`** used by correction mode. No second note dataset, no transcription pass and no mutation API.
- Layout derives wrapped systems and pages from the shared measures/segments; title, page numbers, grand-staff brace, treble/bass clefs, key/time context, measure numbers, note values, dotted values, accidentals, ledger lines and ties are drawn from the document. Ties crossing systems/pages render broken continuation stubs.
- Header **Formatted score / Return to correction** toggle keeps the harness mounted, so the selection and time window are preserved and preview switching neither mutates notes nor loses unsaved work.
- **MusicXML** export is available from both modes using the shared document (existing `toMusicXML`).
- Formatting covers the real 127-measure recording (9 pages, 41 systems, 218 ties continued across breaks).

## Evidence

- `scripts/check-formatted-score.py` — real recording:
  - corrected pitch `64→65`, written duration `480`, respell `E#4` on the same occurrence;
  - formatted view shows `data-pitch=65`, `data-spelling=E#4`, `data-formatted-value=quarter` and keeps the occurrence selected;
  - MusicXML contains `<step>E</step>`, `<alter>1</alter>`, `<type>quarter</type>`;
  - switching to formatted and back leaves the complete canonical document unchanged, restores the exact selection and the 0/10 s viewport;
  - saved private reference payload contains the same corrected pitch/spelling/duration;
  - 218 broken tie continuations at system/page breaks.
  - Raw result: `phase8-formatted.json`; captures: `captures/formatted-real-page1.png`, `captures/formatted-real-page2.png`.
- `apps/web/tests/formatted-score.test.tsx` (3 tests): every segment/measure placed exactly once (no dropped notes), long score spans multiple pages with all measures retained, rendering does not mutate the shared document, tied note draws a tie.
- Full web suite: **500 passed**; TypeScript and production build clean.
- Phase 7 regression set: all **16 scripts** pass on this branch, including normal route/library, verification/recovery, saved-clock, A7 and async.
- Saved-point eviction regression remains pass.

## Known limits / deviations

- **No PDF** is offered or claimed. MusicXML is the export format; label is accurate.
- The engraver is deliberately lightweight: it draws staff/notes/accidentals/ties/measure numbers but not beams, slurs beyond ties, dynamics, lyrics or performance marks. This is a readable final-score preview, not a full notation-engraving replacement.
- Saved/reopened agreement is demonstrated at the saved-reference payload level on the controlled server world. A full route-level save→saved-only-reopen cycle would require a server-backed revision fixture; the same `restoreFromReference`/document round-trip is covered by existing Phase 7 save tests.
- The 5,000-occurrence interactive restriction remains **inactive**. The Phase 7 carry-forward activation audit (piano-subject scoping, pre-existing over-limit edit, guitar retention) and owner approval remain outstanding.
- H1–H9 physical-device testing remains **HARDWARE BLOCKED**. No deployment or release approval is claimed.

## Phase 7 carry-forward status (unchanged)

| Item | Status |
| --- | --- |
| 5,000/512 restriction | Inactive; owner approval + pre-activation audit outstanding |
| H1–H9 physical touch | HARDWARE BLOCKED (NOT RUN) |
| Final acceptance / deployment | Not authorised |
| Phase 8 | Implemented for review on `phase8/formatted-score` |

## Review focus

1. Read-only formatted score from the shared document and preview-switch state preservation.
2. Corrected pitch/duration/spelling agreement across correction, formatted and MusicXML.
3. Ties/staff context at system and page breaks.
4. Accept or name corrections; release remains separate.
