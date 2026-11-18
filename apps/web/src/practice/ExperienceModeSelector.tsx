import type {ExperienceMode, ExperienceModeCapabilities} from '../../../../packages/learning-engine/experience-mode';
import {experienceModeOptions} from '../../../../packages/learning-engine/experience-mode';
import {Select} from '../ui/controls';
import './experience-mode.css';

/** One compact, native mode dropdown for watch and practice surfaces in every subject. */
export function ExperienceModeSelector({current, capabilities, onSelect, disabledReason, compact = false, className = ''}: {
  current: ExperienceMode;
  capabilities: ExperienceModeCapabilities;
  onSelect: (mode: ExperienceMode) => void;
  disabledReason?: string;
  compact?: boolean;
  className?: string;
}) {
  const options = experienceModeOptions(capabilities);
  const locked = Boolean(disabledReason);
  return <label className={`experience-mode-selector ${compact ? 'is-compact' : ''} ${className}`}
    title={disabledReason}>
    <span className="experience-mode-selector-label">Experience mode</span>
    <Select variant="dock-mode" aria-label="Experience mode" value={current} disabled={locked}
      onChange={event => {
        const mode = event.currentTarget.value as ExperienceMode;
        if (!locked && mode !== current && options.some(option => option.id === mode && option.available)) {
          onSelect(mode);
        }
      }}>
      {options.map(option => <option key={option.id} value={option.id} disabled={!option.available}
        title={option.reason}>
        {option.label}{option.status ? ` — ${option.status}` : ''}
      </option>)}
    </Select>
  </label>;
}
