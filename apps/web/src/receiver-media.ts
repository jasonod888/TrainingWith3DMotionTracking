// Receiver media state: "paired" and "live video" are different facts.
//
// An incoming track, or a successful pairing, is not proof that current frames
// are being displayed. This reducer keeps that distinction explicit so the
// receiver can never label a frozen or absent image as live.

export type MediaState = 'off' | 'starting' | 'live' | 'interrupted' | 'failed';

export type MediaSignal =
  | {type: 'track'}
  | {type: 'metadata'}
  | {type: 'frame'; at?: number}
  | {type: 'stall'; at?: number}
  | {type: 'track-ended'}
  | {type: 'autoplay-blocked'}
  | {type: 'connection'; state: string}
  | {type: 'reset'};

export const RECEIVER_MEDIA_DEFAULTS = {
  /** No decoded frame for this long means the picture is no longer live. */
  frameTimeoutMs: 1500,
};

export function nextMediaState(state: MediaState, signal: MediaSignal): MediaState {
  switch (signal.type) {
    case 'reset':
      return 'off';
    case 'track-ended':
      return 'off';
    case 'track':
      return 'starting';
    case 'metadata':
      return state === 'live' ? 'live' : 'starting';
    case 'frame':
      return 'live';
    case 'stall':
      return state === 'live' || state === 'starting' ? 'interrupted' : state;
    case 'autoplay-blocked':
      return 'interrupted';
    case 'connection':
      if (signal.state === 'failed' || signal.state === 'closed') return 'failed';
      if (signal.state === 'disconnected') return 'interrupted';
      if (signal.state === 'connecting' || signal.state === 'new') return state === 'off' ? 'starting' : state;
      // "connected" describes the transport, not the picture.
      return state;
    default:
      return state;
  }
}

export function mediaIsLive(state: MediaState): boolean {
  return state === 'live';
}

export function frameIsFresh(lastFrameAt: number, now: number, timeout = RECEIVER_MEDIA_DEFAULTS.frameTimeoutMs): boolean {
  if (!Number.isFinite(lastFrameAt) || !Number.isFinite(now)) return false;
  return now - lastFrameAt <= timeout;
}

/** Receiver-facing media wording. Never claims live without proof. */
export function mediaLabel(state: MediaState): string {
  switch (state) {
    case 'starting':
      return 'Camera connecting…';
    case 'live':
      return 'Camera live';
    case 'interrupted':
      return 'Camera interrupted';
    case 'failed':
      return 'Camera connection failed';
    default:
      return 'Camera off';
  }
}

/**
 * A display can be paired and approved while media is absent, connecting,
 * interrupted or failed. Only `live` may be presented as a current picture.
 */
export function displayLabel(approved: boolean, pending: boolean, media: MediaState): string {
  if (!approved) return pending ? 'Waiting for approval on the camera device' : 'Not connected';
  return mediaLabel(media);
}
