import type {ReactNode, Ref} from 'react';
import type {Section} from '../../../packages/lesson-schema/index';
import {PracticeTimeline} from './PracticeTimeline';
import {Settings2} from 'lucide-react';

export function PracticePlayerDock({
  dockRef, id, hidden, inert, sections, duration, time, activeIndex, range = null,
  timelineDisabled = false, onScrubStart, onSeek, onSelect, onBrowse,
  primaryAction, toolsBefore, speed, onSpeedClick, onSettingsClick, toolsAfter,
  extra, status,
}: {
  dockRef?: Ref<HTMLDivElement>;
  id?: string;
  hidden?: boolean;
  inert?: boolean;
  sections: Section[];
  duration: number;
  time: number;
  activeIndex: number;
  range?: {start: number; end: number} | null;
  timelineDisabled?: boolean;
  onScrubStart: () => void;
  onSeek: (time: number) => void;
  onSelect: (index: number) => void;
  onBrowse: () => void;
  primaryAction: ReactNode;
  toolsBefore?: ReactNode;
  speed: number;
  onSpeedClick: () => void;
  onSettingsClick: () => void;
  toolsAfter?: ReactNode;
  extra?: ReactNode;
  status?: ReactNode;
}) {
  return <div ref={dockRef} id={id} className="practice-player-dock"
    hidden={hidden} inert={inert || undefined}>
    <PracticeTimeline sections={sections} duration={duration} time={time}
      activeIndex={activeIndex} range={range} disabled={timelineDisabled}
      onScrubStart={onScrubStart} onSeek={onSeek} onSelect={onSelect} onBrowse={onBrowse}/>
    <div className="practice-player-toolbar">
      <div className="practice-player-actions">{primaryAction}</div>
      <div className="practice-player-tools">
        {toolsBefore}
        <button className="player-tool player-speed" aria-label={`Playback speed ${speed}×`}
          title="Playback speed" onClick={onSpeedClick}>{speed}×</button>
        <button className="player-tool" aria-label="Practice settings" title="Practice settings"
          onClick={onSettingsClick}><Settings2 size={19} aria-hidden="true"/></button>
        {toolsAfter}
      </div>
    </div>
    {extra}
    <div className="practice-player-status" role="status">{status}</div>
  </div>;
}
