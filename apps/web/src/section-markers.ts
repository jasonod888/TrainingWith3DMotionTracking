import { splitSection, mergeNext, validateSections, type Section } from '../../../packages/lesson-schema/index';

// The first section begins implicitly at zero; only internal boundaries are markers.
const numbered = (sections: Section[]) => sections.map((s, i) => ({ ...s, label: /^\d+$/.test(s.label) ? String(i + 1) : s.label }));
export function initialMarkers(sections: Section[]): Section[] {
  return numbered(sections.map(s => ({ ...s, label: sections.length === 1 && /^(Full movement|Full sequence)$/i.test(s.label) ? '1' : s.label })));
}
const markerGap = (fps: number) => Math.max(1, Math.ceil(.05 * fps)) / fps;
function markerPlacement(sections: Section[], time: number, fps: number) {
  const at = Math.round(time * fps) / fps, gap = markerGap(fps);
  const index = sections.findIndex(s => at - s.start >= gap - 1e-6 && s.end - at >= gap - 1e-6);
  return index < 0 ? null : { time: at, index };
}
export function newMarkerTime(sections: Section[], time: number, fps: number): number | null {
  return markerPlacement(sections, time, fps)?.time ?? null;
}
export function addMarker(sections: Section[], duration: number, time: number, id: string, fps: number) {
  const placement = markerPlacement(sections, time, fps);
  if (!placement) throw new Error('Move the blue line inside a section to add a marker.');
  const { time: at, index } = placement, next = splitSection(sections, duration, at, id);
  next[index + 1].label = String(index + 2);
  return { sections: numbered(next), selected: index + 1, time: at };
}
export function markerBounds(sections: Section[], index: number, fps: number) {
  if (index === 0) return { min: 0, max: 0 };
  const gap = markerGap(fps);
  return {
    min: Math.ceil((sections[index - 1].start + gap - 1e-7) * fps) / fps,
    max: Math.floor((sections[index].end - gap + 1e-7) * fps) / fps
  };
}
export function moveMarker(sections: Section[], duration: number, index: number, time: number, fps: number) {
  if (index <= 0 || index >= sections.length) return sections.map(s => ({ ...s }));
  const bounds = markerBounds(sections, index, fps);
  const at = Math.max(bounds.min, Math.min(bounds.max, Math.round(time * fps) / fps));
  const next = sections.map(s => ({ ...s })); next[index].start = at; next[index - 1].end = at;
  return validateSections(next, duration);
}
export function removeMarker(sections: Section[], duration: number, index: number) {
  if (index <= 0 || index >= sections.length) throw new Error('The first marker is the start of the move.');
  return numbered(mergeNext(sections, duration, index - 1));
}
