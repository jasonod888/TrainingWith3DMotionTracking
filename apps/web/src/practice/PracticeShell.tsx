import {useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, Mic, MicOff, Settings2} from 'lucide-react';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';
import type {PracticeCapabilities} from '../../../../packages/learning-engine/practice-capabilities';
import type {PracticePlan} from '../../../../packages/learning-engine/practice-plan';
import type {PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {derivePracticeView} from '../../../../packages/learning-engine/practice-view';
import type {Section} from '../../../../packages/lesson-schema/index';
import {PracticePlayerDock} from '../PracticePlayerDock';
import {PracticeSettingsPanel, type PracticeVoiceSettings} from './PracticeSettingsPanel';
import {usePracticeKeyboard} from './practice-input';
import {useVoiceStartCoordinator} from './useVoiceStartCoordinator';
import {usePracticeFullscreen} from './usePracticeFullscreen';
import {Button, IconButton} from '../ui/controls';
import {useDismissablePopover, useDialogBehavior} from '../ui/overlays';
import type {PracticeVoiceApi} from './usePracticeVoice';
import './practice-runtime.css';

/**
 * Shared practice shell for music and piano routes.
 *
 * The stage is interchangeable; the header, dock, core actions, voice control,
 * countdown/rest status and settings panel come from the common runtime view.
 */
export function PracticeShell({
  title, eyebrow, onBack, className = '', stageClassName = '', stage,
  plan, snapshot, capabilities, voice, onCommand, onSeek, onSelect,
  settingsExtra, toolsBefore, toolsAfter, extra, status, children, autoStartVoice, dockId = 'practice-runtime-player', headerActions, modeControl, disabled = false, onBrowse, showSettingsButton = true,
}: {
  title: string;
  eyebrow?: string;
  onBack?: () => void;
  className?: string;
  stageClassName?: string;
  stage: ReactNode;
  plan: PracticePlan;
  snapshot: PracticeRuntimeSnapshot;
  capabilities: PracticeCapabilities;
  voice: PracticeVoiceSettings & {listening: boolean; supported: boolean; start: () => boolean; stop: () => void};
  onCommand: (command: PracticeCommand) => void;
  onSeek: (time: number) => void;
  onSelect: (index: number) => void;
  settingsExtra?: ReactNode;
  toolsBefore?: ReactNode;
  toolsAfter?: ReactNode;
  extra?: ReactNode;
  status?: string;
  children?: ReactNode;
  autoStartVoice?: boolean;
  dockId?: string;
  headerActions?: ReactNode;
  modeControl?: ReactNode;
  disabled?: boolean;
  onBrowse?: () => void;
  showSettingsButton?: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const sectionOverlayRef = useRef<HTMLDivElement>(null);
  const sectionTrigger = useRef<HTMLElement | null>(null);
  const fullscreen = usePracticeFullscreen(rootRef);
  const openSections = () => {
    sectionTrigger.current = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
    setSectionsOpen(true);
  };
  const closeSections = () => setSectionsOpen(false);
  useDismissablePopover({open: sectionsOpen, onClose: closeSections, rootRef: sectionOverlayRef, triggerRef: sectionTrigger});
  const coordinator = useVoiceStartCoordinator(voice as PracticeVoiceApi);
  const voicePromptRef = useRef<HTMLDivElement>(null);
  useDialogBehavior({panelRef:voicePromptRef,modal:false,onClose:coordinator.cancel,
    active:coordinator.status==='asking'||coordinator.status==='fallback'});
  const view = useMemo(() => derivePracticeView(snapshot, capabilities), [snapshot, capabilities]);
  const sections = useMemo<Section[]>(() => plan.units.map(unit => ({
    id: unit.id, label: unit.label, start: unit.start, end: unit.end,
  })), [plan]);
  const dispatch = (command: PracticeCommand) => {
    const action = command.type === 'action' ? command.action : null;
    const initial = snapshot.status === 'idle' || snapshot.status === 'lesson-complete' || snapshot.status === 'error';
    if (autoStartVoice && initial && (action === 'start' || action === 'play' || action === 'resume')) {
      coordinator.requestStart(() => onCommand(command));
      return;
    }
    onCommand(command);
  };
  usePracticeKeyboard(dispatch, !disabled && !sectionsOpen && coordinator.status !== 'asking'
    && coordinator.status !== 'fallback');
  const toggleVoice = () => {
    if (voice.listening || voice.status === 'starting' || voice.status === 'reconnecting') {
      coordinator.markOff();
      voice.stop();
    } else {
      voice.start();
    }
  };
  const startWithoutVoice = () => coordinator.chooseWithoutVoice();
  const voiceControl = <Button type="button" variant="dock-tool" className="player-tool practice-voice-status"
    aria-label={voice.listening ? 'Voice on' : 'Voice off'} title={voice.control.reason ?? (voice.listening ? 'Voice on' : 'Voice off')}
    aria-pressed={voice.listening} onClick={toggleVoice} disabled={!voice.control.supported}>
    {voice.listening ? <Mic size={18} aria-hidden="true"/> : <MicOff size={18} aria-hidden="true"/>}
    <span className="player-voice-label">{voice.listening ? 'Voice on' : voice.status === 'unavailable' ? 'Voice unavailable' : 'Voice off'}</span>
  </Button>;
  const actionsDisabled = disabled || status === 'starting';
  return <section ref={rootRef} className={`practice-runtime-shell ${className}`} data-practice-mode="true" data-ui-surface="practice"
    aria-label="Practice workspace">
    <header className="practice-runtime-header">
      {onBack && <IconButton variant="icon-shell" className="ws-icon-button" aria-label="Back" title="Back" onClick={onBack}><ArrowLeft size={19}/></IconButton>}
      <div className="practice-runtime-title">
        {eyebrow && <p className="ws-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      <div className="practice-runtime-header-actions">
        {headerActions}
        <span className="practice-runtime-state" role="status">{status ?? view.statusLabel}</span>
        {showSettingsButton && <IconButton variant="icon-shell" className="ws-icon-button" aria-label="Practice settings" title="Practice settings"
          aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}><Settings2 size={19}/></IconButton>}
      </div>
    </header>
    <div className={`practice-runtime-stage ${stageClassName}`}>{stage}</div>
    {snapshot.status === 'countdown' && <div className="practice-countdown" role="status">
      <strong>{Math.max(1, Math.ceil(snapshot.remaining))}</strong><span>Get ready</span>
      <Button variant="immersive-action" type="button" onClick={() => dispatch({type: 'action', action: 'pause'})}>Cancel</Button>
    </div>}
    {snapshot.status === 'resting' && <div className="practice-countdown" role="status">
      <strong>{Math.max(1, Math.ceil(snapshot.restRemaining || snapshot.remaining))}</strong><span>Rest · next repetition</span>
      <Button variant="immersive-action" type="button" onClick={() => dispatch({type: 'action', action: 'pause'})}>Cancel</Button>
    </div>}
    {snapshot.status === 'buffering' && <p className="practice-runtime-buffering" role="status">Video buffering · practice time is paused</p>}
    <PracticePlayerDock
      id={dockId}
      sections={sections}
      duration={plan.duration}
      time={snapshot.time}
      activeIndex={snapshot.unitIndex}
      range={snapshot.range}
      timelineDisabled={disabled || status === 'starting' || capabilities.seek === 'unsupported'}
      onScrubStart={() => dispatch({type: 'action', action: 'pause'})}
      onSeek={time => { if (capabilities.seek === 'supported') onSeek(time); }}
      onSelect={index => { if (capabilities.sections === 'supported') onSelect(index); }}
      onBrowse={onBrowse ?? openSections}
      view={view} onCommand={dispatch} actionsDisabled={actionsDisabled}
      toolsBefore={<>{modeControl}{toolsBefore}{voice.control.supported ? voiceControl : null}</>}
      speed={snapshot.rate}
      onSpeedClick={() => setSettingsOpen(true)}
      onSettingsClick={() => setSettingsOpen(true)}
      toolsAfter={toolsAfter}
      fullscreen={fullscreen}
      extra={extra}
      status={status ?? (view.buffering ? 'Video buffering' : undefined)}
    />
    {coordinator.status === 'asking' && <div className="practice-voice-choice" role="dialog" aria-label="Start with voice" ref={voicePromptRef}>
      <p>Start with voice commands, or continue without the microphone.</p>
      <Button variant="immersive-action" type="button" onClick={coordinator.startWithVoice}>Start with voice</Button>
      <Button variant="immersive-action" type="button" onClick={startWithoutVoice}>Without voice</Button>
    </div>}
    {coordinator.status === 'fallback' && <div className="practice-voice-fallback" role="alert" ref={voicePromptRef}>
      <p>{voice.error || 'Voice could not start.'}</p>
      <Button variant="immersive-action" type="button" onClick={coordinator.retry}>Try voice again</Button>
      <Button variant="immersive-action" type="button" onClick={startWithoutVoice}>Continue without voice</Button>
    </div>}
    {children}
    {sectionsOpen && <div className="practice-section-overlay" role="dialog" aria-label="Sections" ref={sectionOverlayRef}>
      <div className="practice-section-dialog">
        <header><h2>Sections</h2><Button variant="immersive-action" type="button" onClick={closeSections}>Close</Button></header>
        <div className="practice-panel-body practice-section-picker" role="group" aria-label="Practice sections">
          {plan.units.map((unit, index) => <Button key={unit.id} type="button" variant="section-row"
            aria-current={snapshot.unitIndex === index ? 'step' : undefined}
            onClick={() => { dispatch({type: 'select', index}); closeSections(); }}>
            {unit.label}
          </Button>)}
        </div>
      </div>
    </div>}
    <PracticeSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} snapshot={snapshot}
      capabilities={capabilities} onCommand={dispatch} voice={{...voice, toggle: toggleVoice}} extra={settingsExtra}
      portalRoot={rootRef.current}/>
  </section>;
}
