import type {ReactNode} from 'react';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';
import type {PracticeCapabilities} from '../../../../packages/learning-engine/practice-capabilities';
import type {PracticeRuntimeSnapshot} from '../../../../packages/learning-engine/practice-runtime';
import {SettingsChoices, SettingsGroup, SettingsRow} from '../PracticeSettings';

/** The one common playback/timing settings surface used by body and music. */
export function PracticeCommonSettings({snapshot, capabilities, onCommand, disabledReason, status, extra}: {
  snapshot: PracticeRuntimeSnapshot;
  capabilities: PracticeCapabilities;
  onCommand: (command: PracticeCommand) => void;
  disabledReason?: string;
  status?: string;
  extra?: ReactNode;
}) {
  return <SettingsGroup id="playback" title="Playback & timing"
    summary={disabledReason ? 'Fixed' : `${snapshot.rate}×`} disabledReason={disabledReason} status={status}>
    <SettingsRow id="speed" label="Playback speed" value={`${snapshot.rate}×`}
      disabledReason={disabledReason} status={status}>
      <SettingsChoices label="Playback speed" value={snapshot.rate} disabled={Boolean(disabledReason)}
        options={capabilities.speeds.map(value => ({value, label: `${value}×`}))}
        onChange={value => onCommand({type: 'set-rate', rate: value})}/>
    </SettingsRow>
    {capabilities.progression.length > 1 && <SettingsRow id="progression" label="Progression"
      value={snapshot.mode === 'sections' ? 'Stop at each section' : 'Continuous'}
      disabledReason={disabledReason} status={status}>
      <SettingsChoices label="Progression" value={snapshot.mode} disabled={Boolean(disabledReason)}
        options={capabilities.progression.map(mode => ({value: mode,
          label: mode === 'sections' ? 'Step by step' : 'Full sequence'}))}
        onChange={mode => onCommand({type: 'set-mode', mode: mode as 'sections' | 'continuous'})}/>
    </SettingsRow>}
    {capabilities.repeat === 'supported' && <SettingsRow id="repeat" label="Repeat automatically"
      value={snapshot.loop ? 'On' : 'Off'} disabledReason={disabledReason} status={status}>
      <label>Repeat automatically<input type="checkbox" role="switch" checked={snapshot.loop}
        disabled={Boolean(disabledReason)}
        onChange={event => onCommand({type: 'set-loop', loop: event.currentTarget.checked})}/></label>
      {capabilities.repetitions.supported && <label>Repetitions<select value={snapshot.repetitions}
        disabled={Boolean(disabledReason) || !snapshot.loop}
        onChange={event => onCommand({type: 'set-repetitions', repetitions: Number(event.currentTarget.value)})}>
        {capabilities.repetitions.options.map(value => <option key={value} value={value}>{value || 'Until stopped'}</option>)}
      </select></label>}
      {capabilities.rest.supported && <label>Rest between repeats<select value={snapshot.restSeconds}
        disabled={Boolean(disabledReason) || !snapshot.loop}
        onChange={event => onCommand({type: 'set-rest', seconds: Number(event.currentTarget.value)})}>
        {capabilities.rest.options.map(value => <option key={value} value={value}>{value ? `${value} seconds` : 'None'}</option>)}
      </select></label>}
    </SettingsRow>}
    {capabilities.countIn.supported && <SettingsRow id="countdown" label="Preparation countdown"
      value={snapshot.countdownSeconds ? `${snapshot.countdownSeconds}s` : 'Off'}
      disabledReason={disabledReason} status={status}>
      <SettingsChoices label="Preparation countdown" value={snapshot.countdownSeconds}
        disabled={Boolean(disabledReason)}
        options={capabilities.countIn.options.map(option => ({value: Math.round(option.seconds * 100) / 100, label: option.label}))}
        onChange={value => onCommand({type: 'set-countdown', seconds: value})}/>
    </SettingsRow>}
    {extra}
  </SettingsGroup>;
}
