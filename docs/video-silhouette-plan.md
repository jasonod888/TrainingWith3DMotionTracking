# Video silhouette creation and storage plan

Date: 31 October 2026. Status: contract v1 and the Phase 1 evaluation harness are
implemented (`apps/api/silhouettes.py`, `scripts/evaluate_silhouettes.py`). No
silhouette generation is enabled in production; the feature flag stays off.

## Agreed outcome and scope

Create an animated silhouette of the selected person as actually visible in an
uploaded motion video, including clothing and hair. Preserve the recorded
viewpoint and visible occlusions. Do not infer hidden limbs, generate a body from
the 3D mesh, or include other people, shadows, reflections, equipment, or
background objects in the intended mask. Errors on these boundaries must be
measured rather than assumed solved.

This work covers generation, person selection, timing, quality review, private
storage, retrieval, retry, and deletion. Practice/compete compositing, alignment,
scoring, body-size adjustment, and learning behavior are explicitly deferred.

## Initial architecture

- Generate on the existing GPU worker, outside the web/API process. Use SAM 2.1
  Small with the video predictor as the initial candidate, not a final quality
  claim.
- Compare it with MediaPipe Pose Landmarker masks produced by the evaluation
  harness before choosing the production model. The current browser worker emits
  landmarks only and never requests a segmentation mask, so the MediaPipe
  comparator is new work, not existing output to reuse.
- Do not introduce SAM 3.1 unless the evaluation identifies a quality or tracking
  problem that warrants it.
- Keep silhouette generation independent of SAM 3D inference. Run the models
  sequentially and unload them between stages on the existing 8 GB GPU.
- Keep on-device generation for a subsequent optimization. It must produce the
  same asset contract and pass the same quality checks; the first version does
  not depend on browsers completing background processing.

## Contract decisions (v1)

These decisions are normative. `apps/api/silhouettes.py` is the machine-checked
form of them; `SCHEMA_VERSION = 1` and `PROCESSING_VERSION = 'silhouette-v1'` pin
the record.

1. **Revision binding.** A generation is keyed by
   `(conversion_id, normalized_preview_sha256)` and carries its own generation
   id. The motion revision is *not* pre-allocated at claim time. The silhouette
   is keyed, staged, and verified before any revision exists; it is bound to the
   immutable revision only when conversion finalization has created that
   revision and verified that the revision's recorded preview hash equals the
   generation's source hash. A replacement clip creates a new source identity,
   and a generation whose hash does not match can never attach to it.
2. **Subject discovery.** A small detector on the worker proposes the subject.
   SAM 3D's detector box may be reused only when its detector identity,
   confidence, frame index and timestamp, and coordinate transform are recorded.
   Any detector box is a *selection candidate*, not proof of identity. Multiple
   plausible subjects require owner selection.
3. **Review semantics.** Generation status and owner review are separate. A
   generated and verified asset is `ready` with `review.status` of
   `pending | accepted | rejected` plus quality flags. `needs_review` is not a
   job state. `ready` never implies acceptance.
   `needs_selection` remains the one blocking state, because tracking cannot be
   initialised safely without knowing who the subject is.

The state machine is:

```
queued        -> processing | needs_selection | failed | cancelled
processing    -> needs_selection | ready | failed | cancelled
needs_selection -> queued | processing | failed | cancelled
ready         -> cancelled
failed        -> queued | cancelled
cancelled     -> (terminal)
```

`needs_selection` releases the worker lease: the job waits without holding GPU
time, and resumption records the owner's choice (frame, box, optional positive
and negative points) before tracking starts. A retry is a new generation with a
new id; a previously valid generation stays readable until its replacement
succeeds.

## Source and timeline

1. Use the exact normalized `preview.mp4` that the current conversion worker
   passes to SAM 3D: upright, audio-free, 15 fps, within the existing size limit.
   Hash these exact bytes and retain the hash in silhouette metadata. The hash is
   of the bytes, never of a re-encode; ffmpeg output is not reproducible bit for
   bit across versions.
2. Make this normalized clip available as a private conversion intermediate
   before the 3D conversion finishes, with retention sufficient for retries. The
   current worker only uploads it at finalization, so this requires an explicit
   intermediate handoff.
3. Record decoded presentation timestamps, image dimensions, applied rotation,
   mirroring, and the relationship to the originally selected source range. Both
   derived assets must reference the same normalized source identity.
4. Generate a mask for every decoded frame, including frames where the selected
   person is absent. Preserve actual timestamps and the final frame duration. Do
   not infer the frame count from the nominal fps alone or stretch masks to match
   an animation duration. The motion manifest's `duration` ends at the last
   timestamp while the masks cover the last frame's display interval too, so the
   two assets are joined by timestamps, never by duration.
5. Begin with a fixed mask canvas at 512 pixels on the longest side, retaining
   aspect ratio. Compare 768 pixels during evaluation if hands, feet, or gaps
   between limbs lose useful detail. Record the exact source-to-mask transform,
   including letterbox padding.

The current preprocessing already reduces uploaded motion to 15 fps. This version
inherits that temporal detail; increasing capture or motion-processing frame
rates is separate work.

## Person selection and video segmentation

1. Find a clear frame with a visible person. Run the worker's own detector for a
   selection candidate, or reuse a SAM 3D detector box only with its detector
   identity, checkpoint, score, frame and timestamp, and coordinate transform
   recorded. Do not use the current SAM 3D full-frame fallback box as evidence of
   subject identity.
2. When there is one unambiguous subject, initialize their video object track.
   If multiple plausible subjects exist, mark the job `needs_selection` and offer
   an owner-only frame on which to choose the person. Do not silently choose the
   largest person.
3. Initialize with a box and, where needed, positive/negative point prompts. Track
   one stable object ID throughout the video. Propagate backward as well as
   forward when initialization occurs after the first frame.
4. For long clips, process bounded chunks with overlap and retained tracking state
   or explicit identity reinitialization. Verify chunk seams and peak memory on
   maximum-length clips; do not load an entire multi-minute decoded video into GPU
   memory.
5. Preserve disjoint visible pieces and real holes between limbs. Avoid
   unconditional largest-component filtering or hole filling, which can remove an
   occluded hand or close a valid gap.
6. Apply conservative edge cleanup only after reviewing its effect on fast
   movement. Do not average masks across time indiscriminately: that can create
   trailing limbs.
7. Save absence/uncertainty flags. An absent subject produces an empty mask. An
   uncertain occlusion/reappearance must trigger review rather than switching to
   another person or copying the last mask indefinitely.

For SAM 2.1, threshold logits for the binary master; do not describe arbitrary
logit magnitudes as calibrated alpha or confidence. Any feathered edge is a
documented derived treatment. MediaPipe confidence maps have different semantics
and must be recorded as such if that model is selected. The manifest's
`model.settings` and the harness report both record the threshold and its
semantics.

## Saved artifact contract

Attach an independently versioned silhouette record to the immutable source
motion revision. Do not mutate historical motion manifests as jobs finish; expose
the associated silhouette through a separate revision-scoped response.

| Artifact | Contents |
| --- | --- |
| `silhouette.json` | Schema version; generation and attempt; conversion id; normalized source hash and byte size; source dimensions, rotation, mirroring, decoded frame count; selection prompt and detector evidence; model identity, checkpoint checksum, settings and processing version; mask transform; timestamps and final frame duration; chunk index with per-chunk bytes and checksums; quality flags; review snapshot; binding |
| `masks-00000.zip`, etc. | Bounded chunks of canonical lossless greyscale PNG masks, indexed by decoded frame; initial target of approximately 10 seconds per chunk, subject to measured size limits |
| Optional `silhouette-preview.mp4` | Black background and white person for owner review; lossy convenience copy, not the master |

Use 0 for background and 255 for foreground in the binary master. Preserve a
model's soft masks only if evaluation demonstrates a useful benefit and defines
their interpretation. Store no colour, opacity setting, or original RGB image in
mask files. Keep masks on a fixed canvas instead of independently centering each
frame.

### Contract v1 details

`apps/api/silhouettes.py` implements schema 1:

- **Identity and keys.** Generation ids are 24 lowercase hex characters. Every
  object for a generation lives under
  `silhouettes/{conversion_id}/{generation_id}/`; chunk names are
  `masks-00000.zip` and increment. Keys are attempt-specific, so a retry cannot
  overwrite a readable generation.
- **Binding.** `binding` is optional in the schema and required to publish. It
  carries `lesson_id`, `revision_id`, `preview_sha256_verified = true`, and
  `bound_at`. `bind()` refuses a hash mismatch and refuses a second, different
  revision. `assert_publishable()` refuses an unbound generation or a hash that
  differs from the revision's. `requires_review` is true while a pending
  generation carries an identity-switch suspicion or uncertain frames; that does
  not block publication, because the owner must retrieve the asset to review it.
- **Timeline.** One timestamp per decoded frame, strictly increasing; a single
  `final_frame_duration` applies to the last frame. `coverage_end` is
  `last_timestamp + final_frame_duration`. The chunk list must cover every frame
  contiguously; the sum of chunk frame counts must equal the decoded frame count.
- **Canvas.** `transform` records canvas size, scale, and letterbox offsets, with
  nearest-neighbour resampling. It must reproduce the source dimensions within
  half a pixel; a canvas that crops the source is rejected.
- **Canonical mask PNG.** 8-bit greyscale, no alpha, no interlace, filter type 0,
  values only 0 and 255, CRC checked per chunk. The decoder accepts only this
  form, so archive entries cannot smuggle a general-purpose image through the
  verifier.
- **Chunks.** Stored uncompressed inside the zip (`ZIP_STORED`) because PNG data
  is already compressed. Entry names must be exactly the six-digit frame names
  implied by `first_frame`; directories, duplicates, foreign names, wrong
  dimensions, non-binary values, oversized entries and checksum mismatches are
  rejected. Per-chunk byte size, SHA-256, entry count, 32 MiB chunk limit, 256 MiB
  decompressed limit, 1 GiB total and 4 MiB manifest limits are enforced.
- **Dedupe key.** A hash of source bytes, conversion id, selection prompt, model
  reference, and transform; it suppresses duplicate work without suppressing a
  deliberate re-run with different prompts or settings.
- **Review.** `review.status` is `pending` by default. `accepted` and `rejected`
  must record `decided_at`; transitions are pending to either decision, and
  between the decisions. Generation status is not changed by a review decision.

Generate PNGs from the model output, not by decoding a lossy preview video.
Validate archives without trusting embedded filesystem paths. Write storage
chunks incrementally so large masks never require one large in-memory upload.

Publish the manifest/index only once every referenced chunk passes verification,
and atomically associate the complete result with the requested source revision.
Retrying creates a new generation; a previously valid generation remains readable
until its replacement succeeds.

## Job lifecycle and application integration

- Durable silhouette jobs use only `queued`, `processing`, `needs_selection`,
  `ready`, `failed`, and `cancelled`. Review is a separate value on the record.
- Enqueue from the normalized-source handoff. Pin source revision/hash, selected
  person prompts, model version, and processing version; use these for duplicate
  suppression.
- Reuse existing worker authentication, lease, heartbeat, cancellation, and
  checksummed upload patterns, with a dedicated silhouette capability and
  endpoints. Do not simply expand the current four-file dictionary: finalization
  currently assumes fixed motion output fields and order. `0014_silhouette_capability`
  adds the `worker_credentials.silhouettes` gate; it defaults to off for every
  existing worker.
- Silhouette failure does not invalidate or rerun the 3D conversion. Retry
  segmentation from the retained normalized clip. Both jobs reference the
  intermediate, so one job's cleanup cannot delete a source still needed by the
  other.
- Existing revisions remain valid without silhouettes. Allow owner-requested
  backfill when their private normalized preview still exists; report unavailable
  when no compatible source remains.
- Attach results only to the requested immutable revision. A video replacement
  creates a new source identity; stale results cannot attach to that replacement.
- For Replicate/fal, enable this capability only after the custom deployment and
  dispatcher implement the same source handoff, assets, and verification
  contract. Do not silently route jobs to another provider or repeat a paid 3D
  request to obtain masks.

Expected implementation areas: `apps/api/database.py` and a migration; a
dedicated silhouette contract/router; `scripts/saas_worker.py` source handoff; a
bounded-memory segmentation worker/script; storage and cleanup helpers; the remote
provider contract; and a small owner-only selection/review view. Keep the
learning engine unchanged.

## Access and retention

Treat silhouettes as private source-derived media initially. Apply ownership
checks to metadata, prompts, mask chunks, previews, and job operations. Keep them
out of public manifests and public asset allowlists until a later explicit sharing
design. Use authenticated retrieval or short-lived authorized URLs.

Define intermediate retention around both dependent jobs: retain while active or
awaiting selection/review, use bounded expiry for abandoned/failed work, and
preserve the existing private preview where already required by the product.
Delete abandoned attempts and expired chunks. Deletion of the source motion must
also schedule deletion/cancellation of its silhouette assets/jobs. Archive,
deletion, and replacement behavior must be distinguished explicitly in
implementation.

## Phase 1 evaluation harness

`scripts/evaluate_silhouettes.py` runs a dataset of labelled clips through a
predictor, writes production-shaped chunks and a validated manifest, and reports
measured quality, runtime and storage. `scripts/silhouette_eval.py` holds the
dataset loader, metrics, and artifact writer.

Dataset layout:

```
dataset/
  <clip-id>/
    preview.mp4          # normalized 15 fps, audio-free clip
    clip.json            # prompt, tags, subject count, labelled frame list
    labels/000000.png    # hand labels at source resolution, 0/255
    truth/000000.png     # self-check only: every-frame truth
```

`clip.json`:

```json
{"prompt": {"frame_index": 0, "box": [120, 40, 380, 700]},
 "tags": ["standing", "turn"],
 "subject_count": 1,
 "labels": [{"frame_index": 0, "timestamp": 0.0}],
 "notes": "Side view, loose jacket."}
```

Run:

```
.venv/Scripts/python.exe scripts/evaluate_silhouettes.py \
  --dataset evaluation/clips --predictor sam2 \
  --checkpoint models/sam2.1_hiera_small.pt --out outputs/silhouette-eval
```

Use `--check` to report dependencies, CUDA, clip count and checkpoint presence;
`--predictor mediapipe` for the comparator; `--self-test` to validate the metric
and artifact pipeline on a generated clip without weights.

Installing the two models (neither is vendored, and no paid service is used):

```
pip install "git+https://github.com/facebookresearch/sam2.git"
# SAM 2.1 small weights; the config name must match the installed package.
curl -L -o models/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/sam2/sam2.1_hiera_small.pt
pip install mediapipe  # Pose Landmarker, segmentation masks enabled in the harness
```

The MediaPipe comparator runs on the worker's CPU/GPU through the Tasks API; its
masks are probabilities, not SAM logits, and the harness records that difference
in `model.settings` and in the report.

Recorded per clip: mean and median IoU, boundary F1 at 2 px, absent-frame
accuracy, subject-missing and subject-replaced frames, temporal change versus
ground-truth change (flicker proxy), chunk count, bytes and bytes per video
minute, wall time and seconds per video minute, peak GPU allocation, and the
contract quality flags. The Markdown report states that these are measurements,
not an accuracy promise.

The harness always writes an *unbound* manifest: evaluation generations never
attach to a revision, which is exactly the staging state a real generation has
before finalization.

## Delivery phases and validation gates

1. **Evaluate locally.** Run SAM 2.1 Small and MediaPipe Pose masks on a consented
   set of approximately 12–20 representative clips. Include standing, side/back
   views, turns, crossed limbs, floor poses, rapid motion, blur, loose clothing,
   hair, low contrast, occlusion, re-entry, and other people. Hand-label selected
   difficult frames for overlap/boundary measurements and inspect full sequences
   for flicker and identity errors. No paid service benchmark is needed for this
   phase. The harness is ready; the clip set and SAM 2 weights are the remaining
   inputs.
2. **Choose model and settings.** Select model, canvas resolution, chunk length,
   cleanup, and documented limits using the measured results. Require no unflagged
   identity switches in the evaluation set; use visual boundary acceptability
   plus measured errors rather than an invented accuracy promise. Escalate to a
   larger SAM 2.1 variant or SAM 3.1 only if failures justify it.
3. **Implement creation and storage.** Add the source handoff, independent jobs,
   segmentation exporter, versioned metadata, verification, private retrieval,
   cancellation, cleanup, and retries. Add the minimal owner selection/review
   workflow for flagged results. The contract and migration are already in place.
4. **Verify end to end.** Check exact frame/timestamp correspondence, rotation and
   aspect ratio, binary round-trip integrity, final-frame coverage, bounded memory
   on maximum-length clips, and chunk continuity. Exercise cancellation, lease
   loss, duplicate jobs, failed uploads, retry, source expiry, revision
   replacement races, and unauthorized/public access. Confirm old motion revisions
   and the current 3D conversion still work without a silhouette.
5. **Enable locally behind a feature flag.** Complete an upload-to-private-review
   run on the current GPU. Release wider provider support only after the provider
   contract is tested. Consider on-device generation afterward if its measured
   quality and device reliability justify it.

Completion means an uploaded motion can produce a verified, timestamped, privately
retrievable silhouette sequence for the intended person, with independent retry
and review. No practice or compete integration is required for completion.

## Primary references

- [SAM 2 video predictor and model variants](https://github.com/facebookresearch/sam2)
- [MediaPipe Pose Landmarker mask output](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [SAM 3.1 release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)
