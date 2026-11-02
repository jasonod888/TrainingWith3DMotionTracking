// Camera selection policy: requested versus actual, and bounded wide-lens
// evidence.
//
// Pure and framework-free so the rules can be tested without a camera. There is
// no standard "ultrawide" selector in the browser: `facingMode: environment`
// means "a rear camera", and `MediaDeviceInfo.label` is localised free text. So
// wide-lens identification is treated as *evidence*, never fact, and the app
// reports the strongest claim the evidence actually supports.
//
// Rules that keep the reporting honest:
//  - never infer field of view from array order, device-id text or resolution;
//  - a user's explicit device choice is the only "confirmed" wide evidence;
//  - absent labels mean "not identified", not "unavailable";
//  - front cameras are never described as wide.

export type RequestedFacing = 'front' | 'rear';
export type LensPreference = 'default' | 'prefer-wide';
export type LensStatus = 'wide-confirmed' | 'wide-requested-unverified' | 'standard' | 'unknown';
export type ActualFacing = 'user' | 'environment' | 'unknown';
export type ProtocolFacing = 'front' | 'rear' | 'unknown';

export type CameraRequest = {
  facing: RequestedFacing;
  lens: LensPreference;
  /** Local only: never sent to the receiver. */
  deviceId: string;
};

export type CameraDevice = {deviceId: string; label: string};

export type CameraSelection = {
  requested: CameraRequest;
  actualFacing: ActualFacing;
  actualDeviceId: string;
  actualLabel: string;
  width: number;
  height: number;
  lensStatus: LensStatus;
};

export const CAMERA_REQUEST_DEFAULTS: CameraRequest = {facing: 'front', lens: 'default', deviceId: ''};

export const CAMERA_PREFERENCE_KEY = 'mimic.camera.preference';

/** Localised label fragments. Documented heuristics, not a lens taxonomy. */
const FRONT_LABEL = /\bfront\b|facetime|selfie|\buser\b|avant|frontal|selbst|前面|前置/i;
const REAR_LABEL = /\bback\b|\brear\b|environment|\bworld\b|arri[eè]re|trasera|hinten|\brück\b|后面|后置/i;
/** "Ultra wide", "ultrawide", "0.5x", "超广角" and close translations. */
const ULTRA_WIDE = /ultra[\s_-]?(wide|grand|gran|angular|breit)|0[.,]5\s*[x×]|超广角/i;
/** "Wide angle" without "ultra": on many phones this *is* the ultrawide, on
 *  others it is the standard lens, so it is weaker evidence. */
const WIDE = /wide[\s_-]?(angle|camera|lens)|grand[\s_-]?angle|gran[\s_-]?angular|广角|weitwinkel|groothoek/i;

export function facingModeFor(facing: RequestedFacing): 'user' | 'environment' {
  return facing === 'front' ? 'user' : 'environment';
}

export function wantsWide(request: CameraRequest): boolean {
  return request.facing === 'rear' && request.lens === 'prefer-wide';
}

export function labelFacing(label: string): ActualFacing {
  const front = FRONT_LABEL.test(label);
  const rear = REAR_LABEL.test(label);
  if (front === rear) return 'unknown';
  return front ? 'user' : 'environment';
}

export function wideEvidence(label: string): 'strong' | 'weak' | 'none' {
  if (ULTRA_WIDE.test(label)) return 'strong';
  if (WIDE.test(label)) return 'weak';
  return 'none';
}

export function normalizeFacing(value: unknown): ActualFacing {
  return value === 'user' || value === 'environment' ? value : 'unknown';
}

export function protocolFacing(facing: ActualFacing): ProtocolFacing {
  if (facing === 'user') return 'front';
  if (facing === 'environment') return 'rear';
  return 'unknown';
}

/** Pseudo device ids some browsers expose but reject as exact constraints. */
const PSEUDO_IDS = new Set(['', 'default', 'communications']);

export function normalizeDevices(devices: readonly {deviceId?: string; label?: string}[] | undefined): CameraDevice[] {
  const seen = new Set<string>();
  const result: CameraDevice[] = [];
  for (const device of devices ?? []) {
    const deviceId = device?.deviceId ?? '';
    if (PSEUDO_IDS.has(deviceId) || seen.has(deviceId)) continue;
    seen.add(deviceId);
    result.push({deviceId, label: device.label ?? ''});
  }
  return result;
}

export function hasLabelledDevices(devices: readonly CameraDevice[]): boolean {
  return devices.some((device) => device.label.trim().length > 0);
}

/**
 * Best-first device order. Evidence ranks first; label text is a deterministic
 * tiebreaker so the order never depends on enumeration order.
 */
export function rankDevices(devices: readonly CameraDevice[], request: CameraRequest): CameraDevice[] {
  const wanted = facingModeFor(request.facing);
  const wideFirst = wantsWide(request);
  const scored = devices.map((device) => {
    const facing = labelFacing(device.label);
    const facingRank = facing === 'unknown' ? 1 : facing === wanted ? 0 : 2;
    const evidence = wideEvidence(device.label);
    const wideRank = evidence === 'strong' ? 0 : evidence === 'weak' ? 1 : 2;
    return {device, facingRank, wideRank};
  });
  scored.sort((a, b) => {
    const primary = wideFirst ? a.wideRank - b.wideRank || a.facingRank - b.facingRank : a.facingRank - b.facingRank || a.wideRank - b.wideRank;
    if (primary) return primary;
    return a.device.label.localeCompare(b.device.label) || a.device.deviceId.localeCompare(b.device.deviceId);
  });
  return scored.map((entry) => entry.device);
}

/** The best rear-or-unknown device whose label carries wide evidence. */
export function wideCandidate(devices: readonly CameraDevice[], request: CameraRequest): CameraDevice | null {
  if (!wantsWide(request)) return null;
  for (const device of rankDevices(devices, request)) {
    if (labelFacing(device.label) === 'user') continue;
    const evidence = wideEvidence(device.label);
    if (evidence === 'none') continue;
    return device;
  }
  return null;
}

export type AcquisitionStep =
  | {kind: 'device'; deviceId: string; purpose: 'explicit' | 'wide'}
  | {kind: 'facing'; purpose: 'default'};

/**
 * Bounded acquisition order: an explicit choice, then a labelled wide
 * candidate, then the plain facing request. Never more than two steps, and no
 * cycling through every lens.
 */
export function acquisitionPlan(request: CameraRequest, devices: readonly CameraDevice[]): AcquisitionStep[] {
  const steps: AcquisitionStep[] = [];
  if (request.deviceId) {
    const known = devices.some((device) => device.deviceId === request.deviceId);
    if (known) steps.push({kind: 'device', deviceId: request.deviceId, purpose: 'explicit'});
  }
  if (!steps.length) {
    const wide = wideCandidate(devices, request);
    if (wide) steps.push({kind: 'device', deviceId: wide.deviceId, purpose: 'wide'});
  }
  steps.push({kind: 'facing', purpose: 'default'});
  return steps;
}

/**
 * True when a rear wide preference cannot be resolved yet because labels are
 * only readable after permission. One discovery probe is then allowed.
 */
export function needsDiscoveryProbe(request: CameraRequest, devices: readonly CameraDevice[]): boolean {
  return wantsWide(request) && !hasLabelledDevices(devices);
}

export function buildVideoConstraints(request: CameraRequest, deviceId = ''): MediaTrackConstraints {
  // Never bind capture geometry to a presentation screen: the receiver fits
  // whatever arrives. A single ideal keeps the browser free to give a wider
  // sensor view instead of cropping to satisfy a strict aspect ratio.
  const base: MediaTrackConstraints = {
    width: {ideal: 1280},
    height: {ideal: 720},
    frameRate: {ideal: 30, max: 30},
  };
  if (deviceId) return {...base, deviceId: {exact: deviceId}};
  return {...base, facingMode: {ideal: facingModeFor(request.facing)}};
}

export type LensClassification = {
  request: CameraRequest;
  actualFacing: ActualFacing;
  actualLabel: string;
  devices: readonly CameraDevice[];
  explicit: boolean;
};

export function classifyLens(options: LensClassification): LensStatus {
  const {request, actualFacing, actualLabel, devices, explicit} = options;
  if (request.facing === 'front' || actualFacing === 'user') return 'standard';
  const evidence = wideEvidence(actualLabel);
  if (explicit) return evidence === 'none' ? 'standard' : 'wide-confirmed';
  if (evidence !== 'none') return 'wide-requested-unverified';
  if (!hasLabelledDevices(devices)) return 'unknown';
  return 'standard';
}

const LENS_WORDING: Record<LensStatus, string> = {
  'wide-confirmed': 'Rear wide camera',
  'wide-requested-unverified': 'Rear camera · wide requested, not verified',
  standard: 'Rear camera · wide lens unavailable in this browser',
  unknown: 'Rear camera · lens type not identified',
};

export function describeLens(status: LensStatus): string {
  return LENS_WORDING[status];
}

/** Honest one-line description of what actually opened. */
export function describeCamera(selection: Pick<CameraSelection, 'requested' | 'actualFacing' | 'lensStatus'>): string {
  const {requested, actualFacing, lensStatus} = selection;
  if (actualFacing === 'user') return 'Front camera';
  if (actualFacing === 'environment') return describeLens(lensStatus);
  if (requested.facing === 'front') return 'Camera · front requested, facing not confirmed';
  return lensStatus === 'unknown' ? 'Camera · rear requested, facing and lens not identified' : `Camera · rear requested, facing not confirmed · ${LENS_WORDING[lensStatus].split(' · ')[1] ?? 'lens not identified'}`;
}

/** Neutral display name. Numbering is UI only and never used for classification. */
export function deviceLabel(device: CameraDevice, index: number): string {
  return device.label.trim() || `Camera ${index + 1}`;
}

export function applyRequest(base: CameraRequest, patch: Partial<CameraRequest>): CameraRequest {
  return {...base, ...patch};
}

export function parsePreference(raw: string | null | undefined): CameraRequest {
  if (!raw) return {...CAMERA_REQUEST_DEFAULTS};
  try {
    const value = JSON.parse(raw) as {facing?: unknown; lens?: unknown};
    return {
      facing: value.facing === 'rear' ? 'rear' : 'front',
      lens: value.lens === 'prefer-wide' ? 'prefer-wide' : 'default',
      deviceId: '',
    };
  } catch {
    return {...CAMERA_REQUEST_DEFAULTS};
  }
}

export type PreferenceStorage = {getItem(key: string): string | null; setItem(key: string, value: string): void};

export function loadPreference(storage: PreferenceStorage | null | undefined): CameraRequest {
  if (!storage) return {...CAMERA_REQUEST_DEFAULTS};
  try {
    return parsePreference(storage.getItem(CAMERA_PREFERENCE_KEY));
  } catch {
    return {...CAMERA_REQUEST_DEFAULTS};
  }
}

export function savePreference(storage: PreferenceStorage | null | undefined, request: CameraRequest): void {
  if (!storage) return;
  try {
    storage.setItem(CAMERA_PREFERENCE_KEY, JSON.stringify({facing: request.facing, lens: request.lens}));
  } catch {
    // Private browsing or a full quota must not break camera start.
  }
}

/** localStorage when it is usable, otherwise null. */
export function browserPreferenceStore(): PreferenceStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
