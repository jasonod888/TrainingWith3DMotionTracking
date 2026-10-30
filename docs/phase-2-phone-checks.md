# Phase 2 — Android and iPhone acceptance

The user has both devices available and selected “Leave phone testing for later” on 30 October 2026. These checks remain deferred; desktop resizing and the recorded-video test do not replace them. Do not advance to Phase 3 until the gate is passed or the user explicitly revises it.

## Connect locally

Keep Railway/AWS deployment deferred. Both phones and the PC should use the same private Wi-Fi network. For live camera access, the browser needs a secure context: an HTTPS certificate trusted by that phone and valid for the PC's private address. Ordinary HTTP over a LAN address is insufficient. Certificate trust is device configuration; this implementation does not install certificates, bypass browser warnings, or change firewall rules.

With an existing device-trusted certificate and key, build the frontend, keep the local database/storage/mail running, then use:

```powershell
powershell -File scripts/start_saas_phone.ps1 -Address YOUR_PC_WIFI_IPV4 -CertificatePath PATH_TO_TRUSTED_CERT.pem -PrivateKeyPath PATH_TO_KEY.pem
```

The launcher prints the exact phone URL, binds only that private address, and configures that HTTPS origin for sign-in and CSRF checks. It restores its environment setting on exit. Never commit private keys or certificate material. The old prototype's self-signed certificate must not be assumed trusted by either phone.

Android USB development can alternatively forward a PC localhost port using an already-authorized Android development connection; this does not solve iPhone access. If no device-trusted certificate is available, finish the connection setup before marking either phone tested. Do not substitute an unapproved public tunnel or cloud deployment.

Create your own local account. Verification/reset mail is visible on the PC at `http://127.0.0.1:8025`; it is not delivered to your real inbox. Open the verification link once, then sign in on both phones. Add a private prepared lesson. Camera frames are processed in the phone browser; they are not uploaded. Voice may use the browser's online speech service and is separately opt-in.

## Run on Android Chrome and iPhone Safari

Record phone model, OS version and browser version, then:

1. Open the saved lesson with camera and voice off. Confirm the content fits in portrait and landscape without sideways scrolling or obscured controls.
2. Navigate with Next, Back, Again and Pause buttons. Confirm the first two section ends hold at their exact boundary, replay stays in the section, Back plays the previous section forwards, pause/resume keeps position, and final completion does not wrap.
3. Enable the front camera; match standing height with the full body visible. Confirm calibration prevents playback, then locks size while crouching, turning and kicking. Check anatomical L/R labels and missing/occluded-joint behaviour.
4. Check the composite and side-by-side views, mirror reference, opacity and avatar position. Changing view should retain calibration; changing camera or source dimensions should require fresh calibration.
5. Hide your body or cover the camera. Feedback and live labels must clear rather than freeze. Return to view and confirm recovery. Treat the score as approximate pose similarity, not technique accuracy.
6. Switch to the back camera. Deny camera permission once, then retry deliberately. Stop the camera and confirm the phone's camera indicator stops. Playback buttons must remain usable.
7. Enable voice after reviewing the browser speech notice. Test exactly Next, Back, Again and Pause. Test denial/unavailable speech and confirm buttons still work. Record voice support separately from camera/player support; unsupported speech is an expected capability difference, not a reason to claim voice passed.
8. Background the browser, lock/unlock the phone, rotate it, leave the lesson, and reopen it. Camera and voice must stop and require a deliberate restart. Playback stays paused and the saved lesson position returns; height calibration is fresh.
9. Sign in from the second phone and reopen the same private lesson. Confirm saved sections and position are present. A different account must not see it.
10. Practise for at least ten minutes. Record freezes, memory/performance issues, heating, tracking delays, audio-service interruptions, and whether camera release still works afterward.

For feedback quality, compare representative correct and intentionally different poses at the same reference frame. Record failures caused by viewpoint, occlusion and motion timing; do not certify technique coaching from a high self-match score. No representative human-motion quality evaluation has been completed yet.

## Record

| Device | Player and section holds | Camera/calibration | Lifecycle/cleanup | Voice capability | Ten-minute run | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Android Chrome — model/versions pending | Pending | Pending | Pending | Pending | Pending | Pending |
| iPhone Safari — model/versions pending | Pending | Pending | Pending | Pending | Pending | Pending |

Report the first failing step and what happened. Keep Phase 2 open until failures are resolved and both device results are recorded.
