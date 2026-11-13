/**
 * Generates a real workspace save body for the cross-language contract test.
 * argv[2] is JSON: {events, duration, draftId, referenceSha256, baseRevisionId, spans, sections}
 */
import {buildNotation, estimatedAlignment, secondsToTick} from '../../packages/music-notation/index.ts';
import {buildSaveBody} from '../../apps/web/src/music/workspace/save-payload.ts';

const input = JSON.parse(process.argv[2]);
const document = buildNotation(input.events.map((event: any) => ({
  id: event.id, onset: event.onset, duration: event.duration, pitch: event.pitch,
  velocity: event.velocity ?? null, confidence: event.confidence ?? null, optional: Boolean(event.optional),
  string: null, fret: null, notation_duration: event.notation_duration ?? null,
})), {duration: input.duration});
const base = estimatedAlignment(document);
const anchorSeconds = Math.min(1, input.duration / 2);
const body = buildSaveBody({
  title: 'Cross-language workspace save',
  document,
  spans: input.spans,
  alignment: base,
  anchors: [{seconds: anchorSeconds, tick: secondsToTick(base, anchorSeconds)}],
  offsetSeconds: 0.25,
  draftId: input.draftId,
  referenceSha256: input.referenceSha256,
  baseRevisionId: input.baseRevisionId ?? null,
  sections: input.sections,
});
process.stdout.write(JSON.stringify(body));
