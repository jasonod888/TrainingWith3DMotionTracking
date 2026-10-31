# Practice first, recording optional

The primary task is to practise with a live self view beside or over the instructor. Recording captures a chosen part of that practice for later review. It is a nested action within practice, rather than the entry point to the camera.

## Interaction

1. Opening a move shows the instructor. Play works without a camera.
2. **Start practice** requests the camera and displays the live self view. No recorder is created and no video is stored. The user can frame themselves and complete height matching before playing.
3. **Record practice** becomes available once the live camera and existing preparation requirements are ready. During playback, capture starts at the current position without restarting the movement. From paused practice, capture starts after the normal count-in.
4. **Stop recording** finalizes the take while the live practice session continues. A **Review take** action appears; a review dialog does not interrupt the session automatically. Recording status and its remaining time are explicit.
5. **Review take** pauses playback for review, saving, discarding or deliberately replacing the take. Only one bounded take is held at a time. An unsaved take remains protected from accidental replacement or navigation.
6. **End practice** pauses playback, finalizes an active recording and releases the camera. A captured take remains available until the user leaves the page or discards it.

The practice control is visually primary. Recording is secondary and only shown within live practice. Play/Pause controls the movement; pausing does not hide the live camera. Camera setup remains available for device selection, mirroring and height matching.

## State and resource rules

Camera state (off, starting, live), movement state (paused, count-in, playing, rest) and capture state (idle, queued, recording, take available) remain independent. Only an explicit recording action starts MediaRecorder. Cancelling recording intent cannot carry it into a later ordinary Play. Stopping capture does not stop the camera. Ending practice does not discard the take. Starting another practice does not automatically record.

Existing privacy and bounds apply: camera video is processed on the device; recordings contain video only, are bounded to two minutes/32 MB, and remain in page memory until explicitly exported. Saving practice summaries is a separate opt-in. Backgrounding suspends the camera and requires starting practice again.

## Verification

`scripts/verify_practice_flow.py` runs against a local Vite preview with Python Playwright. It substitutes generated canvas video and synthetic pose messages, so no physical camera is accessed. It checks zero captures during live practice; recording during playback; uninterrupted practice after Stop recording; camera release; retained take review; cancelled capture intent; ending practice during recording; and control fit at 320 × 480, 812 × 375 and 1280 × 800. Set PRACTICE_TEST_URL to use a different local preview address.

Real phone camera permissions, tracking quality and device export behavior still require physical-device checks.
