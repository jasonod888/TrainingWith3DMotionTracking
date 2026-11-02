// Server-controlled camera setup policy.
//
// The operator switch lives in the API (`CAMERA_CALIBRATION_ENABLED`) and reaches
// the client through `/api/capabilities`. This is a temporary testing aid: when
// guidance is off, the app skips the guided setup surface, uses the default
// instructor alignment and does not claim height matching anywhere.
//
// Reading is synchronous and defaults to *enabled*. A missing field, an older
// server, a failed request or a malformed payload all keep the real flow, so the
// bypass can never appear by accident.

export type SetupPolicy = {calibrationEnabled: boolean};

/** Alignment used when height matching is switched off. */
export const DEFAULT_CALIBRATION = {height: 0.7, floor: 0.9, center: 0.5} as const;

let policy: SetupPolicy = {calibrationEnabled: true};
let pending: Promise<void> | null = null;

export function setupPolicy(): SetupPolicy {
  return policy;
}

export function calibrationEnabled(): boolean {
  return policy.calibrationEnabled;
}

/** Test seam: apply a policy without a network round trip. */
export function applySetupPolicy(value: Partial<SetupPolicy>): void {
  policy = {...policy, ...value};
}

export function normaliseCapabilities(value: unknown): SetupPolicy {
  const source = value && typeof value === 'object' ? (value as {camera_calibration?: unknown}) : null;
  // Only an explicit `false` disables the flow.
  return {calibrationEnabled: source?.camera_calibration !== false};
}

export function loadSetupPolicy(): Promise<void> {
  if (pending) return pending;
  pending = fetch('/api/capabilities', {credentials: 'same-origin'})
    .then(response => (response.ok ? response.json() : null))
    .then(value => {
      policy = normaliseCapabilities(value);
    })
    .catch(() => {
      policy = {calibrationEnabled: true};
    });
  return pending;
}
