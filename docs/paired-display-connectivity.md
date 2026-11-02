# Paired practice display — connectivity and use

This covers how the phone and the practice display reach each other, what to
configure, and what to tell people using it. It is written for the LAN-only
milestone described in
[paired-display-and-wide-camera-implementation-plan.md](paired-display-and-wide-camera-implementation-plan.md).

## 1. Requirements

- **A secure context on the phone.** `getUserMedia` and WebRTC require HTTPS or
  `localhost`. On a plain-HTTP origin the camera cannot start at all, and the
  interface says so instead of retrying.
- **The same account on both devices.** Pairing is authenticated and bound to the
  account; the receiver must be signed in.
- **Both devices reachable from each other.** Same LAN/VLAN is the intended
  path. There is no relay in this milestone.
- **Two browser tabs or devices.** The receiver does not need to be a TV: a
  computer connected to a TV over HDMI is the supported receiver.

## 2. Pairing and expiry

| Item | Value |
| --- | --- |
| Connection code lifetime | 10 minutes from creation |
| Lifetime after approval | 2 hours |
| Active pairs per account | 4 |
| Claim attempts | code is single-use; one receiver per code |

The receiver revokes its pair when it leaves the page. A reload therefore needs
a new code — resumable receiver tokens are not part of this milestone. Pairs that
are simply abandoned expire on their own; cleanup never depends on an unload
request arriving.

## 3. ICE and relay configuration

Both peers build their `RTCPeerConnection` from the same `iceConfiguration()` in
`apps/web/src/rtc-config.ts`. By default it is **empty**, which is the LAN-only
decision:

```ts
iceConfiguration() // { iceServers: [] }
```

To add servers later, provide a JSON array through the build environment. No
credential should ever be committed; issue short-lived TURN credentials from a
server endpoint and inject them at runtime.

```bash
# Example shape only — do not commit real credentials.
VITE_ICE_SERVERS='[{"urls":"stun:stun.example.net:3478"},{"urls":"turns:relay.example.net:5349","username":"<short-lived>","credential":"<short-lived>"}]'
```

`parseIceServers` is defensive: malformed JSON, non-arrays, entries without
`urls`, and blank credentials are dropped rather than sent.

### When the connection fails

`connectionFailureCopy()` distinguishes the two cases:

- **No relay configured** (today): "These devices could not connect directly.
  Same-Wi-Fi connections can still fail on networks that block
  device-to-device traffic. Try a different network, or connect both devices to
  the same router."
- **Relay configured**: a shorter retry message, without the LAN caveat.

Both devices must be on a network that permits peer-to-peer traffic. Guest Wi-Fi,
client isolation, and some managed networks block it even when both devices have
an address on the same subnet. A relay is the fix; it is deliberately out of
scope here.

## 4. What the receiver is allowed to show

The snapshot sent to the receiver is bounded and contains no device identifiers:

| Field | Meaning |
| --- | --- |
| `source_generation` | Monotonic camera/setup identity; changes on every camera switch |
| `camera_status` | `off`, `starting`, `live`, `interrupted`, `failed` |
| `camera_facing` | `front`, `rear`, or `unknown` when the browser does not report it |
| `lens_status` | `wide-confirmed`, `wide-requested-unverified`, `standard`, `unknown` |
| `source_width`, `source_height` | Captured frame size, used for guide geometry |
| `setup_phase`, `setup_hint_code`, `setup_progress` | Bounded setup feedback |
| `guide` | Optional normalised outline for the positioning guide |
| `signal_generation` | Which negotiation an offer or answer belongs to |

Only decoded, advancing frames make the receiver say "Camera live". A successful
pairing, an incoming track, or a `connected` transport state are not enough.

## 5. Screen mirroring (phone only)

When the receiving screen has no browser or app, use the operating system's
screen mirroring: AirPlay from an iPhone to an AirPlay-capable TV, or Cast
screen / Miracast from Android. Nothing runs on the TV and no pairing or code is
involved.

Because mirroring shows *the phone's screen*, turn on **Mirror** first: it is the
last button in the practice tools, and also available under More → Larger screen →
**Mirror this screen to a TV**. The phone then shows:

- the live camera and the 3D instructor side by side in landscape (stacked in
  portrait), sized from the measured container;
- the section name and current state as a large overlay at the top;
- controls only when you tap, resting during playback so the picture is clean.

Things to know:

- **The button cannot start mirroring.** No web API exists for launching AirPlay
  or Cast screen mirroring; the app can only reshape itself and tell you the OS
  step. On iPhone that is Control Centre → Screen Mirroring, on Android it is
  quick settings → Cast / Smart View.
- **Rotate the phone to landscape before mirroring.** A portrait mirror is
  pillarboxed on a 16:9 television.
- **Mirroring adds latency** on top of camera delivery. The picture is for
  watching your own movement and the instructor, not for judging fine timing.
- **Auto-framing is unchanged** by presentation mode. Turn it off under View if
  you want the complete camera image; the rear camera is always full view.
- **The browser's own chrome is part of the mirror.** The address bar cannot be
  hidden by the page, and iOS gives a web page no fullscreen for non-video
  elements.
- Presentation mode is a phone layout, not a second screen: the phone cannot show
  different content from the TV while it is on.

For a sharper, lower-latency picture where a spare computer is available, use the
browser pairing in sections 2–4 instead.

## 6. Using it

1. **Phone:** open the lesson, choose **Connect display**, create the code. The
   other screen must be signed into the same account.
2. **Receiver:** open **Use as practice display**, enter the code, wait for
   approval. The receiver shows "Waiting for approval" until then.
3. **Phone:** approve the display. Approving controls alone does not start video.
4. **Phone:** start practice. In the preparation stage choose **Front camera** or
   **Rear camera**. Rear offers **Prefer wide view** and, once the browser has
   listed cameras, a named camera selector. Choose **Start camera**.
5. Read the reported result. It distinguishes "Rear wide camera" (you chose a
   labelled wide device), "wide requested, not verified", "wide lens unavailable
   in this browser", and "lens type not identified".
6. **Place the phone** securely, facing you, so your head and feet are in the
   picture. Complete setup using the large instructions on the receiver; the
   countdown follows automatically because practice was already requested.
7. **To switch camera or lens:** pause practice first by changing the camera.
   Calibration is cleared and setup must be completed again before resuming.
   Approved pairing and camera sharing are preserved.
8. **To stop the picture:** stop sharing in Connect display, or turn the camera
   off. Sharing does not turn itself back on when the camera restarts.
9. **If video does not appear:** use **Show camera** if the browser blocked
   autoplay, **Try again** to re-poll, or share the camera again from the phone.
   On restricted networks, read the direct-connection message.

## 7. Administrator checklist

- Serve the app over HTTPS with a certificate both devices trust.
- Confirm the receiver account has access to the lesson being practised; the API
  rechecks lesson access and revision on every read.
- Keep `VITE_ICE_SERVERS` unset for an explicitly LAN-only deployment, and tell
  users that restricted networks are not supported.
- When adding a relay, issue short-lived credentials server-side, inject them at
  runtime, test a forced-relay path, and only then remove the LAN-only wording
  from user-facing documentation.
