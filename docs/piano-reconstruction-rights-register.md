# Selected piano data and sound sources

Verified: 12 November 2026. This is a concrete replacement route for the commercial
reconstruction project, not a request to wait for SMD/MAESTRO permission.

## Decision

Use **Vienna 4x22 original audio plus the CPJKU corrected performance MIDI** for the
initial real-recording benchmark. Use **VCSL CC0 piano samples and project-authored
MIDI sequences** for controlled development and synthetic supervision. Use
**Salamander Grand Piano V3** as an attribution-licensed richer renderer candidate.
SMD and MAESTRO are not required for this route and are excluded from its inputs.

The [renderer/acceptance specification](piano-reconstruction-acceptance-v1.md)
now defines sfizz + Salamander as the first fidelity prototype and FluidSynth + a
project-built VCSL SF2 as a control baseline. Engine/build/dependency terms and sample
terms are separate; neither pairing has yet passed a source-sound quality study.

| Source | Published terms | Selected use | Conditions |
|---|---|---|---|
| Vienna original audio/performance data, Werner Goebl | CC BY 4.0 | Real-recording evaluation and scoped calibration | Retain attribution/license and identify changes |
| CPJKU Vienna corrected MIDI/match release | CC BY 4.0 | Aligned performance references, controls and score links | Credit original collection and updates; pin corrected release |
| Versilian Community Sample Library (VCSL) | CC0 1.0 | Piano samples, controlled renders and synthetic supervision | Use original source; pin assets and retain provenance |
| Salamander Grand Piano V3, Alexander Holm | CC BY 3.0 | Candidate multi-velocity piano playback/rendering library | Retain attribution/license, document adaptations and sampler compatibility |

CC BY licenses permit commercial reuse subject to their conditions; they are not
noncommercial or share-alike licenses. This selection uses the licensors' published
grants. Unresolved uses of different assets still require separate assessment; no
additional permission request is a prerequisite merely because these selected
sources have an attribution license.

## Source evidence

- [University dataset record](https://datasets.mdw.ac.at/datasets/dataset/98ea25fa-2468-43ff-929b-3c926e163583)
  and [full license metadata](https://datasets.mdw.ac.at/datasets/dataset/98ea25fa-2468-43ff-929b-3c926e163583?view=full).
  The collection provides recorded piano performances and MIDI; published license is CC BY 4.0.
- [Corrected Vienna repository and license](https://github.com/CPJKU/vienna4x22).
  Its [change log](https://github.com/CPJKU/vienna4x22/blob/master/CHANGES.md)
  documents audio-start alignment corrections and pedal/sound-off updates. Pinned
  verification revision: `1033ade0899bfd03a89f370c9ad5d8443ddccd3e`.
- [VCSL original repository](https://github.com/sgossner/VCSL) and
  [CC0 license](https://github.com/sgossner/VCSL/blob/master/LICENSE).
  The maintainer explicitly includes commercial software use. Pinned verification
  revision: `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`.
- [Salamander source and license](https://github.com/sfzinstruments/SalamanderGrandPiano)
  and [instrument description](https://sfzinstruments.github.io/pianos/salamander/).
  The selected SFZ mapping uses extended sampler opcodes; verify the renderer's
  support rather than assuming every SFZ engine reproduces all controls.
- [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/).

## Files actually retrieved and inspected

Local working directory: `.local/commercial-piano-data/` (not redistributed in Git).

1. Original `vienna-midi.zip`: archive and per-file note/control inspection retained
   in `vienna-verification.json`. The original MIDI must not be used uncritically:
   some files lack pedal events and their starting times differ from the audio.
2. Corrected set in `vienna-midi-corrected/`: **112 MIDI files downloaded and parsed**.
   Excluding partial/average variants yields **88 primary performances, 43,656 notes**;
   all 88 contain sustain (CC64) and soft-pedal (CC67) events. These are measured
   file-inspection counts, not accuracy or alignment certification.
3. `vienna-original-sample.wav`: a real original stereo recording, **44,100 Hz,
   128.199 seconds**, downloaded by bounded access to the university audio archive.
   Its paired corrected `Chopin_op38_p01.mid` contains 727 notes and controls.
   Source archive path: `audio/Chopin_Ballade/Chopin_op38_p01.wav`.
4. Four original Kawai C3 velocity-layer WAVs in `vcsl-samples/`, decoded successfully;
   `VCSL-LICENSE`, `VCSL-README.md` and `vcsl-sample-manifest.json` retained.
5. Corrected repository `LICENSE`, `README.md`, `CHANGES.md`, revision identity and
   individual MIDI SHA-256 values retained beside the files.

The large original audio archive was **not** fully downloaded. The complete archive
is approximately 1.30 GB; one original performance and the full small MIDI set were
enough to verify practical access and usable file formats. No new application model,
renderer or production profile has been installed by this selection work.

## Developer acquisition and preparation

- Original audio archive:
  `https://datasets.mdw.ac.at/media/content_files/8dec8d0a-c4da-4a96-b290-a3ba783c03ba.zip`
- Original MIDI archive (historical/provenance, not preferred reference):
  `https://datasets.mdw.ac.at/media/content_files/26a437a4-6130-4f66-9488-20a0fae91751.zip`
- Corrected performance references: use the pinned CPJKU revision above, not the
  unshifted original MIDI or score-only MusicXML exported to MIDI.
- Join audio and corrected MIDI by performance filename, validate timing and note-off
  semantics, and exclude average and excerpt variants from independent-performance
  counts. Do not count the same performance twice through different excerpt files.
- Freeze fit/calibration/holdout assignments before model experiments. Reserve pieces
  where possible; report that players and recording setup may still overlap. Bootstrap
  uncertainty by performer/piece where appropriate, not by treating every note as an
  independent recording.
- Use project-authored random/structured MIDI rather than web-scraped songs for new
  synthetic controls. Split sample instruments and sequence seeds between development
  and synthetic holdout. Synthesized audio is not a substitute for a real held-out test.
- Add third-party notices with creator, source, license link and modifications. Exported
  or distributed adapted assets must retain the applicable attribution information.

Suggested attribution records:

> The Vienna 4x22 Piano Corpus — Werner Goebl, DOI 10.21939/4X22, CC BY 4.0.
> Performance reference updates by CPJKU contributors, CC BY 4.0, revision recorded above.
> Any trimming, resampling or additional annotations are changes by this project.

> Salamander Grand Piano V3 — Alexander Holm, CC BY 3.0.
> SFZ mapping updates by kinwie; retain upstream notices and identify project changes.

## What this resolves and what it does not

### Additional evidenced model route

The [continuation plan](piano-reconstruction-continuation-and-reuse-plan.md) records
the author's `piano-transcription-inference` 0.0.6 distribution (MIT declared by the
[author's PyPI release](https://pypi.org/project/piano-transcription-inference/0.0.6/))
and its exact [Zenodo checkpoint release](https://zenodo.org/records/4034264), whose
[official metadata](https://zenodo.org/api/records/4034264) declares CC BY 4.0.
The existing local checkpoint matches the published MD5. This is a separate route from
copying the unlicensed ByteDance training checkout. Add separately evidenced exact
artifact entries to the machine-readable manifest; this documentation change does not
silently change the runtime preflight's current decisions. The model benchmark need
not wait for permission to that training repository or for Transkun clarification.

This removes the project's dependency on noncommercial SMD/MAESTRO reference data for
starting the reconstruction work. It provides real human performances and a separate
permissive sample-based development route without needing new recordings from the user.

Vienna is limited to four works, 22 performers and one piano/recording setting. It is
useful for first-domain evaluation and calibration, not sufficient evidence for a
universal piano-sound or transcription claim. Captured MIDI/pedal information also
does not eliminate the need for independent audible-ending annotations.

Pretrained checkpoint terms remain specific to the checkpoint and are not determined
by this dataset selection. Choose and pin them separately; the selected data can be
used to compare models or build the renderer/refinement infrastructure without training
a large transcription model from scratch. No claim is made that buying an ordinary
piano plugin automatically permits redistributing its samples as a dataset.
