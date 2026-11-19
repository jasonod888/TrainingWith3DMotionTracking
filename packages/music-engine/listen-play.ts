/**
 * Listen-then-play timing contract. The learner listens to the reference section,
 * waits through an acoustic guard and a visual count-in, then performs the same
 * section without reference audio. All policy intervals are declared in real
 * seconds and converted to source seconds using the selected practice speed.
 */
export type ListenPlaySection = {start:number; end:number};
export type ListenPlayConfig = {
  section:ListenPlaySection;
  speed:number;
  /** Real seconds after reference audio stops before the count-in begins. */
  guardSeconds?:number;
  /** Visual count-in; no audible cue is played during an assessed microphone interval. */
  countInSeconds?:number;
  /** Real seconds of permitted anticipation captured before the guide sweep starts. */
  earlyStartSeconds?:number;
  /** Real seconds of permitted late start after the guide has passed the section end. */
  lateStartSeconds?:number;
  /** Extra real seconds recorded for sustain/decoder tails. */
  tailSeconds?:number;
  maxCaptureSeconds?:number;
};
export type ListenPlayTimeline = {
  speed:number;
  listenStart:number;
  listenEnd:number;
  guardEnd:number;
  countInEnd:number;
  captureStart:number;
  captureEnd:number;
  captureGuideStart:number;
  captureGuideEnd:number;
  captureDuration:number;
  totalDuration:number;
};
export type ListenPlayPhase = 'listening' | 'acoustic-guard' | 'count-in' | 'capturing' | 'analyzing';

export const DEFAULT_LISTEN_PLAY = Object.freeze({
  guardSeconds:0.25,
  countInSeconds:3,
  earlyStartSeconds:1.5,
  lateStartSeconds:1.5,
  tailSeconds:0.75,
  maxCaptureSeconds:3600,
});

function finite(value:unknown):value is number { return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value:unknown, name:string, maximum:number):number {
  if (!finite(value) || value < 0 || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}

export function listenPlayTimeline(config:ListenPlayConfig):ListenPlayTimeline {
  if (!config || typeof config !== 'object') throw new Error('Missing listen-then-play configuration.');
  const {section} = config;
  if (!section || !finite(section.start) || !finite(section.end) || section.start < 0 || section.end <= section.start) throw new Error('Invalid listen-then-play section.');
  if (!finite(config.speed) || config.speed <= 0 || config.speed > 4) throw new Error('Invalid listen-then-play speed.');
  const guard = nonnegative(config.guardSeconds ?? DEFAULT_LISTEN_PLAY.guardSeconds, 'acoustic guard', 10);
  const countIn = nonnegative(config.countInSeconds ?? DEFAULT_LISTEN_PLAY.countInSeconds, 'count-in', 60);
  const early = nonnegative(config.earlyStartSeconds ?? DEFAULT_LISTEN_PLAY.earlyStartSeconds, 'early-start allowance', 30);
  const late = nonnegative(config.lateStartSeconds ?? DEFAULT_LISTEN_PLAY.lateStartSeconds, 'late-start allowance', 30);
  const tail = nonnegative(config.tailSeconds ?? DEFAULT_LISTEN_PLAY.tailSeconds, 'capture tail', 10);
  const maxCapture = nonnegative(config.maxCaptureSeconds ?? DEFAULT_LISTEN_PLAY.maxCaptureSeconds, 'capture limit', 7200);
  const listenEnd = (section.end - section.start) / config.speed;
  const guardEnd = listenEnd + guard;
  const countInEnd = guardEnd + countIn;
  const captureStart = countInEnd;
  const captureGuideStart = section.start - early * config.speed;
  const captureGuideEnd = section.end + (late + tail) * config.speed;
  const captureDuration = (captureGuideEnd - captureGuideStart) / config.speed;
  if (!finite(captureDuration) || captureDuration <= 0 || captureDuration > maxCapture) throw new Error('The capture window exceeds the supported limit.');
  const timeline:ListenPlayTimeline = {
    speed:config.speed,
    listenStart:0,
    listenEnd,
    guardEnd,
    countInEnd,
    captureStart,
    captureEnd:captureStart + captureDuration,
    captureGuideStart,
    captureGuideEnd,
    captureDuration,
    totalDuration:countInEnd + captureDuration,
  };
  if (!Object.values(timeline).every(finite)) throw new Error('Invalid listen-then-play timing.');
  return timeline;
}

/** Source-seconds span that the recording is expected to cover. */
export function listenPlayCaptureSpan(timeline:ListenPlayTimeline):{start:number; end:number} {
  return {start:timeline.captureGuideStart, end:timeline.captureGuideEnd};
}

/** Real elapsed seconds from the start of the listen phase to the phase boundary. */
export function listenPlayPhaseAt(timeline:ListenPlayTimeline, elapsedSeconds:number):ListenPlayPhase {
  if (!finite(elapsedSeconds) || elapsedSeconds < 0) throw new Error('Invalid listen-then-play elapsed time.');
  if (elapsedSeconds < timeline.listenEnd) return 'listening';
  if (elapsedSeconds < timeline.guardEnd) return 'acoustic-guard';
  if (elapsedSeconds < timeline.countInEnd) return 'count-in';
  if (elapsedSeconds < timeline.captureEnd) return 'capturing';
  return 'analyzing';
}

/** Source guide time at a real elapsed capture offset; negative values are legal. */
export function listenPlayGuideTime(timeline:ListenPlayTimeline, elapsedSeconds:number):number {
  if (!finite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > timeline.captureDuration + 1e-9) throw new Error('Invalid capture elapsed time.');
  return timeline.captureGuideStart + timeline.speed * elapsedSeconds;
}

export function listenPlayCaptureRemaining(timeline:ListenPlayTimeline, elapsedSeconds:number):number {
  return Math.max(0, timeline.captureEnd - Math.max(timeline.captureStart, elapsedSeconds));
}
