# Person-focused instructor video

## Anatomical hand and foot guides

Real-instructor playback overlays small L/R badges for both wrists and feet.
Left is lime and right is cyan, with a small anchor and connector to keep the
letter beside the joint. Overlapping badges are separated. Text is not burned
into the video, so it stays upright when the instructor is mirrored. Identity
always follows the anatomical MHR70 joint, not the person's screen position.

The exporter reuses the conversion's existing 2D landmarks (left wrist 62, right
wrist 41, left foot 15–17, right foot 18–20); another pose tracker is not required.
It maps each frame through the exact crop and rejects projections outside the
crop or away from the person mask. This is an unmeasured pose estimate, not a
calibrated occlusion/visibility measurement. The browser hides missing landmarks
and large discontinuities instead of retaining stale markers.

Guide data is stored as `instructorMarkers` inside the existing authorized
landmark JSON, keyed to the focused video's hash. It has its own full source
clock and four explicitly ordered limb positions. The scoring keypoints and
their timeline are preserved. The viewer samples the decoded video's clock,
accounts for contain fitting and control padding, and mirrors positions only.
The demo installer updates the landmark asset hash/size; new conversions attach
the same presentation data automatically. Existing projects without this data
continue playing without guides. The original-wide-video fallback never uses
guides calculated for the focused crop.

Practice → View → More → More → Reference offers **3D instructor**, **Real
instructor**, and **3D + real instructor**. Challenge preparation has an
**Instructor view** button opening the same choice. Challenge locks that choice,
layout and observation angle through countdown and performance. The video uses
the lesson clock, source offset, playback speed, pauses and section seeks; it has
no independent transport or audio. Mirroring follows the instructor setting.
The paired display receives the selected reference too.

Real instructor prefers the focused video, then falls back to the original if
the derivative fails to load. Lessons without a derivative can still use their
original source. Lessons without authorized source footage keep 3D available and
disable the video choices. An unavailable or persistently out-of-sync primary
video interrupts an active challenge rather than allowing an unseen reference to
continue; a failed optional companion does not interrupt the 3D reference.

## Person-only export (v2)

Every new local conversion calls `instructor_pipeline.prepare_instructor`, with
the approved `outlined` style explicitly pinned. It reuses matching complete
grounding masks or independently runs the existing SAM2 tracker when those masks
are unavailable. This is independent of the floor-correction switch, MoGe model
availability, fixed-camera checks, and the floor solver's 180-second limit.
Thus the normal supported upload range receives the same instructor treatment.
The output report must verify the outlined style, fully opaque body and output
hash before the worker includes it in the lesson. A failed generation/upload
leaves an explicit lesson warning and the clearly labeled original wide video;
it never labels that fallback as a successfully processed person-only asset.

The default **outlined** treatment preserves every original body pixel at full
opacity and its original location. It expands only the neutral-white backing,
then feathers that border outward into the app background. Only the outer rim receives temporal
stabilization; body colors and opacity are not filtered. Mask expansion, border
width and feather width scale with the instructor canvas and are recorded in the
report. This keeps fine hands/clothing from being dissolved by an inward fade.

The optional **soft** edge treatment uses a wider feather around a sharp interior.
It extends foreground colors into the feather band so the original background
cannot return as a colored fringe. Light backward optical-flow alignment and an
agreement gate stabilize small alpha changes; dissimilar/moving silhouettes are
not averaged together. Empty masks stay empty. `--edge-style extra-soft` gives a
broader diffuse boundary; `--edge-style clean` reproduces the earlier light blur.
Widths scale with the cropped instructor size, rather than with room resolution.
The chosen style is recorded in `edge_treatment` in the export report. The demo
installer accepts the same flag. These effects smooth the cutout boundary; they
do not blur the face or invent missing source detail.

The default now uses the segmentation itself to remove the original background,
not just to find a rectangle. The instructor is composited on the app's neutral
background. A moving padded crop follows them at a constant scale; centers are
smoothed with offline look-ahead and constrained to keep the observed body inside
its frame. The target dimensions come from the widest/tallest pose, rather than
from the entire path traveled. Eight percent padding protects limbs. Isolated
segmentation specks are removed while nearby disconnected body pieces remain.

Person-only output requires matching segmentation for at least 95% of source
frames. An empty mask renders neutral background instead of exposing the room.
Missing segmentation skips this derivative. The UI labels the fallback
**Original video (wide)** and displays a visible notice. The older fixed crop is
available explicitly with `--mode envelope`; it retains background and must not
be confused with person isolation. Upscaling the displayed person does not add
source detail.

The exact Taegeuk 1 demo is prepared by `prepare_person_demo.py`: run it once,
segment `outputs/person_demo/preview.mp4` using its matching `motion.npz` and the
existing GPU mask builder into `outputs/person_demo/segmentation`, then run it
with `--install`. The script verifies source provenance and keeps the original
video timeline. Only the playable lesson range determines crop scale, so opening
titles cannot force a wide frame. `prepare_saas_demo.py` retains this asset only
when its report and source/video hashes match. `verify_person_demo.py` checks the
actual served H.264 asset in Chrome with a synthetic camera, not a substituted
video fixture.

## Earlier envelope export (v1)

The local GPU worker runs `focus_instructor_video.py` after source grounding,
before conversion finalization. It reuses grounding's whole-person SAM2 masks
only after matching both source-video and motion hashes, dimensions and frame
timestamps. No additional model inference is performed. If masks are absent or
empty, existing image-space predictions supply bounds with more padding. Finite
but extreme projected points are rejected. Gaps up to half a second hold nearby
reliable bounds; longer unreliable gaps skip the derivative safely.

The optional earlier version takes the union of padded bounds across the whole clip:

- 15% padding per side, measured relative to the larger body dimension.
- 20% when any frame needs landmark bounds.
- Fixed, even-pixel crop clamped to the original frame.
- No per-pose zoom, moving camera, rescaling, frame interpolation or background removal.
- Video-only H.264 MP4, preserving the normalized source's frame clock.

The output `instructor.mp4` is optional. Failure to produce or upload it leaves
the canonical conversion usable. `instructor.json` records source identity, crop,
mask/landmark/held frame counts and output hash for local inspection. The report
is not published. The crop remains conservative: movement across most of the
image may yield a wide or full-frame derivative. It cannot restore missing
detail or body parts outside the original camera image. Multi-person selection
quality remains the responsibility of the existing reconstruction/segmentation.

`focused_video` is an optional manifest asset on the shared lesson frame clock.
`focused_video_start` identifies its start offset; when omitted it defaults to
the original `source_start` for older lessons. Trimming advances both offsets
and the animation offset by the same frame count. Conversion verification checks its attempt, MIME, size and hash
and stores it with the revision. Media retrieval uses existing lesson access and
byte-range handling. Anonymous/public-only manifests and paired manifests omit
the focused video along with private source footage; public asset routes do not
serve it. This feature does not publish instructor footage.

## Existing lessons

No reconstruction is needed when a normalized preview and its motion predictions
are retained. Reuse matching masks if available:

```powershell
.venv/Scripts/python.exe scripts/focus_instructor_video.py --video <job>/preview.mp4 --motion <job>/motion/motion.npz --masks <job>/grounding --output <output>/instructor.mp4
.venv-saas/Scripts/python.exe scripts/publish_focused_video.py --lesson <lesson-id> --video <output>/instructor.mp4
```

Use `--mode envelope` and omit `--masks` only when a background-retaining legacy crop is explicitly wanted. Publishing defaults to read-only
validation. Adding `--apply` verifies the export report against the current
lesson source, uploads a uniquely named asset, and creates a new private lesson
revision. It preserves animation, scoring landmarks, source, sections and avatar
assets; the new revision requires ordinary owner review. Existing releases and
old assets remain available. A concurrent lesson change prevents activation.

## Verification

- `tests/avatar/test_focused_video.py`: movement envelope, edge padding, source
  and frame-clock checks, mask reuse, invalid projections, short/long gaps, and
  real MP4 encode with identical presentation timestamps.
- API tests cover optional conversion outputs, attempt isolation, retrieval,
  public and paired-media filtering, and reference selection in paired state.
- `scripts/verify_focused_video.py`: local browser fixture with byte-range media,
  reference choices, shared seek/speed/pause, original fallback, absent media,
  phone/landscape/desktop layout, and a full synthetic-camera challenge with
  reference locking. No real camera or learner recording is used.

The browser check uses Vite at port 5197 by default (`PRACTICE_TEST_URL` overrides
it). A local exported instructor video is used when present; otherwise it uses
the existing demonstration video. Browser fixtures use WebM for bundled browser
codec support; the production MP4 is verified independently by the exporter
tests. Visual inspection of actual lesson crops remains advisable before use.
