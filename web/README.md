# Form — local movement practice

## Browser conversion comparison

Open `/motion-lab.html`, also linked from practice. Select **Convert in browser**
to process the bundled demonstration with MediaPipe Heavy. The default source
range matches SAM. Playback synchronizes video, SAM, and the new skeleton;
Front/Side/Top views help inspect turns and depth. Uploaded videos also work,
with the SAM panel hidden because no matching SAM reconstruction exists.

The separate worker uses GPU with CPU fallback, sequential decoded video seeks,
and 15 samples/s by default. Cancellation discards partial results. Each run is
limited to 120 seconds. The official Heavy float16 v1 model is served locally
from `dist/assets/pose_landmarker_heavy.task` (30.7 MB). Reproduce its download:
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task`.

JSON retains raw and conditioned hip-relative joints, confidence, timestamps,
source interval, and processing settings. Conditioning uses exponential
smoothing (alpha .65) and confident median bone lengths. Missing detections
remain gaps. Uncertain joints disappear in preview and GLB via STEP scale
tracks. GLB contains animated joint spheres and bone cylinders for inspection,
rather than a skinned human mesh. Neither output reconstructs root travel or
solves foot contacts. No video upload or SAM inference is involved. Automated
tests cover processing math; actual browser inference/export needs user testing.

The prototype overlays the accepted full Taegeuk animation beside you in a live camera view.
Google MediaPipe runs in a browser worker; camera frames are not uploaded or
recorded. Three.js displays the real skinned GLB. All runtime libraries and
models are served from this project, without external CDNs.

## Open

Run `scripts/start_practice.ps1` from the project root. It prints:

- Desktop: `http://localhost:8000`
- Phone: an `https://<computer-IP>:8443` address on the same Wi-Fi.

The phone URL uses a local self-signed HTTPS certificate. You must accept or
trust its certificate in your browser before camera access is available.
Some phones may require explicitly trusting the local certificate. Public
deployment with a normally trusted certificate is a later step. No firewall,
router, or certificate-store settings are changed automatically.

1. Put the phone in a stable position and open the page.
2. Choose front/back camera in **Practice settings** if needed.
3. Select **Start camera** and allow camera access.
4. Stand upright with your head and both feet visible for roughly 3 seconds.
5. Once **Height matched · locked** appears, select **Start lesson**.
6. Mirror the phone's screen to the TV using the phone's usual mirroring feature.

**Recalibrate height** repeats calibration. Changing the camera or image aspect
invalidates calibration. The displayed avatar does not resize during crouches
or kicks. Playback supports pause, restart, scrubbing and 0.5× / 0.75× / 1× speed.
Calibration pauses reference playback. You can preview the lesson without a camera.

The optional recorded-video demonstration mode is clearly labelled and is not
a live student assessment. Stop it before starting your own camera.

## Camera composite

**Camera composite** is the default practice view. Place the phone in landscape
with enough room beside you in the picture. After height calibration, the avatar
is positioned beside your calibrated standing location at your displayed height
and floor level. **Avatar side** means screen left/right, including a mirrored
front-camera preview. Use **Position** to adjust the horizontal spacing and
**Opacity** to adjust visibility. Placement stays fixed while you move.

**Side by side** restores the separate camera/reference panes. Changing views
preserves calibration and lesson progress. Hand labels, scores, sections, and
voice controls work in both views. A soft shadow provides a visual floor cue.
This is a camera overlay: it does not detect room surfaces, depth, or occlusion,
and will not remain anchored to the room if the phone moves. Recalibrate after
moving the phone. Live composite appearance still needs testing on your phone/TV.

## Height matching

Calibration requires confidently visible head, shoulders, hips, knees, ankles,
and feet; upright hips/knees; and stable image height/floor for at least 2.5
seconds and 30 detections. Head-top position is estimated from face/shoulder
landmarks. The GLB's standing height is measured from its actual skinned bounds
at an upright reference frame. Uniform scaling matches visible standing height
and floor after accounting for camera-image letterboxing. It does not estimate
the user's height in centimetres or retarget individual limb lengths.

Both panes always show anatomical **L** (peach) and **R** (blue) hand labels,
independent of the skeleton-feedback toggle. Labels follow the actual wrist
bones/landmarks, including camera reflection and reference mirroring. Uncertain
or lost live wrists hide their labels rather than leaving stale markers.

## Sections and optional voice commands

Step-by-step playback is the default. The full lesson has 20 initial manually
set sections, including the opening/ready sequence and closing bow. These are
prototype boundaries for refinement, not automatically detected technique labels.
Every section stops at its final pose. **Next** plays the next section, **Back**
plays the previous section forward, **Again** replays the current/last section,
and **Pause** freezes the current pose. Matching buttons always remain available.
The main play button resumes a paused section or replays a completed one.
Full-sequence playback remains available under **Practice settings**.

**Edit lesson sections** lets you change names/end times, add a split at the
paused playhead, merge a section with its successor, or restore the defaults.
Sections always cover the complete animation without overlaps or gaps. Timings
are saved in browser-local storage; they do not change the accepted GLB or
affect other devices/browsers.

Choose **Enable voice control** to request microphone access. Voice recognition
uses the browser's `SpeechRecognition` / `webkitSpeechRecognition` service,
which may send audio to its speech service and require internet. It is not
advertised as offline or entirely on-device. No audio is stored by this app.
Only final results containing the exact words Next, Back, Again, or Pause are
acted on; quick repeated echoes are debounced. A visible indicator shows
listening/reconnection/errors. Permission denial and recognition failures
leave the buttons usable. Turning voice off or hiding/leaving the page stops
recognition and prevents pending reconnections.

Speech recognition has not been verified on the user's actual browser/phone.
Some browsers, including embedded browser surfaces, do not support it. Use a
browser that exposes speech recognition or use the buttons as a fallback.

## Initial scoring

SAM's MHR keypoints and MediaPipe world landmarks are mapped into common
camera axes. The score combines eight joint angles (75%) and major limb
directions (25%), so height and global translation do not affect it. The score
looks for one complete matching pose within 1 second behind / 0.15 seconds
ahead of reference playback and smooths the displayed value. Mirroring swaps
left/right joints and reflects the reference; front-camera preview reflection
is handled separately. Missing joints or stale tracking clear the score.

This is an initial similarity measure, not expert technique coaching. General
camera perspective, orientation, fast movement, occlusion, and phone/TV latency
still need real-device testing and scoring refinement. The avatar follows its
root horizontally to stay in its pane; the accepted source GLB remains untouched.

## Reproduce setup

From the project root:

```powershell
.venv/Scripts/python.exe -m pip install cryptography
.venv/Scripts/python.exe scripts/prepare_practice_assets.py
cd web
npm.cmd ci
node prepare-assets.mjs
```

Download Google's model from
`https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
to `web/dist/assets/pose_landmarker_lite.task`.

Run `npm.cmd test` in `web` for calibration, letterboxing, scoring, mirroring,
missing-joint and actual Three.js animation parsing/restart checks.

## Verification limits

The local HTTP server returns 200 and the automated code/data tests pass.
Automated browser preview was blocked by the browser tool's security policy;
live camera inference and phone/TV behavior have not been verified in-browser.
No claim of completed live-device testing is made.

Three.js and MediaPipe retain their original package licenses. The reference
GLB derives from MHR and SAM output; their original license terms still apply.

The browser lab now defaults to a solid 3D mannequin (torso, pelvis, head, and volumetric limbs). Display switches between mannequin and skeleton without reconverting. The GLB download includes the selected representation. This generic procedural body follows 3D landmark orientation and does not reconstruct clothing or individual body shape. Mannequin tests cover body turns and confidence gating.
