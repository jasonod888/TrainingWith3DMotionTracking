# Basic Pitch audio preparation and timing audit

## Inference input

The worker extracts the analysis WAV from the exact uploaded source object:

```text
ffmpeg -i source.media -map 0:a:0 -vn -t <clip duration> -ar 22050 -ac 1 -c:a pcm_s16le
```

- 22,050 Hz, mono, signed 16-bit PCM — Basic Pitch's required format.
- No gain normalization, resampling other than the declared 22,050 Hz conversion, time
  stretching, or added leading silence.
- `-t` is the requested clip duration; the worker does not add `job.start`. The browser's
  clip preparation/trim selects the uploaded excerpt before it reaches the worker.
- The source object hash and size are checked against the lease job before extraction.

## Timeline

- Basic Pitch frame times are converted by `model_frames_to_time` at 86.1328 frames/s;
  events are clipped to the job duration and finite-checked in the adapter.
- Note times use the same seconds timeline as the reviewed lesson/reference. The lesson
  player uses those seconds directly.
- The existing 14.677 s clip starts about 0.94 s into the original recording because it was
  trimmed before upload. This is a source-preparation offset, not a transcription timing
  defect, and it is **not** applied again to lesson notes.

## Existing clip check

The stored source for the existing clip is 14.677 s; the extracted analysis WAV is also
14.677 s (mono, 22,050 Hz). Re-inference reproduces 46 current-settings notes. There is no
additional leading silence or duration change introduced by the worker.

## Remaining limitation

There is still no manually checked, human-performed reference transcription for this
clip. The aligned synthetic fixtures exercise decoder settings, but they are not a
substitute for human-verified piano references.
