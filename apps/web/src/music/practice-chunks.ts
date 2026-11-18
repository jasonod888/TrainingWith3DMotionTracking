import {
  tickToEffectiveSeconds, type Alignment, type Measure as NotationMeasure,
} from '../../../../packages/music-notation/index.ts';

export type ChunkBarsOption = 0 | 1 | 2 | 4;

export type PracticeChunk = {
  index: number;
  label: string;
  start: number;
  end: number;
  measureStart: number;
  measureEnd: number;
};

export type PracticeVoiceCommand = 'next' | 'back' | 'again' | 'play' | 'pause';

export function buildPracticeChunks(
  measures: readonly NotationMeasure[],
  alignment: Alignment | null | undefined,
  offsetSeconds: number,
  duration: number,
  barsPerChunk: ChunkBarsOption,
): PracticeChunk[] {
  if (!barsPerChunk || !measures.length || !alignment || duration <= 0) return [];
  const chunks: PracticeChunk[] = [];
  for (let i = 0; i < measures.length; i += barsPerChunk) {
    const first = measures[i];
    const last = measures[Math.min(measures.length - 1, i + barsPerChunk - 1)];
    const start = Math.max(0, Math.min(duration,
      tickToEffectiveSeconds(alignment, first.start, offsetSeconds)));
    const end = Math.max(start, Math.min(duration,
      tickToEffectiveSeconds(alignment, last.start + last.duration, offsetSeconds)));
    if (end - start > 0.05) {
      chunks.push({
        index: chunks.length,
        label: first.index === last.index
          ? `Bar ${first.index + 1}`
          : `Bars ${first.index + 1}–${last.index + 1}`,
        start,
        end,
        measureStart: first.index + 1,
        measureEnd: last.index + 1,
      });
    }
  }
  return chunks;
}

export function chunkAtTime(chunks: readonly PracticeChunk[], seconds: number): number {
  if (!chunks.length) return 0;
  const inside = chunks.findIndex(chunk => seconds >= chunk.start && seconds < chunk.end - 0.01);
  if (inside >= 0) return inside;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    if (chunks[index].start <= seconds) return index;
  }
  return 0;
}

export function parseVoiceCommand(transcript: string): PracticeVoiceCommand | null {
  const text = transcript.toLowerCase().trim();
  if (/\b(next|skip|forward)\b/.test(text)) return 'next';
  if (/\b(back|previous)\b/.test(text)) return 'back';
  if (/\b(again|repeat|replay)\b/.test(text)) return 'again';
  if (/\b(play|resume|start|go)\b/.test(text)) return 'play';
  if (/\b(pause|stop|wait|hold)\b/.test(text)) return 'pause';
  return null;
}
