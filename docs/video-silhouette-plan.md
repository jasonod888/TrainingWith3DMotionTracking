# Video silhouette creation and storage plan

Date: 31 October 2026. Status: proposed implementation plan; no feature implementation yet.

## Agreed outcome and scope

Create an animated silhouette of the selected person as actually visible in an uploaded motion video, including clothing and hair. Preserve the recorded viewpoint and visible occlusions. Do not infer hidden limbs, generate a body from the 3D mesh, or include other people, shadows, reflections, equipment, or background objects in the intended mask. Errors on these boundaries must be measured rather than assumed solved.

This work covers generation, person selection, timing, quality review, private storage, retrieval, retry, and deletion. Practice/compete compositing, alignment, scoring, body-size adjustment, and learning behavior are explicitly deferred.

## Initial architecture

- Generate on the existing GPU worker, outside the web/API process. Use SAM 2.1 Small with the video predictor as the initial candidate, not a final quality claim.
- Compare it with the existing MediaPipe Pose Landmarker segmentation output before choosing the production model. Do not introduce SAM 3.1 unless the initial comparison identifies a quality or tracking problem that warrants evaluating it.
- Keep silhouette generation independent of SAM 3D inference. Run the models sequentially and unload them between stages on the existing 8 GB GPU.
- Keep on-device generation for a subsequent optimization. It must produce the same asset contract and pass the same quality checks; the first version does not depend on browsers completing background processing.

## Source and timeline

1. Use the exact normalized `preview.mp4` that the current conversion worker passes to SAM 3D: upright, audio-free, 15 fps, within the existing size limit. Hash these exact bytes and retain the hash in silhouette metadata.
2. Make this normalized clip available as a private conversion intermediate before the 3D conversion finishes, with retention sufficient for retries. The current worker only uploads it at finalization, so this requires an explicit intermediate handoff.
3. Record decoded presentation timestamps, image dimensions, applied rotation, mirroring, and the relationship to the originally selected source range. Both derived assets must reference the same normalized source identity.
4. Generate a mask for every decoded frame, including frames where the selected person is absent. Preserve actual timestamps and the final frame duration. Do not infer the frame count from the nominal fps alone or stretch masks to match an animation duration.
5. Begin with a fixed mask canvas at 512 pixels on the longest side, retaining aspect ratio. Compare 768 pixels during evaluation if hands, feet, or gaps between limbs lose useful detail. Record the exact source-to-mask transform, including any padding.

The current preprocessing already reduces uploaded motion to 15 fps. This version inherits that temporal detail; increasing capture or motion-processing frame rates is separate work.

## Person selection and video segmentation

1. Find a clear frame with a visible person. Reuse a trustworthy person box if available, or perform a lightweight detection pass; do not use the current SAM 3D full-frame fallback box as evidence of subject identity.
2. When there is one unambiguous subject, initialize their video object track. If multiple plausible subjects exist, mark the job `needs_selection` and offer an owner-only frame on which to choose the person. Do not silently choose the largest person.
3. Initialize with a box and, where needed, positive/negative point prompts. Track one stable object ID throughout the video. Propagate backward as well as forward when initialization occurs after the first frame.
4. For long clips, process bounded chunks with overlap and retained tracking state or explicit identity reinitialization. Verify chunk seams and peak memory on maximum-length clips; do not load an entire multi-minute decoded video into GPU memory.
5. Preserve disjoint visible pieces and real holes between limbs. Avoid unconditional largest-component filtering or hole filling, which can remove an occluded hand or close a valid gap.
6. Apply conservative edge cleanup only after reviewing its effect on fast movement. Do not average masks across time indiscriminately: that can create trailing limbs.
7. Save absence/uncertainty flags. An absent subject produces an empty mask. An uncertain occlusion/reappearance must trigger review rather than switching to another person or copying the last mask indefinitely.

For SAM 2.1, threshold logits for the binary master; do not describe arbitrary logit magnitudes as calibrated alpha or confidence. Any feathered edge is a documented derived treatment. MediaPipe confidence maps have different semantics and must be recorded as such if that model is selected.

## Saved artifact contract

Attach an independently versioned silhouette record to the immutable source motion revision. Do not mutate historical motion manifests as jobs finish; expose the associated silhouette through a separate revision-scoped response.

| Artifact | Contents |
| --- | --- |
| `silhouette.json` | Schema version; motion/source revision; normalized source hash; selected subject and prompts; model/checkpoint checksum; processing settings/version; source and mask dimensions; transforms; timestamps and final frame duration; mask encoding semantics; chunk index; per-chunk byte sizes and checksums; quality flags and review result |
| `masks-00000.zip`, etc. | Bounded chunks of lossless grayscale PNG masks, indexed by frame; initial target of approximately 10 seconds per chunk, subject to measured size limits |
| Optional `silhouette-preview.mp4` | Black background and white person for owner review; lossy convenience copy, not the master |

Use 0 for background and 255 for foreground in the binary master. Preserve a model's soft masks only if evaluation demonstrates a useful benefit and defines their interpretation. Store no colour, opacity setting, or original RGB image in mask files. Keep masks on a fixed canvas instead of independently centering each frame.

Generate PNGs from the model output, not by decoding a lossy preview video. Bound archive size, image dimensions, frame count, and decompressed bytes on verification. Validate archives without trusting embedded filesystem paths. Write storage chunks incrementally so large masks never require one large in-memory upload.

Use attempt-specific private object keys. Publish the manifest/index only once every referenced chunk passes verification, and atomically associate the complete result with the requested source revision. Retrying creates a new generation; a previously valid generation remains readable until its replacement succeeds.

## Job lifecycle and application integration

- Add a durable silhouette job with `queued`, `processing`, `needs_selection`, `needs_review`, `ready`, `failed`, and `cancelled` states. Generation status is separate from any owner's quality acceptance.
- Enqueue from the normalized-source handoff. Pin source revision/hash, selected-person prompts, model version, and processing version; use these for duplicate suppression.
- Reuse existing worker authentication, lease, heartbeat, cancellation, and checksummed upload patterns, with a dedicated silhouette capability and endpoints. Do not simply expand the current four-file dictionary: finalization currently assumes fixed motion output fields and order.
- Silhouette failure does not invalidate or rerun the 3D conversion. Retry segmentation from the retained normalized clip. Both jobs reference the intermediate, so one job's cleanup cannot delete a source still needed by the other.
- Existing revisions remain valid without silhouettes. Allow owner-requested backfill when their private normalized preview still exists; report unavailable when no compatible source remains.
- Attach results only to the requested immutable revision. A video replacement creates a new source identity; stale results cannot attach to that replacement.
- For Replicate/fal, enable this capability only after the custom deployment and dispatcher implement the same source handoff, assets, and verification contract. Do not silently route jobs to another provider or repeat a paid 3D request to obtain masks.

Expected implementation areas: `apps/api/database.py` and a migration; a dedicated silhouette contract/router; `scripts/saas_worker.py` source handoff; a bounded-memory segmentation worker/script; storage and cleanup helpers; the remote provider contract; and a small owner-only selection/review view. Keep the learning engine unchanged.

## Access and retention

Treat silhouettes as private source-derived media initially. Apply ownership checks to metadata, prompts, mask chunks, previews, and job operations. Keep them out of public manifests and public asset allowlists until a later explicit sharing design. Use authenticated retrieval or short-lived authorized URLs.

Define intermediate retention around both dependent jobs: retain while active or awaiting selection/review, use bounded expiry for abandoned/failed work, and preserve the existing private preview where already required by the product. Delete abandoned attempts and expired chunks. Deletion of the source motion must also schedule deletion/cancellation of its silhouette assets/jobs. Archive, deletion, and replacement behavior must be distinguished explicitly in implementation.

## Delivery phases and validation gates

1. **Evaluate locally.** Run SAM 2.1 Small and MediaPipe Pose masks on a consented set of approximately 12–20 representative clips. Include standing, side/back views, turns, crossed limbs, floor poses, rapid motion, blur, loose clothing, hair, low contrast, occlusion, re-entry, and other people. Hand-label selected difficult frames for overlap/boundary measurements and inspect full sequences for flicker and identity errors. Record runtime per video minute, peak GPU/CPU memory, storage per video minute, missing frames, and quality flags. No paid service benchmark is needed for this phase.
2. **Choose model and settings.** Select model, canvas resolution, chunk length, cleanup, and documented limits using the measured results. Require no unflagged identity switches in the evaluation set; use visual boundary acceptability plus measured errors rather than an invented accuracy promise. Escalate to a larger SAM 2.1 variant or SAM 3.1 only if failures justify it.
3. **Implement creation and storage.** Add the source handoff, independent jobs, segmentation exporter, versioned metadata, verification, private retrieval, cancellation, cleanup, and retries. Add the minimal owner selection/review workflow for flagged results.
4. **Verify end to end.** Check exact frame/timestamp correspondence, rotation and aspect ratio, binary round-trip integrity, final-frame coverage, bounded memory on maximum-length clips, and chunk continuity. Exercise cancellation, lease loss, duplicate jobs, failed uploads, retry, source expiry, revision replacement races, and unauthorized/public access. Confirm old motion revisions and the current 3D conversion still work without a silhouette.
5. **Enable locally behind a feature flag.** Complete an upload-to-private-review run on the current GPU. Release wider provider support only after the provider contract is tested. Consider on-device generation afterward if its measured quality and device reliability justify it.

Completion means an uploaded motion can produce a verified, timestamped, privately retrievable silhouette sequence for the intended person, with independent retry and review. No practice or compete integration is required for completion.

## Primary references

- [SAM 2 video predictor and model variants](https://github.com/facebookresearch/sam2)
- [MediaPipe Pose Landmarker mask output](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [SAM 3.1 release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)
