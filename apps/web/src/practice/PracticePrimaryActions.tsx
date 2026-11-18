import type {PracticeAction} from '../../../../packages/learning-engine/practice-view';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';

/** Core practice actions from the shared view; subjects may add tools after these. */
export function PracticePrimaryActions({primary, secondary, onCommand, disabled = false}: {
  primary: PracticeAction;
  secondary: readonly PracticeAction[];
  onCommand: (command: PracticeCommand) => void;
  disabled?: boolean;
}) {
  const send = (action: PracticeAction) => onCommand({type: 'action', action: action.id});
  return <>
    <button type="button" className="practice-player-primary" disabled={disabled || primary.disabled}
      title={primary.reason ?? primary.label} onClick={() => send(primary)}>
      {primary.label}
    </button>
    {secondary.map(action => <button key={action.id} type="button" className="player-text-action"
      disabled={disabled || action.disabled} title={action.reason ?? action.label}
      onClick={() => send(action)}>{action.label}</button>)}
  </>;
}
