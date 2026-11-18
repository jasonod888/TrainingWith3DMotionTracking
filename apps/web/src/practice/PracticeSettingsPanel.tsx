import {useEffect, useState, type ReactNode} from 'react';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';
import type {PracticeCapabilities, ControlState} from '../../../../packages/learning-engine/practice-capabilities';
import type {PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {PracticePanel} from '../PracticePanel';
import {PracticeSettingsProvider, SettingsGroup, SettingsRow} from '../PracticeSettings';
import {PracticeCommonSettings} from './PracticeCommonSettings';
import {Button} from '../ui/controls';

export type PracticeVoiceSettings = {
  control: ControlState;
  status: string;
  error: string;
  toggle: () => void;
};

/** Common practice settings, with one subject-owned extension slot. */
export function PracticeSettingsPanel({open, onClose, snapshot, capabilities, onCommand, voice, extra, portalRoot}: {
  open: boolean;
  onClose: () => void;
  snapshot: PracticeRuntimeSnapshot;
  capabilities: PracticeCapabilities;
  onCommand: (command: PracticeCommand) => void;
  voice: PracticeVoiceSettings;
  extra?: ReactNode;
  portalRoot?: HTMLElement | null;
}) {
  const [row, setRow] = useState<string | null>(null);
  useEffect(() => { if (!open) setRow(null); }, [open]);
  if (!open) return null;
  const voiceUnavailable = !voice.control.supported || Boolean(voice.control.reason);
  return <PracticePanel title="Practice settings" onClose={onClose} drawer dismissOnBackdrop={false} modal={false} portalRoot={portalRoot}>
    <PracticeSettingsProvider row={row} setRow={setRow}>
      <SettingsGroup id="setup" title="Practice setup" summary={voice.control.status ?? 'Voice off'}>
        {voice.control.supported && <SettingsRow id="voice" label="Voice commands" value={voice.control.status ?? (voice.control.enabled ? 'On' : 'Off')}
          disabledReason={voice.control.reason} status={voice.control.status ?? 'Off'}>
          <Button variant="immersive-action" type="button" onClick={voice.toggle} disabled={voiceUnavailable}>
            {voice.control.status === 'On' || voice.control.status === 'Starting' || voice.control.status === 'Reconnecting'
              ? 'Turn off voice commands' : 'Enable voice commands'}
          </Button>
          {voice.error && <p role="alert">{voice.error}</p>}
          <p>Say “Start”, “Pause”, “Next”, “Back”, “Repeat”, “Start over”, “Slower”, “Faster” or “Loop”.</p>
        </SettingsRow>}
        {extra}
      </SettingsGroup>
      <PracticeCommonSettings snapshot={snapshot} capabilities={capabilities} onCommand={onCommand}/>
    </PracticeSettingsProvider>
  </PracticePanel>;
}
