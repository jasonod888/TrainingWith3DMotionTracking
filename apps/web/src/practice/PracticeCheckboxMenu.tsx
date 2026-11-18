import {useId, useRef, useState} from 'react';
import {Checkbox, MenuTrigger} from '../ui/controls';
import {useDismissablePopover} from '../ui/overlays';
import './practice-checkbox-menu.css';

export type CheckboxMenuOption<T extends string> = {value: T; label: string};

/** Shared dock checkbox dropdown: multi-select, stays open, Escape/outside closes. */
export function PracticeCheckboxMenu<T extends string>({label, options, selected, onToggle}: {
  label: string;
  options: readonly CheckboxMenuOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const close = useDismissablePopover({open,onClose:()=>setOpen(false),rootRef:root,triggerRef:trigger,initialFocusRef:firstInput});
  return <div className="practice-checkbox-menu" ref={root}>
    <MenuTrigger ref={trigger} variant="dock-dropdown" className="practice-checkbox-menu-trigger"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-label={`${label} panels`} onClick={() => setOpen(value => !value)}>{label}</MenuTrigger>
    {open && <div id={menuId} className="practice-checkbox-menu-popup" role="dialog" aria-label={`${label} panels`}
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
          return;
        }
        event.stopPropagation();
      }}>
      {options.map((option, index) => <label key={option.value} className="practice-checkbox-menu-row">
        <Checkbox variant="menu" ref={index === 0 ? firstInput : undefined} checked={selected.includes(option.value)}
          onChange={() => onToggle(option.value)}/>
        <span>{option.label}</span>
      </label>)}
    </div>}
  </div>;
}
