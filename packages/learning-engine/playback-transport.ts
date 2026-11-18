import type {Playback} from './playback';
import type {PracticeTransport, PracticeTransportSnapshot} from './practice-transport';

/**
 * Body adapter. `Playback` is the single advancing clock in this transport;
 * the runtime drives it through `advance` and never owns a second timer.
 */
export function createPlaybackTransport(player: Playback): PracticeTransport {
  return {
    snapshot(): PracticeTransportSnapshot {
      const state = player.state;
      return {
        time: state.time,
        duration: player.duration,
        playing: state.playing,
        ready: true,
        buffering: false,
        ended: state.time >= player.duration - 1e-6 && !state.playing,
        rate: state.speed,
        error: '',
        mode: state.mode,
        calibrating: state.calibrating,
      };
    },
    play() { player.play(); },
    pause() { player.pause(); },
    seek(seconds) { player.seek(seconds); },
    setRate(rate) { player.speed(rate); },
    setMode(mode) { player.mode(mode); },
    subscribe(listener) { return player.subscribe(listener); },
    advance(delta) { player.tick(delta); },
  };
}
