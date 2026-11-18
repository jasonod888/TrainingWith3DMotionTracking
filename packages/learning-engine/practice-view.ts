import type {PracticeActionId} from './practice-commands';
import type {PracticeCapabilities, ControlState} from './practice-capabilities';
import type {PracticeRuntimeSnapshot} from './practice-runtime';

export type PracticeAction = {
  id: PracticeActionId;
  label: string;
  disabled?: boolean;
  reason?: string;
};

export type PracticeView = {
  statusLabel: string;
  primary: PracticeAction;
  secondary: PracticeAction[];
  progressLabel: string;
  voice: ControlState;
  canScrub: boolean;
  canSelect: boolean;
  buffering: boolean;
  countdownRemaining: number;
  restRemaining: number;
  showUnitComplete: boolean;
  showLessonComplete: boolean;
};

const sectionWord = (capabilities: PracticeCapabilities) => capabilities.unitNoun || 'section';
const number = (value: number) => Math.max(1, Math.round(value));

/**
 * The single derived view for core practice actions and wording.
 *
 * The important distinction is state, not subject: a restored pause reads
 * "Resume section N" while a completed section reads "Next section". Subjects
 * add stage tools and optional settings, but cannot replace these core actions.
 */
export function derivePracticeView(
  snapshot: PracticeRuntimeSnapshot,
  capabilities: PracticeCapabilities,
): PracticeView {
  const word = sectionWord(capabilities);
  const unitNumber = number(snapshot.unitIndex + 1);
  const secondaries: PracticeAction[] = [];
  const addSecondary = (action: PracticeAction) => {
    if (secondaries.some(item => item.id === action.id)) return;
    if (action.id === 'restart-lesson' && capabilities.restartLesson === 'unsupported') return;
    if (action.id === 'repeat-section' && capabilities.repeat === 'unsupported') return;
    if (action.id === 'next' && !snapshot.canNext) return;
    secondaries.push(action);
  };

  let primary: PracticeAction;
  let statusLabel: string;
  if (snapshot.status === 'buffering') {
    statusLabel = 'Video buffering · practice time is paused';
    primary = {id: 'pause', label: 'Pause practice'};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
  } else if (snapshot.status === 'error') {
    statusLabel = snapshot.error || 'Playback could not start.';
    primary = {id: 'start', label: 'Try practice again'};
  } else if (snapshot.status === 'countdown') {
    statusLabel = `Get ready · ${Math.max(1, Math.ceil(snapshot.remaining))}`;
    primary = {id: 'pause', label: 'Cancel count-in'};
  } else if (snapshot.status === 'resting') {
    statusLabel = `Rest · next repetition in ${Math.max(1, Math.ceil(snapshot.restRemaining || snapshot.remaining))}`;
    primary = {id: 'pause', label: 'Cancel rest'};
  } else if (snapshot.status === 'playing') {
    statusLabel = `${capabilities.cameraRequired ? 'Practice in progress' : 'Practice in progress'} · ${word} ${unitNumber}`;
    primary = {id: 'pause', label: 'Pause practice'};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
  } else if (snapshot.status === 'lesson-complete') {
    statusLabel = 'Lesson complete';
    primary = {id: 'restart-lesson', label: 'Practise again'};
  } else if (snapshot.status === 'section-complete' && snapshot.canNext) {
    statusLabel = `${word[0].toUpperCase()}${word.slice(1)} ${unitNumber} complete`;
    primary = {id: 'next', label: 'Next section'};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
  } else if (snapshot.status === 'section-complete' || (snapshot.atUnitEnd && !snapshot.canNext)) {
    statusLabel = 'Lesson complete';
    primary = {id: 'restart-lesson', label: 'Practise again'};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
  } else if (snapshot.status === 'paused' && snapshot.intent === 'restored') {
    statusLabel = 'Your place is saved. Ready when you are.';
    primary = {id: 'resume', label: `Resume ${word} ${unitNumber}`};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
    addSecondary({id: 'restart-lesson', label: 'Start over'});
  } else if (snapshot.status === 'paused' && snapshot.intent === 'selected') {
    statusLabel = `${word[0].toUpperCase()}${word.slice(1)} ${unitNumber} selected`;
    primary = {id: 'start', label: `Start ${word} ${unitNumber}`};
  } else if (snapshot.status === 'paused' && snapshot.canNext && snapshot.atUnitEnd) {
    statusLabel = `${word[0].toUpperCase()}${word.slice(1)} ${unitNumber} complete`;
    primary = {id: 'next', label: 'Next section'};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
  } else if (snapshot.status === 'paused' && snapshot.hasProgress) {
    statusLabel = 'Paused';
    primary = {id: 'resume', label: `Resume ${word} ${unitNumber}`};
    addSecondary({id: 'repeat-section', label: `Repeat ${word}`});
    addSecondary({id: 'restart-lesson', label: 'Start over'});
  } else {
    statusLabel = 'Ready when you are';
    primary = {id: 'start', label: capabilities.startLabel || 'Start practice'};
  }

  if (primary.id === 'restart-lesson') {
    // "Practise again" already means restart lesson; do not duplicate it below.
  }
  if (capabilities.restartLesson === 'unsupported') {
    const filtered = secondaries.filter(action => action.id !== 'restart-lesson');
    secondaries.length = 0;
    secondaries.push(...filtered);
  }

  return {
    statusLabel,
    primary,
    secondary: secondaries,
    progressLabel: snapshot.range
      ? `${timeLabel(snapshot.time)} / ${timeLabel(snapshot.range.end)}`
      : `${timeLabel(snapshot.time)} / ${timeLabel(snapshot.duration)}`,
    voice: capabilities.voice,
    canScrub: capabilities.seek === 'supported',
    canSelect: capabilities.sections === 'supported',
    buffering: snapshot.status === 'buffering',
    countdownRemaining: snapshot.status === 'countdown' ? snapshot.remaining : 0,
    restRemaining: snapshot.status === 'resting' ? snapshot.restRemaining || snapshot.remaining : 0,
    showUnitComplete: snapshot.status === 'section-complete',
    showLessonComplete: snapshot.status === 'lesson-complete',
  };
}

export function timeLabel(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
}
