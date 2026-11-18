import type {ReactNode, Ref} from 'react';
import type {Section} from '../../../packages/lesson-schema/index';
import type {PracticeView} from '../../../packages/learning-engine/practice-view';
import type {PracticeCommand} from '../../../packages/learning-engine/practice-commands';
import type {PracticeFullscreenController} from './practice/usePracticeFullscreen';
import {PracticeTimeline} from './PracticeTimeline';
import {PracticePrimaryActions} from './practice/PracticePrimaryActions';
import {Button} from './ui/controls';
import {Maximize, Minimize, Settings2} from 'lucide-react';

export function PracticePlayerDock({
  dockRef, id, hidden, inert, sections, duration, time, activeIndex, range = null,
  timelineDisabled = false, onScrubStart, onSeek, onSelect, onBrowse,
  view, onCommand, actionsDisabled, primaryAction, toolsBefore, speed, onSpeedClick, onSettingsClick, toolsAfter,
  fullscreen, extra, status,
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
  /** Canonical controls. When supplied, subjects cannot reassemble core actions. */
  view?: PracticeView;
  onCommand?: (command: PracticeCommand) => void;
  actionsDisabled?: boolean;
  /** Stage extension only (for example a camera-preparation primary). */
  primaryAction?: ReactNode;
  toolsBefore?: ReactNode;
  speed: number;
  onSpeedClick: () => void;
  onSettingsClick: () => void;
  toolsAfter?: ReactNode;
  fullscreen?: PracticeFullscreenController;
  extra?: ReactNode;
  status?: ReactNode;
}) {
  const actions = view && onCommand
    ? <PracticePrimaryActions primary={view.primary} secondary={view.secondary}
        onCommand={onCommand} disabled={actionsDisabled}/>
    : primaryAction;
  return <div ref={dockRef} id={id} className="practice-player-dock" data-ui-surface="practice"
    hidden={hidden} inert={inert || undefined}>
    <PracticeTimeline sections={sections} duration={duration} time={time}
      activeIndex={activeIndex} range={range} disabled={timelineDisabled}
      onScrubStart={onScrubStart} onSeek={onSeek} onSelect={onSelect} onBrowse={onBrowse}/>
    <div className="practice-player-toolbar">
      <div className="practice-player-actions">{actions}</div>
      <div className="practice-player-tools">
        {toolsBefore}
        <Button variant="dock-tool" className="player-tool player-speed" aria-label={`Playback speed ${speed}×`}
          title="Playback speed" onClick={onSpeedClick}>{speed}×</Button>
        <Button variant="dock-tool" className="player-tool" aria-label="Practice settings" title="Practice settings"
          onClick={onSettingsClick}><Settings2 size={19} aria-hidden="true"/></Button>
        {toolsAfter}
        {fullscreen && <Button variant="dock-tool" className="player-tool practice-fullscreen-button"
          aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={fullscreen.error || (fullscreen.available || fullscreen.active
            ? (fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen')
            : 'Fullscreen is unavailable in this browser.')}
          disabled={!fullscreen.available && !fullscreen.active}
          onClick={() => void fullscreen.toggle()}>
          {fullscreen.active ? <Minimize size={19} aria-hidden="true"/> : <Maximize size={19} aria-hidden="true"/>}
        </Button>}
      </div>
    </div>
    {extra}
    {fullscreen?.error && <p className="practice-player-fullscreen-error" role="status">{fullscreen.error}</p>}
    <div className="practice-player-status" role="status">{status}</div>
  </div>;
}
