// Receiver presentation policy: how a comparison surface adapts to whatever
// viewport it actually has.
//
// The unit is the measured comparison container, never the phone's dimensions,
// the advertised screen resolution or a hard-coded 16:9. The camera pane keeps
// the complete source image; the instructor gets its own pane. Portrait stacks.
//
// Pure so the viewport matrix can be tested without a browser.

export type CompareAxis = 'columns' | 'rows';

export type CompareLayout = {
  axis: CompareAxis;
  /** Fraction of the comparison area given to the live camera. */
  cameraShare: number;
  instructorShare: number;
  /** Measured pixel box the camera pane occupies. */
  cameraPaneWidth: number;
  cameraPaneHeight: number;
  /** False while a container is zero-sized (mount, fullscreen transition). */
  usable: boolean;
  /** True when the camera pane got the main area instead of its split share. */
  takeover: boolean;
};

export const RECEIVER_LAYOUT_DEFAULTS = {
  /** At or above this width/height ratio the panes sit side by side. */
  landscapeRatio: 1.2,
  /** Preliminary split: the camera is the subject, the instructor the guide. */
  cameraShare: 0.6,
  /** Below this a pane stops being legible, so the share is clamped. */
  minPanePx: 120,
};

export type LayoutOptions = {
  landscapeRatio?: number;
  cameraShare?: number;
  minPanePx?: number;
  /** Camera gets the main area during positioning and height matching. */
  takeover?: boolean;
};

export function compareLayout(width: number, height: number, options: LayoutOptions = {}): CompareLayout {
  const ratio = options.landscapeRatio ?? RECEIVER_LAYOUT_DEFAULTS.landscapeRatio;
  const preferred = options.cameraShare ?? RECEIVER_LAYOUT_DEFAULTS.cameraShare;
  const minPane = options.minPanePx ?? RECEIVER_LAYOUT_DEFAULTS.minPanePx;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const usable = w >= minPane && h >= minPane;
  const axis: CompareAxis = w >= h * ratio ? 'columns' : 'rows';
  const main = axis === 'columns' ? w : h;
  let cameraShare = Math.min(Math.max(preferred, 0.05), 0.95);
  if (main < minPane * 2) cameraShare = 0.5;
  else cameraShare = Math.min(Math.max(preferred, minPane / main), 1 - minPane / main);
  const takeover = options.takeover === true;
  const share = takeover ? 1 : cameraShare;
  return {
    axis,
    cameraShare: share,
    instructorShare: 1 - share,
    cameraPaneWidth: axis === 'columns' ? w * share : w,
    cameraPaneHeight: axis === 'rows' ? h * share : h,
    usable,
    takeover,
  };
}

export type SetupPresentation = 'idle' | 'takeover' | 'compare';

/**
 * Positioning and height matching give the camera the main area so the person
 * can act on large instructions. As soon as the camera is ready the instructor
 * returns, before the handoff countdown, so practice never starts unseen.
 */
export function setupPresentation(phase: string | null | undefined): SetupPresentation {
  switch (phase) {
    case 'prepare':
    case 'starting':
    case 'positioning':
    case 'measuring':
    case 'help':
    case 'error':
      return 'takeover';
    case 'ready':
    case 'handoff':
      return 'compare';
    default:
      return 'idle';
  }
}

const SETUP_HINT_COPY: Record<string, string> = {
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
  unstable: 'Hold still for a moment, and we will try again.',
};

/** Receiver-facing hint. Unknown codes stay vague rather than inventing state. */
export function setupHintCopy(code: string | null | undefined): string {
  if (!code) return '';
  return SETUP_HINT_COPY[code] ?? 'Hold your position…';
}

export function setupProgress(phase: string | null | undefined, progress: number): number {
  if (phase !== 'measuring' && phase !== 'ready' && phase !== 'handoff') return 0;
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

export function setupHeadline(phase: string | null | undefined): string {
  switch (phase) {
    case 'prepare':
    case 'starting':
      return 'Starting your camera';
    case 'positioning':
      return 'Step into the outline';
    case 'measuring':
      return 'Hold still while we match your height';
    case 'ready':
      return 'Camera ready';
    case 'handoff':
      return 'Get ready';
    case 'help':
      return 'Having trouble positioning?';
    case 'error':
      return 'Camera not available';
    default:
      return '';
  }
}
