import {useEffect, useMemo, useState} from 'react';
import type {Alignment, HandAssignment, Interval, NotationDocument} from '../../../../../packages/music-notation/index.ts';
import {ContinuousScore} from './ContinuousScore';
import {PianoWaterfall} from './PianoWaterfall';
import {KeyboardEditor} from '../notation/KeyboardEditor';
import {layoutMeasures} from './viewport';
import {buildTimelineLayout, clampScroll} from './timeline-layout';
import {useElementWidth} from './useElementWidth';
import {useClockTime, type ClockStore} from './clock';
import {FULL_PIANO_MIN_WIDTH, STANDARD_PIANO_RANGE, resolveKeyboardRange, type PianoRange} from '../notation/piano-key-geometry';
import {shiftOnset} from '../piano-playback';
import {Button} from '../../ui/controls';

type PracticeViewProps = {
  document: NotationDocument;
  clock: ClockStore | null;
  alignment: Alignment | null;
  offsetSeconds: number;
  intervals: Interval[];
  activeIds: string[];
  playhead: number;
  hands: Record<string, HandAssignment>;
  onSeekOccurrence: (id: string) => void;
  onSeek: (seconds: number) => void;
};

export type PracticePanel = 'notes' | 'waterfall' | 'keys';

/** Notes only: score layout, follow subscription and shared scrollbar mount here. */
export function PianoPracticeNotesView(props: PracticeViewProps) {
  const {document, clock, alignment, offsetSeconds, intervals, activeIds, playhead, onSeekOccurrence} = props;
  const boxes = useMemo(() => layoutMeasures(document).boxes, [document]);
  const layout = useMemo(() => buildTimelineLayout(document, 1), [document]);
  const [sharedRef, sharedWidth] = useElementWidth<HTMLDivElement>();
  const clockTime = useClockTime(clock, playhead);
  const [follow, setFollow] = useState(true);
  const [followSuspended, setFollowSuspended] = useState(false);
  const [sharedScrollLeft, setSharedScrollLeft] = useState(0);
  useEffect(() => {
    if (!follow || followSuspended || !alignment || sharedWidth <= 0) return;
    const x = 116 + layout.sourceSecondsToX(clockTime, alignment, offsetSeconds);
    if (x < sharedScrollLeft || x > sharedScrollLeft + sharedWidth) {
      setSharedScrollLeft(clampScroll(x - sharedWidth * 0.25, layout.contentWidth + 116, sharedWidth));
    }
  }, [clockTime, follow, followSuspended, layout, alignment, offsetSeconds, sharedWidth, sharedScrollLeft]);
  return <div className="ws-shared-stage ws-notes-practice" ref={sharedRef}>
    {followSuspended && <Button variant="dock-tool" type="button" className="player-tool ws-notes-follow"
      aria-label="Resume follow" title="Return to the playhead"
      onClick={() => { setFollow(true); setFollowSuspended(false); }}>Resume follow</Button>}
    <section className="ws-score-surface" aria-label="Score">
      <ContinuousScore document={document} boxes={boxes} selectedOccurrenceId={null} reveal={null}
        playheadTick={null} clock={clock} alignment={alignment} offsetSeconds={offsetSeconds}
        intervals={intervals} activeOccurrenceIds={activeIds} onSelect={onSeekOccurrence}
        layout={layout} sharedScrollLeft={sharedScrollLeft} editingEnabled={false}/>
    </section>
    <div className="ws-shared-scrollbar" aria-label="Shared score position"
      onScroll={event => {
        setSharedScrollLeft(event.currentTarget.scrollLeft);
        if (follow) setFollowSuspended(true);
      }}>
      <div style={{width: Math.max(1, layout.contentWidth + 116), height: 1}}/>
    </div>
  </div>;
}

function usePracticePanels(document: NotationDocument, showKeys: boolean) {
  const pitches = useMemo(() => document.performance.map(note => note.pitch), [document]);
  const [keyboardRef, keyboardWidth] = useElementWidth<HTMLDivElement>();
  const [instrumentRef, instrumentWidth] = useElementWidth<HTMLElement>();
  const [range, setRange] = useState<PianoRange | null>(null);
  const width = showKeys ? keyboardWidth : instrumentWidth;
  useEffect(() => {
    if (width <= 0) return;
    setRange(width >= FULL_PIANO_MIN_WIDTH
      ? STANDARD_PIANO_RANGE
      : resolveKeyboardRange(pitches, width));
  }, [width, pitches]);
  return {keyboardRef, keyboardWidth, instrumentRef, range, setRange};
}

function PracticeKeyboard({document, activeIds, playhead, offsetSeconds, hands, onSeek, range, setRange, keyboardWidth, keyboardRef}: {
  document: NotationDocument;
  activeIds: string[];
  playhead: number;
  offsetSeconds: number;
  hands: Record<string, HandAssignment>;
  onSeek: (seconds: number) => void;
  range: PianoRange | null;
  setRange: (range: PianoRange) => void;
  keyboardWidth: number;
  keyboardRef: (node: HTMLDivElement | null) => void;
}) {
  const activePitches = activeIds.map(id => document.performance.find(note => note.id === id)?.pitch)
    .filter((pitch): pitch is number => pitch !== undefined);
  const soundingHands = useMemo(() => {
    const result: Record<number, 'left' | 'right' | 'unassigned' | 'mixed'> = {};
    for (const id of activeIds) {
      const note = document.performance.find(item => item.id === id);
      if (!note) continue;
      const hand = hands[id]?.hand ?? 'unassigned';
      result[note.pitch] = result[note.pitch] && result[note.pitch] !== hand ? 'mixed' : hand;
    }
    return result;
  }, [activeIds, document, hands]);
  return <section className="ws-keyboard-surface" aria-label="Keyboard">
    <div ref={keyboardRef}>
      <KeyboardEditor document={document} selectedPitch={null} activePitches={activePitches}
        soundingHands={soundingHands} range={range ?? undefined} onRangeChange={setRange}
        onKey={pitch => {
          const note = document.performance.find(item => item.pitch === pitch && playhead >= shiftOnset(item.onset, offsetSeconds)
            && playhead < shiftOnset(item.onset, offsetSeconds) + (item.duration ?? 0.35));
          if (note) onSeek(note.onset + offsetSeconds);
        }} width={keyboardWidth > 0 ? keyboardWidth : 960} height={140}
        hint="Tap a key to find the current note. Piano practice is unscored."/>
    </div>
  </section>;
}

/** One instrument group: optional waterfall and one shared keyboard, never duplicate keyboards. */
export function PianoPracticeInstrumentView(props: PracticeViewProps & {showWaterfall: boolean; showKeys: boolean}) {
  const {showWaterfall, showKeys} = props;
  const {document, clock, offsetSeconds, intervals, activeIds, playhead, hands, onSeekOccurrence, onSeek} = props;
  const {keyboardRef, keyboardWidth, instrumentRef, range, setRange} = usePracticePanels(document, showKeys);
  const width = showKeys ? keyboardWidth : 0;
  return <section ref={instrumentRef}
    className={`ws-instrument ${showKeys && !showWaterfall ? 'ws-keys-view' : ''} ${showWaterfall && showKeys ? 'ws-waterfall-keys' : ''}`}
    id="piano-instrument" aria-label="Piano instrument">
    {showWaterfall && <div className="ws-waterfall-slot"><PianoWaterfall document={document} clock={clock}
      intervals={intervals} range={range} selectedOccurrenceId={null}
      hands={hands} onSelect={onSeekOccurrence}/></div>}
    {showKeys && <PracticeKeyboard document={document} activeIds={activeIds} playhead={playhead}
      offsetSeconds={offsetSeconds} hands={hands} onSeek={onSeek} range={range}
      setRange={setRange} keyboardWidth={width} keyboardRef={keyboardRef}/>}
  </section>;
}
