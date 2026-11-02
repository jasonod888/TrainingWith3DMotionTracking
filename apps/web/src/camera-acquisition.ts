// Camera acquisition: the only place that touches getUserMedia.
//
// Hardware access sits behind `CameraIO` so the selection, fallback and
// error-mapping rules can be tested with fakes. This module acquires and
// inspects a stream; it deliberately does not own the lifetime of the stream it
// returns — `MimicInterface` keeps that, so one owner decides when tracks stop.
//
// Bounded by design: at most one discovery probe, one preferred device and one
// facing fallback. Permission denial stops immediately instead of cycling
// through every lens or re-prompting.

import {
  acquisitionPlan,
  buildVideoConstraints,
  classifyLens,
  labelFacing,
  needsDiscoveryProbe,
  normalizeDevices,
  normalizeFacing,
  type ActualFacing,
  type CameraDevice,
  type CameraRequest,
  type LensStatus,
} from './camera-policy.ts';

export type DeviceInfo = {kind: string; deviceId: string; label: string};

export type CameraIO = {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices?(): Promise<readonly DeviceInfo[]>;
};

export type CameraFailureCode =
  | 'permission_denied'
  | 'no_camera'
  | 'insecure_context'
  | 'busy'
  | 'unsupported'
  | 'constraint'
  | 'unknown';

export class CameraFailure extends Error {
  readonly code: CameraFailureCode;

  constructor(message: string, code: CameraFailureCode) {
    super(message);
    this.name = 'CameraFailure';
    this.code = code;
  }
}

export type AcquiredCamera = {
  stream: MediaStream;
  deviceId: string;
  label: string;
  facing: ActualFacing;
  /** Reported by the track; 0 until the browser knows the frame size. */
  width: number;
  height: number;
  lensStatus: LensStatus;
  devices: CameraDevice[];
  /** True when a wide candidate was actually attempted. */
  wideAttempted: boolean;
  /** True when the first choice failed and a later step produced the stream. */
  fallback: boolean;
};

export type AcquireOptions = {
  /** Devices already enumerated in this session, when the UI has them. */
  devices?: readonly {deviceId?: string; label?: string}[];
  /** Set when the person picked the device by hand in the advanced list. */
  explicit?: boolean;
};

export function cameraIO(): CameraIO | null {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!media?.getUserMedia) return null;
  return {
    getUserMedia: (constraints) => media.getUserMedia(constraints),
    enumerateDevices: () => media.enumerateDevices(),
  };
}

export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks?.() ?? []) {
    try {
      track.stop();
    } catch {
      // A track that already ended throws on some browsers; nothing to release.
    }
  }
}

async function enumerate(io: CameraIO): Promise<CameraDevice[] | null> {
  if (typeof io.enumerateDevices !== 'function') return null;
  try {
    const devices = await io.enumerateDevices();
    return normalizeDevices((devices ?? []).filter((device) => device.kind === 'videoinput'));
  } catch {
    return null;
  }
}

export async function listCameras(io: CameraIO | null): Promise<CameraDevice[]> {
  return io ? (await enumerate(io)) ?? [] : [];
}

export function watchCameras(io: CameraIO | null, listener: () => void): () => void {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!io || !media?.addEventListener) return () => {};
  media.addEventListener('devicechange', listener);
  return () => media.removeEventListener('devicechange', listener);
}

function toFailure(error: unknown): CameraFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as {name: unknown}).name) : '';
  const detail = error instanceof Error ? error.message : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraFailure('Camera permission was denied. Allow access in your browser, then try again.', 'permission_denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraFailure('No camera was found on this device.', 'no_camera');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraFailure('The camera is already in use by another app or tab. Close it, then try again.', 'busy');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraFailure('This camera could not provide a supported mode.', 'constraint');
    case 'TypeError':
      return new CameraFailure('Camera access needs HTTPS or localhost.', 'insecure_context');
    default:
      return new CameraFailure(detail || 'The camera could not start.', 'unknown');
  }
}

async function open(io: CameraIO, video: MediaTrackConstraints): Promise<MediaStream> {
  try {
    return await io.getUserMedia({audio: false, video});
  } catch (error) {
    throw toFailure(error);
  }
}

function inspect(stream: MediaStream, request: CameraRequest, devices: CameraDevice[], explicit: boolean): Omit<AcquiredCamera, 'stream' | 'devices' | 'wideAttempted' | 'fallback'> {
  const track = stream.getVideoTracks?.()[0];
  if (!track) {
    stopStream(stream);
    throw new CameraFailure('No camera track was provided.', 'no_camera');
  }
  const settings = typeof track.getSettings === 'function' ? track.getSettings() : ({} as MediaTrackSettings);
  const trackLabel = typeof track.label === 'string' ? track.label : '';
  const deviceId = typeof settings.deviceId === 'string' ? settings.deviceId : '';
  const listed = devices.find((device) => device.deviceId === deviceId);
  const label = trackLabel || listed?.label || '';
  const reported = normalizeFacing(settings.facingMode);
  const facing = reported === 'unknown' ? labelFacing(label) : reported;
  return {
    deviceId,
    label,
    facing,
    width: Number(settings.width) || 0,
    height: Number(settings.height) || 0,
    lensStatus: classifyLens({request, actualFacing: facing, actualLabel: label, devices, explicit}),
  };
}

export async function acquireCamera(request: CameraRequest, io: CameraIO | null, options: AcquireOptions = {}): Promise<AcquiredCamera> {
  if (!io) throw new CameraFailure('Camera access needs HTTPS or localhost.', 'insecure_context');
  let devices = normalizeDevices(options.devices);
  let stream: MediaStream | null = null;
  let wideAttempted = false;
  let fallback = false;
  let explicitChosen = options.explicit === true && Boolean(request.deviceId);
  let lastFailure: CameraFailure | null = null;

  // Labels are unreadable before a grant, so a rear wide preference needs one
  // ordinary request before it can look for a wide lens at all.
  if (!options.explicit && needsDiscoveryProbe(request, devices)) {
    stream = await open(io, buildVideoConstraints({...request, deviceId: ''}));
    devices = (await enumerate(io)) ?? devices;
  }

  for (const step of acquisitionPlan(request, devices)) {
    if (step.kind === 'facing') {
      if (stream) break;
      stream = await open(io, buildVideoConstraints({...request, deviceId: ''}));
      break;
    }
    if (step.purpose === 'wide') wideAttempted = true;
    // Never hold two phone cameras open just to compare lenses.
    if (stream) {
      stopStream(stream);
      stream = null;
    }
    try {
      stream = await open(io, buildVideoConstraints(request, step.deviceId));
      if (step.purpose === 'explicit') explicitChosen = true;
    } catch (error) {
      const failure = error as CameraFailure;
      lastFailure = failure;
      if (failure.code === 'permission_denied' || failure.code === 'insecure_context' || failure.code === 'busy') throw failure;
      fallback = true;
    }
  }

  if (!stream) throw lastFailure ?? new CameraFailure('No camera was found on this device.', 'no_camera');

  const inspected = inspect(stream, request, devices, explicitChosen);
  return {...inspected, stream, devices, wideAttempted, fallback};
}
