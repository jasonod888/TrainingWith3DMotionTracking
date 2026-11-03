import type { Section } from '../../../packages/lesson-schema/index';
import type { Playback } from '../../../packages/learning-engine/playback';

/** Selection refers to an actual lesson section, including the final remainder. */
export function sectionPreviewRange(sections: Section[], index: number) {
  return { ...sections[index], index };
}

export function playSectionPreview(player: Playback, index: number) {
  if (player.state.playing) { player.command('pause'); return; }
  const range = sectionPreviewRange(player.sections, index);
  const position = player.state.time >= range.start && player.state.time < range.end - 1e-7 ? player.state.time : range.start;
  player.mode('sections'); player.seek(position);
  player.state.index = range.index;
  player.command('play');
}

/** Every preview input stays within the selected section once boundaries exist. */
export function clampSectionPreview(sections: Section[], index: number, time: number) {
  const range = sectionPreviewRange(sections, index);
  return Math.max(range.start, Math.min(range.end, time));
}
