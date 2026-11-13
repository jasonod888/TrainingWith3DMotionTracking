# Piano correction workspace — Phase 1 submission

Baseline audit and safe edit contracts.

| | |
| --- | --- |
| Prepared | 13 November 2026 |
| Phase | **1 — Baseline audit and safe edit contracts** |
| Code audited | `ef4dfb6` — *Checkpoint piano implementation and correction workspace plans* (branch `baseline/piano-correction-2026-11-13`) |
| Submission branch | `phase1/piano-workspace-audit`, created from `ef4dfb6`; this note and its evidence are the only additions |
| Product code changed | **None.** No page replacement, no library adoption, no production data mutation |
| Next phase | **Not started** (Phase 2 has not begun) |
| Review decision | NOT REVIEWED |

Authority for this submission: [`docs/piano-correction-workspace-phases.md`](../piano-correction-workspace-phases.md) (phase 1 scope and acceptance gate) and [`docs/piano-correction-workspace-developer-plan.md`](../piano-correction-workspace-developer-plan.md) (UX and musical behaviour).

---

## 1. What was done, against the Phase 1 acceptance gate

| Acceptance criterion | Result | Where |
| --- | --- | --- |
| Every existing editor surface and save boundary is identified accurately | Done — seven surfaces (three of them notation views), four write endpoints, one playback-settings endpoint | §4 |
| Demonstrate why selecting one C4 must use an occurrence ID | Done, with real-example measurements. Note: **the real example contains no C4 (0 occurrences)**; the demonstration uses its actual most-repeated pitches (A5 171×, A4 134×, A3 125×) and a fixture for C4 | §7 |
| Demonstrate why moving one chord member cannot reuse an event-wide command | Done — 89 of 180 real chord events contain members whose **recorded** onsets differ (max 92.8 ms) | §8 |
| Proposed data contracts preserve exact seconds separately from score ticks | Done — commands and document schema keep `performance.onset/duration` canonical; ticks are interpretation only | §9 |
| Existing test failures and real-example access limitations recorded honestly | Done — the example **is** reachable; one environment-only API test failure is recorded, not hidden | §5, §11 |
| No unresolved destructive operation is assumed safe for reuse | Done — 12 destructive/unsafe behaviours identified, 8 reproduced dynamically on the real draft with before/after counts, 4 established by code and data analysis | §6 |

The audit also produced four machine-checkable results that Phase 2 can build on directly:

1. The current notation builder's output for the real 1,338-note clip **passes the server's existing `validate_notation`** — the integrity contract is reusable, not hypothetical.
2. The same validator **rejects** a notation/performance pitch disagreement — so an occurrence edit that fails to update both sides will be caught at save time.
3. A single-BPM score↔seconds map has a **26 ms mean / 52 ms maximum residual** against this performance, in steps of 103 ms — the number Phase 4's alignment work has to beat or honestly label.
4. Building the full notation document for the real clip takes **45 ms**; ten sequential pitch edits cost **37 ms each**; the document serialises to **1.5 MB**.

---

## 2. Environment and access baseline

| Item | Value |
| --- | --- |
| Working tree | `D:\3d_trainer\developement` |
| Web dev server | `http://127.0.0.1:5173` (Vite, proxies `/api` → `127.0.0.1:8001`) |
| API server | `127.0.0.1:8001`, launched by `.local/piano-ui-test-runtime.py` (uid 23820) |
| Database | PostgreSQL in `form-saas-postgres-1`, database **`form_ui_test`** (not `form`) |
| Signed-in account | `owner@ui.test` (local UI-test account) |
| Browser used | Chromium 156 (Playwright), 1440×900 and 390×844 |

Two setup facts matter for later phases:

- The API process runs `apps.api.main:app` **from this working tree**, so code changes are live on 8001 without a restart; the frontend hot-reloads on 5173.
- The database is `form_ui_test`. The `.env` default (`form`) holds **no lessons at all**; querying the wrong database would have produced a false "example unavailable" result. The local launcher rewrites the database name; see `.local/piano-ui-test-runtime.py:12`.

---

## 3. Real-example baseline (209.6 s / 1,338 notes)

The example named in the brief **is accessible** and was audited directly — not via a fixture.

```
http://127.0.0.1:5173/?page=music-review&id=0df28929d427406cb86d9bb5e2dcd35b
```

Verified through the real API and the real session cookie (`scripts/check-real-draft.py`):

| Property | Value |
| --- | --- |
| Lesson | `0df28929d427406cb86d9bb5e2dcd35b` — “river flows_full version”, piano |
| Draft | `da6ad51626d4435187a51904e0440068`, status `draft` |
| Duration | **209.594 s** |
| Notes | **1,338** |
| Provenance | Basic Pitch 0.4.0 (ONNX), profile `5014a423…193c` |
| Source video | 18.4 MB, `…-source.mp4` |
| Notation present | **No** — no `notation` key, `notation_duration` null on every note |
| Alignment present | **No** — no alignment or anchor structure of any kind |
| Playback settings | `null` (no sync offset stored) |
| Working corrections | none (`working_document` is JSON `null`) |
| Passages | 1 playing span `0 → 209.594`; no pedal; no explanation span |

### 3.1 Measured shape of the performance

| Measurement | Value |
| --- | --- |
| First / last attack | 0.917 s / 207.697 s (1.41 s tail silence) |
| Distinct onsets | 974 |
| Same-onset groups | 285, largest **5** notes |
| Notes inside chords | 649 of 1,338 |
| Distinct pitches | 28 |
| Most repeated | A5 **171** (75 in chords), A4 **134** (53), A3 **125** (86) |
| Max repeats of one pitch in any 2 s window | 7 (A5) |
| Same-pitch, same-onset duplicates | 0 |
| Median gap between attacks | 0.197 s |
| Longest silence | 3.94 s (at 4.5 s) — no spoken explanation passage |
| Recorded length | min 0.083 s, median 0.424 s, max 5.774 s |
| **Middle C (60)** | **0 occurrences** |
| Density | 63.8 notes per 10 s |
| Events sorted by onset | yes |

### 3.2 The current review page, measured and captured

`scripts/capture-review.py`, `scripts/capture-forms.py` → `measurements.json`, `captures/`.

| Measurement | 1440×900 | 390×844 |
| --- | --- | --- |
| Note forms mounted | 50 per page, **27 pages** | 50 per page, 27 pages |
| Page height | **15,075 px** | **23,363 px** |
| Note form height | 253 px each | 253 px |
| Piano roll (whole clip) | 817 × 200 px | same |
| Roll scale | **3.9 px per second** | 3.9 px/s |
| Horizontal page overflow | none (1440 = 1440) | none (390 = 390) |
| `<video>` elements | 1 | 1 |
| Console errors | 0 | 0 |
| Time to note forms | 0.92 s | — |

The roll compresses the entire 209.6 s recording into 817 px. A 10-second editing window at a readable scale needs roughly 76 px/s — about **19–22× the current density**. Every one of the 1,338 notes is drawn as a 3–6 px mark (reproduced in `captures/review-desktop-1440x900.png`), and the 50-per-page form list occupies 12,650 px of vertical space per page.

Observation, recorded without conclusion: `GET /api/lessons/summaries` returned an empty list for this owner even though the draft is reachable by URL. The library route to this lesson was not explored — it is outside Phase 1 scope, but Phase 7's “enter from the normal library/review route” must not assume it exists for this fixture.

---

## 4. Existing surfaces and save boundaries

### 4.1 Editing surfaces

| Surface | File | What it currently is | Owns a video? | Selection | History |
| --- | --- | --- | --- | --- | --- |
| Draft review page | [`apps/web/src/music/MusicDraftReview.tsx`](../../apps/web/src/music/MusicDraftReview.tsx) | Full-page review: preview, video, audio mode, 50 note `<fieldset>`s per page, title/policy/sections, verification panel | Yes (single `<video>`) | verification finding only; **not shared with the forms** | none |
| Whole-clip preview | [`apps/web/src/music/DraftNotePreview.tsx`](../../apps/web/src/music/DraftNotePreview.tsx) | Fixed-aspect roll (760-unit viewBox) + keyboard strip driven by the parent's video clock (rAF while playing, media events while paused) | No — reads the parent's `sourceRef` | highlight ids from findings | none |
| Reviewed notation editor | [`apps/web/src/music/notation/NotationEditor.tsx`](../../apps/web/src/music/notation/NotationEditor.tsx) | Score (SVG) + roll + keyboard + inspector + duration/accidental/tie toolbars | **Yes** — its own `<video>` at :340-345 | one logical note, `note_id` | local `past`/`future` arrays of full documents, max 80 (:66-67, :128) |
| Sheet strip | [`apps/web/src/music/notation/SheetMusic.tsx`](../../apps/web/src/music/notation/SheetMusic.tsx) | One continuous SVG, fixed 300 px per measure, no playhead, no virtualisation | No | logical note id | — |
| Piano roll | [`apps/web/src/music/notation/PianoRoll.tsx`](../../apps/web/src/music/notation/PianoRoll.tsx) | Fixed 760 px viewBox; **whole clip in one viewport**; drag = move/resize/pitch | No | logical note id | — |
| Keyboard | [`apps/web/src/music/notation/KeyboardEditor.tsx`](../../apps/web/src/music/notation/KeyboardEditor.tsx) | 3-octave audition/edit keys, octave shift | No | by pitch only | — |
| Reviewed lesson host | [`apps/web/src/music/MusicLessonEditor.tsx`](../../apps/web/src/music/MusicLessonEditor.tsx) | Loads the reviewed reference, keeps a **duplicate** `notes` array beside the notation document (:86-91), saves a new revision | No (passes URL down) | — | — |

### 4.2 Save and persistence boundaries

| Boundary | Endpoint | Accepts notation? | Accepts alignment? | Idempotency |
| --- | --- | --- | --- | --- |
| Initial draft review | `POST /api/lessons/{id}/music-draft/review` — [`apps/api/music_review.py:66`](../../apps/api/music_review.py#L66) | **No** — `ReviewMusic` (:44-56) has no notation field; the reference document (:127-136) has no notation key | **No** | request SHA-256; identical retry returns the existing revision, different payload returns 409 |
| Reviewed revision save | `POST /api/lessons/{id}/music-revision` — [`apps/api/music_edit.py:45`](../../apps/api/music_edit.py#L45) | **Yes** — optional `notation`, validated (:94-98) | **No** | request SHA-256 per base revision |
| Playback / sync offset | `PATCH /api/lessons/{id}/music-draft/playback` — [`apps/api/lessons.py:375`](../../apps/api/lessons.py#L375) | n/a | n/a | revision counter, 409 on mismatch |
| Verification decisions | `POST …/verification-decision`, `…/corrections/rollback` | n/a | n/a | state token |

Two consequences follow directly:

- **Persistence gap:** a correction made in any notation surface has nowhere to go in the initial review. The reviewed path can store notation but has no alignment, and no UI currently sends one.
- **Contract asymmetry:** the reviewed reference stores notation inside the reference JSON; the draft review rebuilds the reference JSON from scratch, so adding notation there means extending `ReviewMusic`, not just the editor.

### 4.3 Validation already available on the server

[`apps/api/music_notation.py`](../../apps/api/music_notation.py) already enforces: version, subject, duration equality, ppq, tempo mode, contiguous equal-length measures, grid alignment, no same-voice overlap (:196-200), no repeated chord pitch, spelling↔pitch agreement, performance-id existence, and an **exact** performance/event match on onset, pitch, duration, velocity and optional (:42-77).

Verified against real data (`scripts/emit-notation.ts` + `scripts/validate-notation.py`):

```
events=1338 notation_events=1146 duration=209.594
ACCEPTED: the current builder output satisfies validate_notation
REFUSED after one pitch edit: A notation performance pitch does not match the reviewed event.
```

The validator is therefore a usable integrity net for Phase 5 **today**; its limit is that it validates notation against submitted events, and both can be wrong together if a command mutates both identically.

---

## 5. Test baseline

### 5.1 Web

```
cd apps/web
npm test
```

`tsx --test` over `tests/engine`, `tests/music-engine`, `apps/web/tests/*.test.mjs|tsx`:

| Result | Value |
| --- | --- |
| Tests | **339** |
| Pass | **339** |
| Fail | **0** |
| Duration | 6.5 s |

Notable coverage for this work: `tests/music-engine/notation.test.ts` (build, pitch, duration, ties, staff move, round-trip, MusicXML), `apps/web/tests/notation-editor.test.tsx` (render, chord selection, undo/redo, add/delete, phone tabs), `piano-playback.test.tsx`, `piano-source-player.test.tsx`, `verification.test.tsx`.

**Nothing covers**: scroll/viewport behaviour, zoom, linked scrolling, playhead geometry, pointer cancellation, drag thresholds, save payloads containing notation or alignment, or persistence round-trips through the API.

### 5.2 API

```
.\.venv-saas\Scripts\python.exe -m pytest tests/api -q
```

| Result | Value |
| --- | --- |
| Passed | **836** |
| Failed | **1** |
| Skipped | **2** |
| Duration | 7 m 29 s |

The single failure is an **environment dependency, not a code defect**:

```
tests/api/test_piano_expression.py::test_audio_identity_is_measured_and_mismatches_rejected
ModuleNotFoundError: No module named 'soundfile'
```

`soundfile` 0.14.0 exists in `.venv-music` but not in `.venv-saas` (the only environment that also has FastAPI). Re-running the identical test with `.venv-music` site-packages on `PYTHONPATH` passes:

```
1 passed in 2.11s
```

Targeted review/notation/revision suite:

```
pytest tests/api/test_music_review.py tests/api/test_music_edit.py tests/api/test_music_contract.py \
       tests/api/test_music_playback_settings.py tests/api/test_music_draft_handoff.py -q
→ 24 passed in 36.25s
```

Logs: `logs/pytest-api-venv-saas.log`, `logs/pytest-music-subset.log`.

### 5.3 What these tests do not prove

The suite proves the commands do what they were written to do. It does **not** prove they are safe: `tests/music-engine/notation.test.ts:58-75` explicitly asserts that lengthening one note **deletes** a neighbouring note and its performance event. That is the current intended behaviour, and Phase 2 must change the test alongside the behaviour (see §10, fixture F4).

---

## 6. Findings — destructive and unsafe paths, reproduced on the real draft

All figures come from `scripts/audit-destructive.ts` against the 1,338-note draft (`logs/destructive-audit.log`). The script rebuilds notation, preserves the original document, and measures before/after.

| # | Operation | Reproduced behaviour on the real clip | Severity | Location |
| --- | --- | --- | --- | --- |
| D1 | Written-duration change on one note | Lengthening one note from 600→1,560 ticks **deleted 4 sounding notes** (1,338→1,334 performance notes); the affected event and its performance links are gone, not muted | Critical | `packages/music-notation/edit.ts:80-104` (`removeOverlap`) via `:244-254` |
| D2 | Move one note in the roll / “Performance start” field | Moves the **whole event** (all chord members, up to 4 in this clip's notation) and rewrites every linked `performance.onset` from ticks×tempo — exact seconds are replaced by a tempo approximation | Critical | `edit.ts:226-241`, called from `NotationEditor.tsx:447-449` and `PianoRoll.tsx:90-93` |
| D3 | 10 ms free-time nudge with Snap off | Request 0.9272 s stored as 0.9310 s: the editor passes only 16th-note ticks, so a 10 ms adjustment is **rounded away** entirely | Critical | `NotationEditor.tsx:447-449`, `PianoRoll.tsx:92` |
| D4 | Tie | Absorbs the second attack (deletes its performance note) and overwrites the first note's recorded length with the summed **written** length in tempo seconds (0.9404 s → 1.0345 s). `untieLast` does **not** restore the absorbed note | Critical | `edit.ts:380-399`, `:402-414` |
| D5 | Add note over an existing note | Silent replacement: the target occurrence is deleted and the new note takes its place; total count unchanged, no warning | High | `edit.ts:157-199` + `removeOverlap` |
| D6 | Build: same pitch, same onset | Two occurrences collapse to one logical note linked only to the first (`performance_ids: ["a"]`); the second stays in `performance` but is **unmapped and unselectable**. 0 such pairs exist in the real clip today, but nothing prevents them | High | `build.ts:160-167` |
| D7 | Build: more than two overlapping voices | Third voice merges same-onset groups into a chord or **truncates the previous event's duration** (`previous.duration = max(GRID, start - previous.start)`) with no report | High | `build.ts:89-120` |
| D8 | No-op commands | `respellAccidental(natural)` and `changeStaff(same)` return a **new object** without changing anything → spurious dirty flag and history entry | Medium | `edit.ts:120-143`, `:257-281` |
| D9 | Generated-rest deletion | Generated rests have no event id, so the destructive delete path is unreachable today; but selecting a generated rest and pressing Delete **inserts an explicit rest** instead of doing nothing | Low | `edit.ts:311-326`, `NotationEditor.tsx:268-274` |
| D10 | Every edit rebuilds the entire score | `refreshNotation` regenerates all 2,335 segments, 740 ties and 592 generated rests, and all derived ids, on every command | Medium (cost + identity) | `build.ts:229-383` |
| D11 | Multi-occurrence logical note | Pitch/velocity/length commands apply to **every** linked performance id (`flatMap(note.performance_ids)`) with no split or rejection path | High (latent) | `edit.ts:55-57`, `:416-446` |
| D12 | Reviewed editor vs sync offset | `MusicLessonEditor` passes no offset to `NotationEditor`; the roll draws raw performance onsets while the playhead is video time, so any non-zero offset misplaces every note relative to the playhead | High | `MusicLessonEditor.tsx:157-158`, `PianoRoll.tsx:113-136` |

Supporting cost measurements for later phases:

| Measurement | Value |
| --- | --- |
| Notation build, 1,338 notes | 45 ms |
| Ten sequential pitch edits | 371 ms total, **37 ms each** |
| Serialised notation document | 1.5 MB |
| 80-entry snapshot history, implied | **≈120 MB** |

The last figure matters: the editor's undo model stores whole structured clones, and the clip is 1.5 MB per snapshot. Phase 2's “single history” cannot inherit that design unchanged.

---

## 7. Why a single occurrence needs its own id (not pitch, not index)

Three selectors are available today; only one is valid.

| Selector | Why it fails |
| --- | --- |
| Pitch alone | A5 occurs **171 times** in this clip (75 inside chords); up to **7 A5 attacks fall inside one 2 s window**. Selecting “the A5 at 84 s” would be ambiguous. |
| Pitch + time window | Still ambiguous at 7-per-2 s density, and any tolerance window that fixes it also selects the neighbouring A5 in a repeated-note passage. |
| Array index / event id | Broken by insert/delete/move: `PianoRoll` maps index→note per render, and event ids are derived from staff/voice/start (`build.ts:122-125`), so any rhythmic edit re-keys them. |

The model already has exactly the right handle: the performance occurrence id (`bp-1` … `bp-1338`). It is unique, stable across edits, and preserved through save. What is missing is that the editor selects `note_id` (a logical note) and mutates through it, and that the review page selects by array index (`MusicDraftReview.tsx:127-128`).

Two honest caveats for the reviewer:

- The brief's example (“selecting one C4”) does not occur in this recording: **MIDI 60 appears 0 times**. The behavioural requirement is unaffected; the fixture must supply the C4 case, and the real-example case must use A5/A4/A3.
- Occurrence identity is not the same as logical-note identity. A logical note may eventually map several occurrences (the model permits `performance_ids: string[]`). The contract in §9 therefore keeps **both** and makes the scope of every command explicit rather than collapsing them.

---

## 8. Why a chord member cannot reuse an event-wide command

A `NotationEvent` is a **notational** container: notes that share staff, voice, quantised start and quantised written duration (`build.ts:70-87`). It is not an occurrence group. On the real clip:

| Measurement | Value |
| --- | --- |
| Chord events (≥2 notes) | 180 |
| Chord events whose members have **different recorded onsets** | **89 (49%)** |
| Largest recorded-onset spread inside one event | **92.8 ms** (`ev-treble-1-75000-235-bp-390`) |
| Median spread | 11.6 ms |
| Chord events whose members have different recorded durations | **172 (96%)** |

Therefore:

- `moveEvent(event, start)` — the only onset command the roll exposes — rewrites the recorded onset of every chord member to the same tick. For half the chords it destroys a stagger that the performer actually played, and it substitutes tempo-derived seconds for exact ones (D2).
- `changeDuration(event, ticks)` changes every member's written length and can delete the neighbours behind them (D1).
- Pitch edits are already per-note (`changePitch`), which is the one safe axis in the current command set.

This is the required conclusion of the Phase 1 gate, and it is also the reason the current `notation.test.ts` “overwrites the same voice” assertion has to change rather than be preserved.

---

## 9. Proposed contracts (Phase 2 implementation targets)

### 9.1 Identity and invariants

| Object | Identity | Invariant |
| --- | --- | --- |
| Performance occurrence | `performance.id` (unchanged, `bp-*` / `authored-*`) | Unique, ≤80 chars, immutable for the document's life, never derived from pitch or position |
| Logical note | `NotationNote.id` | Unique, stable; **not** derived from position; may map 1..n occurrences |
| Notation event | `NotationEvent.id` | Stable; must not embed start/voice once movable (today it does, `build.ts:122-125`) |
| Segment / segment note | derived | **Never** selected or persisted as identity; regenerated freely |
| Selection | `{occurrence_id, logical_note_id?, scope}` | A session value, not a document field; survives unrelated edits; cleared when its targets disappear |

Rules the server must be able to check:

- every occurrence maps to exactly one logical note (`performance_map` total and injective-on-notes);
- no logical note without at least one occurrence;
- no dangling `performance_ids`, in either direction;
- chord pitch uniqueness within an event (already enforced);
- at most two voices per staff (already enforced).

Migration note: existing saved documents use `n-${performance.id}` and `ev-${staff}-${voice}-${start}-${index}-${first}`. Both remain valid; the contract adds that new ids must not be position-derived, and that a derived id may never be re-derived after an edit.

### 9.2 Time: seconds are canonical, ticks are interpretation

| Quantity | Unit | Canonical? | Rule |
| --- | --- | --- | --- |
| `performance.onset`, `performance.duration` | seconds (float) | **Yes** | Exact. Never recomputed from ticks. Never snapped implicitly. |
| `notation.events[].start/duration`, `segments` | ticks (ppq 480, grid 120) | No | Written interpretation. Never used to derive performance seconds. |
| `playback.sync_offset_seconds` | seconds, [−10, +10] | Yes, playback setting | Applied once at one boundary. Not part of notation. |
| Display/playhead | seconds | No | `effective = stored + offset`, clamped to `[0, duration]` for display only |

Bounds and failure rules:

- `0 ≤ stored_onset`; `stored_onset + recorded_duration ≤ duration`; reject, do not clamp silently.
- Written: `ticks % 120 === 0`, `duration ≥ 120`, `start + duration ≤ last measure end`.
- A drag that would leave `[0, duration]` clamps the **drag preview** and commits the clamped value; it never writes outside the bounds.
- Offset editing does not touch note fields; note editing does not touch the offset (already true, `lessons.py:388-393`).

The 10 ms requirement is implemented by carrying a float `seconds` through the command and the drag, with snapping applied only when the user has selected a snap value — never inside the editor's tick conversion as it is today (D3).

### 9.3 Alignment: a versioned monotonic map

The document has no alignment today. Proposed addition:

```ts
type AlignmentAnchor = { id: string; source_seconds: number; tick: number };

type Alignment = {
  alignment_version: 1;
  mode: 'estimated' | 'anchored';
  basis: 'tempo' | 'anchors';
  anchors: AlignmentAnchor[];       // sorted, strictly increasing on both axes
};
```

- `notation_version` becomes `2`; a v1 document is read as `{mode:'estimated', basis:'tempo', anchors:[]}` and is labelled *estimated*. Nothing in `performance` changes on migration.
- Mapping is piecewise linear between anchors; outside the anchor range the map **holds** at the boundary value rather than extrapolating (honest behaviour for explanation passages).
- Inverse: `secondsToTick` and `tickToSeconds` are monotonic and mutual inverses within one tick; clicking a note seeks to its **occurrence onset**, never to a tempo approximation; clicking empty space inverts the map, or offers the nearest passage boundary.
- Anchors cannot reverse time or score order (`source_seconds` and `tick` must both increase). Duplicate ticks for chord members are grouped into one anchor; per-note deviation is derived at render time, never stored as an anchor.
- Estimated state is displayed as “Score alignment estimated” with an explicit alignment action.

Scope note for the reviewer: on this clip a constant-tempo map is already within **26 ms mean / 52 ms max** because the builder snaps every onset to a 103 ms grid. That does not make the map correct — it makes it a **step function** with 103 ms steps, while the engraved score has fixed spacing. Phase 4 must interpolate between anchors, not re-derive per note, and must label the result honestly.

### 9.4 Command contracts

Every command: `(document, args) → Result<document', error>`; validates before mutating; returns the **same object identity** on no-op or failure; commits at most one history entry; resets review confirmation; flags dirty only on a committed change.

**Occurrence scope (default for sound and timing)**

| Command | Arguments | Validation | Failure |
| --- | --- | --- | --- |
| `SetPerformancePitch` | occurrence_id, pitch, optional spelling | 0..127; linked performance ids consistent | keep spelling rules: default spelling from key, explicit accidental preserved |
| `SetPerformanceOnset` | occurrence_id, seconds, snap? | bounds; snap applied only if requested | reject at bounds; never silently shift global offset |
| `SetPerformanceDuration` | occurrence_id, seconds | > 0; onset + seconds ≤ duration | reject |
| `SetVelocity` | occurrence_id, velocity | 0..1 | reject |

**Written/score scope (written rhythm, spelling, voices)**

| Command | Arguments | Validation | Failure |
| --- | --- | --- | --- |
| `SetWrittenDuration` | target, ticks, scope: `event` \| `logical-note`, overlap: `reject` \| `replace` | grid; `replace` performs today's destructive behaviour **explicitly and as one undo step** | `WrittenOverlap{neighbours}` leaves document unchanged |
| `MoveWrittenStart` | event_id, ticks | grid; no overlap | reject |
| `ApplyAccidental` | logical_note_id, sharp \| flat \| natural | spelling must exist for that pitch | reject with explanation |
| `Respell` | logical_note_id, target spelling | enharmonic-equivalent pitch | reject; changes notation only |
| `InsertNote` | pitch, seconds, duration, staff?, voice?, written | duplicate check; overlap policy as above | `AmbiguousTarget` / `DuplicateOccurrence` |
| `DeleteOccurrence` | occurrence_id | — | clears selection; removes only that occurrence and its notation link |
| `DeleteLogicalNote` | logical_note_id, `include_tied_segments` | — | — |
| `SetAlignmentAnchor` / `RemoveAlignmentAnchor` | seconds, tick / id | monotonicity, duplicates | reject, document intact |

**Scope and split rules (the part that must not be skipped)**

- When a logical note maps several occurrences and an occurrence-scoped edit would make them diverge, **split** the logical note (new id, same event) or split the event into an available voice; if neither is representable, reject with `MultiOccurrenceScope` and leave the document untouched.
- When a written change needs a third voice, reject with `NeedsThirdVoice` (wording from the plan: “This change needs another voice”) and leave the document untouched. Never overwrite neighbours to make room.
- Tied segments are always derived. Removing one segment independently requires an explicit `SplitTie` command that does not exist yet; until then the inspector states “Entire tied note”.

**Explicitly forbidden in Phase 2**

- any command that deletes or truncates a *different* occurrence as a side effect;
- any command that computes performance seconds from ticks;
- selection changes that mark the document dirty or enter undo history.

### 9.5 Persistence contract changes (Phase 5, specified now)

- `ReviewMusic` gains optional `notation` (document v2, including alignment), validated by the existing `validate_notation` plus a new `validate_alignment`; the reference JSON gains the same key.
- `EditMusic` already accepts `notation`; it gains alignment validation and must carry the existing notation forward when an older client omits it (today it would silently drop it).
- Both keep: request-hash idempotency, verification state token, ownership, source hash, single finalisation.
- Audio invalidation keeps comparing **performance events only** (`music_preview.py:7-12`), so spelling/alignment-only edits do not invalidate rendered piano audio.
- Legacy v1 references without notation open normally (already the case for the reviewed editor via `createNotation`), and must now also load with alignment marked `estimated`.

---

## 10. Fixtures and reproducible checks required before Phase 2 is accepted

| Id | Fixture / check | Proves |
| --- | --- | --- |
| F1 | Two notes, same pitch and onset | No occurrence is silently unmapped (D6) |
| F2 | Arpeggiated chord, 90 ms spread (mirrors `ev-treble-1-75000-235-bp-390`) | Per-note onset edit leaves the chord's other onsets intact |
| F3 | Chord member with longer written value than a same-voice neighbour | Voice split or explicit rejection; never neighbour deletion |
| F4 | Written overlap, `reject` and `replace` policies | Destructive replace is opt-in, one undo step, and the test that asserts silent overwrite is rewritten |
| F5 | Tie across a barline | Recorded duration survives tie/untie; no tempo substitution |
| F6 | Logical note with two occurrences | Split or `MultiOccurrenceScope`; never both edited |
| F7 | Generated rest selected, Delete pressed | No document mutation |
| F8 | Three voices required | Exact rejection message; document identity unchanged |
| F9 | 12.347 → 12.357 s, Snap off, save/reload | 10 ms survives with no offset applied twice |
| F10 | Offset ±10 s with notes at both boundaries | One application; invalid stored onsets rejected, never clamped |
| F11 | Explanation span between playing spans | Cursor holds and resumes; no invented beats (fixture required — the real clip has none) |
| F12 | Legacy reference without notation/alignment | Opens, marked estimated, saves without data loss |
| F13 | No-op command set | Identity-equal document; no dirty flag; no history entry |
| F14 | 20,000 events / 512 measures limits; empty clip | Clear rejection, no partial write |

---

## 11. Known limitations, deviations and outstanding checks

**Access limitations**

- The real draft is accessible, but it is **not the normal library route** (`/api/lessons/summaries` returned empty for this owner). Phase 7 must verify entry from the library rather than assuming it.
- No reviewed piano revision exists in `form_ui_test`, so the `MusicLessonEditor` + `NotationEditor` save path was audited statically and through its unit tests only. A reviewed fixture is needed for Phase 5 evidence.
- The production `.env` database (`form`) holds no lessons; only `form_ui_test` does. Any later evidence run must name its database.

**Real-data gaps against the plans' examples**

- “Selecting one C4” — this recording contains **no C4** (0 occurrences). The C4 case must be a fixture (F1/F6); the real clip exercises A5/A4/A3 instead.
- “Explanation passage” — the clip has one playing span and no explanation passage (longest silence 3.94 s). F11 is fixture-only.
- “Rubato” — quantisation residuals are bounded (52 ms), but no ground-truth beat annotation exists for this clip, so the audit cannot separate genuine rubato from decode jitter. Phase 4 must not claim rubato handling from this example.

**Environment**

- API suite: one failure is a missing `soundfile` in `.venv-saas`; passes when `.venv-music` site-packages are on `PYTHONPATH`. No code change implied.

**Deviations from the plan**

- None. No product code was modified; the only additions are read-only audit scripts, captures and this note.
- The audit used direct database reads to obtain the draft JSON for structural analysis. This is read-only, but it bypasses the API's ownership check for *evidence gathering only*; no write path was used and no production database was touched (`form_ui_test`).

**Explicitly not investigated (out of scope for Phase 1)**

- Verification decision editing and its conflict merge (`VerificationReview`, `working-edits.ts`), beyond noting that a visual editor must not bypass its token.
- Guitar paths.
- `usePianoSourcePlayer` drift/realignment tuning (the controller is reused, not re-designed).

---

## 12. Review record

| Item | Value |
| --- | --- |
| Phase | 1 — Baseline audit and safe edit contracts |
| Submitted code | `ef4dfb6` (audited implementation) + documentation-only commit on `phase1/piano-workspace-audit` |
| Developer summary | Audited all seven editor surfaces and four write boundaries; verified the real 209.594 s / 1,338-note example is reachable; captured baseline test evidence (339 web, 837 API incl. the environment re-run); identified 12 destructive/unsafe behaviours (8 reproduced on the real draft with before/after counts); proposed occurrence, timing, offset and alignment contracts |
| Evidence | §3 measurements, `measurements.json`, `captures/*.png`, `logs/*.log`, `scripts/*` (all read-only and re-runnable) |
| Deviations / limitations | None from plan; see §11 |
| Review decision | **NOT REVIEWED** |
| Blocking findings | None raised by the developer; reviewer to confirm the destructive paths in §6 are the correct target set |
| Follow-up submission | Pending review |
| Next phase authorised | None — Phase 2 must not start without an explicit GO |

### Reproducing this submission

```powershell
# code identity
git checkout phase1/piano-workspace-audit
git rev-parse HEAD^        # ef4dfb6

# web tests (339 pass)
cd apps/web; npm test

# api tests (836 pass, 1 env-blocked)
cd ..\..; .\.venv-saas\Scripts\python.exe -m pytest tests/api -q
$env:PYTHONPATH="$PWD\.venv-music\Lib\site-packages"
.\.venv-saas\Scripts\python.exe -m pytest "tests/api/test_piano_expression.py::test_audio_identity_is_measured_and_mismatches_rejected" -q
Remove-Item Env:\PYTHONPATH

# real-example checks (read-only)
.\.venv-saas\Scripts\python.exe docs\qualification\piano-workspace-phase-01\scripts\check-real-draft.py
docker exec form-saas-postgres-1 psql -U form -d form_ui_test -t -A -c "select document::text from music_drafts where lesson_id='0df28929d427406cb86d9bb5e2dcd35b'" -o /tmp/doc.json
docker cp form-saas-postgres-1:/tmp/doc.json .local/phase1-audit/draft-document.json

# destructive-path audit (read-only)
cd apps/web; npx tsx ..\..\docs\qualification\piano-workspace-phase-01\scripts\audit-destructive.ts
```

Screenshots were taken with Chromium 156 at 1440×900 and 390×844 against the live dev servers; no page state was submitted or saved during capture.

---

## 13. Statement of scope

Phase 1 is complete as scoped: audit, baseline evidence, destructive-path identification and contract proposals. **Phase 2 has not started.** No component has been extracted, no shared controller or history exists, no selection model has changed, and the current review page and note forms are untouched. This submission awaits review and an explicit GO.
