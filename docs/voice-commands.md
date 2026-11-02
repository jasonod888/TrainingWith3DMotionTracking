# Voice commands

Voice is opt-in in practice: More → Sound & voice → Allow voice service → Enable
voice. Microphone permission is still required. Successful activation closes the
settings panel so the normal practice-command guard no longer discards commands.
A persistent status shows listening state and the last command. Voice resources
survive ordinary React renders and use the latest callbacks; navigation, hiding
the page, disabling voice or unmounting stops the microphone.

Signed-in users prefer the app's local recognition service when installed. This
supports embedded desktop browsers without a working Web Speech service. Browser
SpeechRecognition remains the fallback if local recognition is unavailable.
Unsupported browsers show an explanation next to the disabled enable button.

Supported phrases: next, back, again, pause, start/resume/play, stop, repeat,
next section, go back, slower/slow down, faster/speed up, loop. Commands must be
explicit phrases, not arbitrary substring matches in background speech. Existing
competition, setup and other open-panel command restrictions are retained.

## Local service

Install API dependencies and run `scripts/download_voice_model.py` to download the
official `vosk-model-small-en-us-0.15` model. `VOICE_ENABLED=false` disables the
service; `VOICE_MODEL_DIR` changes the model path. Compose mounts the model into
the app container. Restart/rebuild the API after dependency installation.

An AudioWorklet captures mono 16 kHz PCM only after consent and activation. Voice
activity detection splits speech into clips up to three seconds, bounded queues
prevent audio accumulation, and Vosk decodes an explicit grammar. The authenticated
POST route uses existing CSRF/origin protection, strict size/base64 checks and
bounded inference concurrency. Audio is processed in memory and is not saved.
When hosted, audio reaches that app server; it is not necessarily on the device.
The UI explains local/server or browser speech processing before activation.

## Verification

Shared recognition-controller tests are included in the main web test command.
Voice API tests cover authentication, CSRF, malformed/short audio and capability
selection for anonymous users. Synthetic English recordings of six commands were
decoded by the actual installed model. `verify_voice_app.py` uses a synthetic
microphone with browser speech recognition disabled and a temporary QA session
that is deleted afterwards. It checks panel closing, recognition, a real playback
speed change, and release of microphone tracks after disabling voice.

These checks do not establish that a physical microphone has permission in every
desktop shell, nor guarantee recognition accuracy for every speaker/noise level.
