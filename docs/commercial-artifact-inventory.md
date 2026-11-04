# Commercial artifact inventory

Template for P0.4 of the [multi-discipline plan](multi-discipline-implementation-plan.md).
A row is approved only when every column is filled from the actual artifact, not from a
project README. Production workers and browser builds must read this allowlist; an
unapproved artifact cannot become a default by configuration alone.

No artifact is installed by Phase 0 or Phase 1. Rows below record the decision state from
the [licensing review](model-commercial-licensing.md); hashes and notices stay pending
until implementation chooses exact files.

## Required columns

| Field | Meaning |
| --- | --- |
| Component | Model, runtime or library name |
| Role | Authoring transcription, live detection, rendering, runtime |
| Distribution | Server worker only, browser bundle, or both |
| Version / commit | Exact tag or commit, not a branch |
| Source URL | Original download location |
| Files | Exact artifacts shipped, with SHA-256 each |
| Code licence | Licence text location and obligations |
| Weight licence | Separate evidence for weights when it exists |
| Vendored runtime | Licence of any bundled kernels or wasm |
| Notices | Files that must ship with the artifact |
| Reviewer | Person who recorded the evidence |
| Decision | approved / hold / rejected |

## Current rows

| Component | Role | Distribution | Version | Files + SHA-256 | Code licence | Weight licence | Notices | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Spotify Basic Pitch | Authoring transcription baseline | Server worker | Not installed | Pending | Apache 2.0 | Included distribution; record exact saved model | Upstream NOTICE + modification notice | Approved in principle, artifact not installed |
| Spotify Basic Pitch TypeScript | Optional browser experiment | Browser bundle (not used) | Not installed | Pending | Apache 2.0 | Official conversion; provenance to record | Apache NOTICE | Candidate |
| Transkun | Piano comparison candidate | Server worker | Not installed | Pending | MIT | Bundled checkpoint under repository MIT inference | MIT notice | Hold pending author clarification on weights |
| Guitar-Transcription | Optional draft-position aid | Server worker | Not installed | Pending | MIT | Separate MIT weights repository | MIT notices for both repositories | Candidate for Phase 8, not Phase 1 |
| PitchPlease | Live microphone candidate | Browser bundle | Not installed | Vendor manifest hashes exist upstream | MIT declared | No explicit weight/kernel grant established | Unknown | Hold |
| AutoTab v2 | Research only | Not distributed | Not installed | Pending | MIT metadata | Legacy weights unclear | Unknown | Hold |
| ByteDance piano transcription | Not needed | Not distributed | Not installed | Pending | Apache 2.0 README | Zenodo checkpoint terms unverified | Unknown | Hold |
| Magenta MT3 | Not needed | Not distributed | Not installed | Pending | Apache 2.0 | Checkpoint coverage unverified | Unknown | Hold |
| Web MIDI | Input API | Browser | n/a | n/a | Browser API | n/a | n/a | Approved |
| mediabunny 1.65.0 | Local clip preparation | Browser bundle | 1.65.0 | `node_modules/mediabunny` in the lockfile | Check package licence before release | n/a | Record package licence | In use for body; music path pending qualification |

## Rules for a release row

- Converted, quantized, or fine-tuned weights keep the upstream obligations.
- A browser download counts as distribution; a server-only model is a different
  arrangement, not an exemption.
- A metadata licence label alone does not resolve inherited or third-party artifacts.
- Missing evidence means hold, not approval. Do not add an unapproved artifact to an
  image or bundle and hide it behind a flag.
