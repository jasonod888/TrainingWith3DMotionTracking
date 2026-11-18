import {useEffect} from 'react';
import type {PracticeCommand} from '../../../../packages/learning-engine/practice-commands';
import type {PracticeAction} from '../../../../packages/learning-engine/practice-session';
import type {PracticeVoiceCommand} from './practice-voice';

/** One normalized voice mapping; subjects supply only their allowed speed presets. */
export function voiceCommandToPractice(
  command: PracticeVoiceCommand,
  options: {rates: readonly number[]; rate: number; loop: boolean},
): PracticeCommand | null {
  if (command === 'resume') return {type: 'action', action: 'play'};
  if (command === 'pause') return {type: 'action', action: 'pause'};
  if (command === 'next') return {type: 'action', action: 'next'};
  if (command === 'back') return {type: 'action', action: 'previous'};
  if (command === 'again' || command === 'repeat-section') return {type: 'action', action: 'repeat-section'};
  if (command === 'restart-lesson') return {type: 'action', action: 'restart-lesson'};
  if (command === 'loop') return {type: 'set-loop', loop: !options.loop};
  if (command === 'slower' || command === 'faster') {
    const index = options.rates.indexOf(options.rate);
    const next = options.rates[Math.max(0, Math.min(options.rates.length - 1,
      index + (command === 'slower' ? -1 : 1)))];
    return {type: 'set-rate', rate: next};
  }
  return null;
}

export function voiceCommandToBodyAction(
  command: PracticeVoiceCommand,
  options: {rates: readonly number[]; rate: number; loop: boolean},
): PracticeAction | null {
  if (command === 'next') return 'next';
  if (command === 'back') return 'back';
  if (command === 'again' || command === 'repeat-section') return 'again';
  if (command === 'restart-lesson') return 'restart-lesson';
  if (command === 'pause') return 'pause';
  if (command === 'resume') return 'resume';
  if (command === 'loop') return 'loop';
  if (command === 'slower' || command === 'faster') {
    const index = options.rates.indexOf(options.rate);
    const next = options.rates[Math.max(0, Math.min(options.rates.length - 1,
      index + (command === 'slower' ? -1 : 1)))];
    return next < options.rate ? 'slower' : 'faster';
  }
  return null;
}

/**
 * One focused-input-safe keyboard mapping for every practice route. Space toggles
 * explicitly (UI toggle semantics), arrows use the same previous/next commands as
 * buttons and voice, and R repeats the current section.
 */
export function practiceCommandForKey(event: {
  key: string; code?: string; defaultPrevented?: boolean;
  metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean;
  target?: EventTarget | null;
}): PracticeCommand | null {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = event.target as HTMLElement | null;
  if (target) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return null;
    if (target.closest?.('button, a, [role="button"], [role="slider"], [role="switch"], [role="textbox"]')) return null;
  }
  if (event.code === 'Space' || event.key === ' ') return {type: 'action', action: 'toggle'};
  if (event.key === 'ArrowRight') return {type: 'action', action: 'next'};
  if (event.key === 'ArrowLeft') return {type: 'action', action: 'previous'};
  if (event.key === 'r' || event.key === 'R') return {type: 'action', action: 'repeat-section'};
  if (event.key === 'p' || event.key === 'P') return {type: 'action', action: 'pause'};
  return null;
}

export function usePracticeKeyboard(
  dispatch: (command: PracticeCommand) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      const command = practiceCommandForKey(event);
      if (!command) return;
      event.preventDefault();
      dispatch(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, enabled]);
}
