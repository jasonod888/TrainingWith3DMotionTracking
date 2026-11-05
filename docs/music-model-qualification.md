# Music model qualification harness

5 November 2026. This is a measurement and artifact-gate harness, not a model. No model,
weights or transcription package is installed or downloaded by it. Music processing
remains disabled.

## Purpose

Before a transcription artifact can be considered for the isolated music worker it needs:

1. an explicit, approved artifact identity and licence;
2. benchmark evidence against reviewed references, recorded rather than asserted.

`scripts/qualify_music_model.py` does both for a proposal/reference pair and writes a JSON
report. A score is evidence for review, never approval, and it does not select an engine.

## Artifact gate

`--artifact` takes JSON with `name`, `version`, `license`, `sha256` (64 hex characters) and
`source_url`. Missing fields and unapproved licences are refused. The current approved set
is Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC and CC-BY-4.0. Any other licence needs
an explicit policy decision and a change to that list — the harness cannot waive it.

## Metrics

Proposals are matched one-to-one to the reviewed reference by exact pitch and an onset
tolerance (`--tolerance`, default 50 ms), greedily nearest-first. The report contains:

- reference notes, proposed notes, matched, missing, extra;
- precision, recall, F1;
- onset mean absolute error for matched notes.

## Usage

```powershell
python scripts/qualify_music_model.py --artifact artifact.json --reference reviewed.json --proposal proposal.json --output report.json
```

`reviewed.json` is the reviewed reference document and `proposal.json` is a draft/adapter
document with `events`. The CLI prints the report and a one-line summary.

## Verification

`tests/api/test_music_model_qualification.py` covers:

- a perfect proposal (precision/recall/F1 = 1, zero onset error);
- onset tolerance, missing and extra notes;
- wrong pitch never matches;
- required artifact metadata, licence refusal and sha256 validation;
- the CLI writing a report and refusing an unapproved licence.

## Limits

- Metrics measure note agreement, not musical quality, fingering or pedagogy.
- Velocity and duration agreement are not scored yet.
- There is no fixture corpus in the repository yet; qualification needs reviewed
  references supplied by the operator.
- **No artifact has been qualified.** The fixture engine remains a transport test only.
