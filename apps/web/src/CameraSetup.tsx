// Guided camera setup presentation. Silent flow only: no audio, no session
// ownership. Geometry is positioned in the animation loop from the same display
// transform that places the video, so the guide can never drift into the
// letterbox margins.

import {useEffect, useId, useRef} from 'react';
import type {DisplayTransform} from './camera-framing';
import {GUIDE_DEFAULTS, boxFromOutline, guideBox, rectForBox} from './camera-setup-guide';
import type {CameraSetupController, SetupIssue, SetupSnapshot} from './camera-setup-controller';
import {deviceLabel, type CameraDevice, type CameraRequest} from './camera-policy';

const ISSUE_TEXT: Record<SetupIssue, string> = {
  person_missing: 'Stand in front of the camera.',
  invalid_evidence: 'Waiting for a clear picture…',
  tracking_lost: "I can't see you clearly. Step back into view.",
  too_large: 'Step back so your head and feet are visible.',
  head_missing: 'Keep your head inside the camera picture.',
  feet_missing: "I can't see both feet. Step back a little, or adjust the camera.",
  too_small: 'Step a little closer, keeping your head and feet visible.',
  hands_missing: 'Let your arms rest slightly away from your sides.',
  edge_risk: 'Step back so your whole body fits in the picture.',
  standing_required: 'Face the camera and stand upright with your arms relaxed.',
  off_center: 'Move towards the centre of the guide.',
  unstable: "Hold still for a moment, and we'll try again.",
};

function readyNote(intent: string | null): string {
  if (intent === 'start_compete') return 'Your scored run starts in five seconds.';
  if (intent === 'setup_only') return 'Choose Play when you are ready.';
  return 'Practice starts in five seconds.';
}

export type CameraSetupProps = {
  controller: CameraSetupController;
  getTransform: () => DisplayTransform | null;
  onBack: () => void;
  onCancel: () => void;
  onRetrySetup: () => void;
  onRetryCamera: () => void;
  onConfirmControls: () => void;
  showControlsConfirmation: boolean;
  /** Preparation stage: front/rear, wide preference and exposed devices. */
  cameraRequest: CameraRequest;
  cameras: CameraDevice[];
  cameraNote: string;
  onSelectCamera: (request: CameraRequest) => void;
  onStartCamera: () => void;
  onRefreshCameras: () => void;
};

function GuideFigure({className}: {className: string}) {
  return (
    <g className={className}>
      <circle cx="50" cy="21" r="12"/>
      <rect x="36" y="34" width="28" height="60" rx="13"/>
      <rect x="20" y="40" width="11" height="72" rx="5.5" transform="rotate(9 25.5 76)"/>
      <rect x="69" y="40" width="11" height="72" rx="5.5" transform="rotate(-9 74.5 76)"/>
      <rect x="35" y="88" width="16" height="106" rx="7"/>
      <rect x="49" y="88" width="16" height="106" rx="7"/>
      <ellipse cx="43" cy="194" rx="11" ry="5"/>
      <ellipse cx="57" cy="194" rx="11" ry="5"/>
    </g>
  );
}

function instructionFor(snapshot: SetupSnapshot): string {
  if (snapshot.stage === 'measuring') return 'Hold still while we match your height.';
  if (snapshot.issue) return ISSUE_TEXT[snapshot.issue];
  return 'Hold your position…';
}

export function CameraSetup({
  controller,
  getTransform,
  onBack,
  onCancel,
  onRetrySetup,
  onRetryCamera,
  onConfirmControls,
  showControlsConfirmation,
  cameraRequest,
  cameras,
  cameraNote,
  onSelectCamera,
  onStartCamera,
  onRefreshCameras,
}: CameraSetupProps) {
  const snapshot = controller.snapshot;
  const guide = useRef<SVGSVGElement>(null);
  const fill = useRef<SVGRectElement>(null);
  const clipId = `setup-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const accepted = snapshot.stage === 'ready' || snapshot.stage === 'handoff' || snapshot.stage === 'measuring';

  // Geometry lives here, not in React state: the transform changes every frame.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = guide.current;
      if (!element) return;
      const transform = getTransform();
      if (!transform) return;
      const current = controller.snapshot;
      const outline = current.outline ? boxFromOutline(current.outline) : null;
      const box = outline ?? guideBox({
        videoWidth: transform.sourceWidth,
        videoHeight: transform.sourceHeight,
        heightFraction: GUIDE_DEFAULTS.heightFraction,
      });
      const rect = rectForBox(transform, box);
      element.style.left = `${rect.x}px`;
      element.style.top = `${rect.y}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.dataset.accepted = String(current.stage === 'measuring' || current.stage === 'ready' || current.stage === 'handoff');
      const progress = Math.max(0, Math.min(1, current.progress));
      if (fill.current) {
        fill.current.setAttribute('y', String(200 - 200 * progress));
        fill.current.setAttribute('height', String(200 * progress));
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [controller, getTransform]);

  const stage = snapshot.stage;
  const measuring = stage === 'measuring';
  const showGuide = stage === 'positioning' || stage === 'measuring' || stage === 'ready' || stage === 'handoff';

  return (
    <div className="camera-setup" data-stage={stage ?? 'none'} role="group" aria-label="Camera setup">
      {stage === 'prepare' && (
        <div className="camera-setup-card" role="group" aria-label="Choose a camera">
          <h2>Choose your camera</h2>
          <p>A rear wide lens shows more of the room, so you can move further sideways before leaving the picture.</p>
          <div className="camera-setup-choices">
            <button
              className="camera-setup-action secondary"
              aria-pressed={cameraRequest.facing === 'front' && !cameraRequest.deviceId}
              onClick={() => onSelectCamera({...cameraRequest, facing: 'front', deviceId: ''})}
            >
              Front camera
            </button>
            <button
              className="camera-setup-action secondary"
              aria-pressed={cameraRequest.facing === 'rear' && !cameraRequest.deviceId}
              onClick={() => onSelectCamera({...cameraRequest, facing: 'rear', deviceId: ''})}
            >
              Rear camera
            </button>
          </div>
          {cameraRequest.facing === 'rear' && !cameraRequest.deviceId && (
            <label>
              <input
                type="checkbox"
                checked={cameraRequest.lens === 'prefer-wide'}
                onChange={(event) => onSelectCamera({...cameraRequest, lens: event.target.checked ? 'prefer-wide' : 'default'})}
              />
              <span>Prefer a wide rear lens. This is best effort: some browsers expose only one rear camera.</span>
            </label>
          )}
          {cameras.length > 0 && (
            <label>
              Camera
              <select value={cameraRequest.deviceId} onChange={(event) => onSelectCamera({...cameraRequest, deviceId: event.target.value})}>
                <option value="">Automatic ({cameraRequest.facing === 'rear' ? 'rear' : 'front'})</option>
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId} value={camera.deviceId}>{deviceLabel(camera, index)}</option>
                ))}
              </select>
            </label>
          )}
          {cameraNote && <p className="camera-setup-meta" role="status">{cameraNote}</p>}
          <div className="camera-setup-actions">
            <button className="camera-setup-action primary" onClick={onStartCamera}>Start camera</button>
            <button className="camera-setup-action secondary" onClick={onCancel}>Cancel</button>
          </div>
          <p className="camera-setup-meta">
            Next: stand in the outline and hold still while your height is matched. {cameras.length > 0 ? 'Cameras marked Automatic are chosen for you; a named camera overrides that until you choose Automatic again.' : 'Allow camera access to list every camera this browser exposes.'}
          </p>
          {cameras.length > 0 && <button className="camera-setup-action secondary" onClick={onRefreshCameras}>Refresh camera list</button>}
        </div>
      )}

      {stage === 'starting' && (
        <div className="camera-setup-card">
          <h2>Starting your camera…</h2>
          <p>Allow camera access if your browser asks. Nothing is recorded.</p>
          <div className="camera-setup-actions">
            <button className="camera-setup-action secondary" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      {showGuide && (
        <svg ref={guide} className="camera-setup-guide" viewBox="0 0 100 200" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect ref={fill} x="0" y="200" width="100" height="0"/>
            </clipPath>
          </defs>
          <line className="setup-axis" x1="50" y1="0" x2="50" y2="200"/>
          <GuideFigure className="setup-outline"/>
          <g clipPath={`url(#${clipId})`}>
            <GuideFigure className="setup-fill-shape"/>
          </g>
          <circle className="setup-region" data-state={snapshot.regions.head ? 'ok' : 'missing'} cx="50" cy="21" r="15"/>
          <circle className="setup-region" data-state={snapshot.regions.hands ? 'ok' : 'missing'} cx="25" cy="110" r="9"/>
          <circle className="setup-region" data-state={snapshot.regions.hands ? 'ok' : 'missing'} cx="75" cy="110" r="9"/>
          <ellipse className="setup-region" data-state={snapshot.regions.feet ? 'ok' : 'missing'} cx="43" cy="192" rx="12" ry="8"/>
          <ellipse className="setup-region" data-state={snapshot.regions.feet ? 'ok' : 'missing'} cx="57" cy="192" rx="12" ry="8"/>
        </svg>
      )}

      {(stage === 'positioning' || measuring) && (
        <>
          <div className="camera-setup-top">
            <p className="camera-setup-eyebrow">Camera setup</p>
            <p className="camera-setup-instruction" aria-live="polite">{instructionFor(snapshot)}</p>
          </div>
          <div className="camera-setup-bottom">
            <ul className="camera-setup-checklist" aria-label="Body check">
              <li data-state={snapshot.regions.head ? 'ok' : 'missing'}><span className="camera-setup-tick" aria-hidden="true">{snapshot.regions.head ? '✓' : '○'}</span>Head</li>
              <li data-state={snapshot.regions.hands ? 'ok' : 'missing'}><span className="camera-setup-tick" aria-hidden="true">{snapshot.regions.hands ? '✓' : '○'}</span>Hands</li>
              <li data-state={snapshot.regions.feet ? 'ok' : 'missing'}><span className="camera-setup-tick" aria-hidden="true">{snapshot.regions.feet ? '✓' : '○'}</span>Feet</li>
            </ul>
            {measuring ? (
              <div className="camera-setup-progress">
                <span>{snapshot.positionFound ? 'Matching height' : 'Hold still'}</span>
                <progress aria-label="Height matching progress" value={Math.round(snapshot.progress * 100)} max={100}>{Math.round(snapshot.progress * 100)}%</progress>
                <span>{Math.round(snapshot.progress * 100)}%</span>
              </div>
            ) : (
              <p className="camera-setup-meta">Two clear steps: stand inside the outline, then hold still.</p>
            )}
            <div className="camera-setup-actions">
              <button className="camera-setup-action secondary" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {(stage === 'ready' || stage === 'handoff') && (
        <>
          <div className="camera-setup-ready" role="status">
            <span className="camera-setup-check" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg>
            </span>
            <strong>Camera ready</strong>
            <p className="camera-setup-meta">{readyNote(snapshot.intent)}</p>
          </div>
          <div className="camera-setup-bottom">
            <div className="camera-setup-actions">
              <button className="camera-setup-action secondary" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        </>
      )}

      {(stage === 'help' || stage === 'error') && (
        <div className="camera-setup-card" role="alert">
          <h2>{stage === 'error' ? 'Camera not available' : snapshot.help.reason === 'slow_measurement' ? "We couldn't match your height" : snapshot.help.reason === 'controls_unconfirmed' ? 'Confirm your display' : 'Having trouble positioning?'}</h2>
          <p>
            {stage === 'error'
              ? snapshot.failure === 'permission_denied'
                ? 'Camera access is needed for setup. Allow it in your browser, then try again.'
                : snapshot.failure === 'no_camera'
                  ? 'No camera was found on this device.'
                  : snapshot.failure === 'insecure_context'
                    ? 'Camera access needs HTTPS or localhost.'
                    : 'The camera or pose tracking stopped. Try again, or exit and watch the instructor.'
              : snapshot.help.reason === 'slow_measurement'
                ? 'The camera could not see you clearly enough for long enough. Check your lighting, step back, and keep your whole body in view.'
                : snapshot.help.reason === 'controls_unconfirmed'
                  ? 'This is the rear camera. Confirm you can see this screen and reach the controls, then continue.'
                  : 'A few adjustments usually help: stand further back, face a light, and lower the camera to chest height.'}
          </p>
          {stage === 'help' && snapshot.help.reason === 'controls_unconfirmed' && showControlsConfirmation && (
            <label>
              <input type="checkbox" checked={Boolean(snapshot.requirements?.controlsConfirmed)} onChange={onConfirmControls}/>
              <span>I can see the instructor and operate the controls on this screen.</span>
            </label>
          )}
          <div className="camera-setup-actions">
            <button className="camera-setup-action primary" onClick={stage === 'error' ? onRetryCamera : onRetrySetup}>Try again</button>
            <button className="camera-setup-action secondary" onClick={onBack}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}
