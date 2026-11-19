/**
 * Music Practice entry.
 *
 * This module is the only practice import for piano and guitar. It deliberately
 * does NOT import `PianoWorkspaceHarness` or any review/correction module, so
 * opening practice cannot pull the editor chunk into the practice graph.
 *
 * The reviewed reference is loaded from the context/hash cache; the correction
 * workspace stays behind the editor entry point.
 */
import {PianoPracticeWorkspace} from '../../music/workspace/PianoPracticeWorkspace';
import type {LessonContext} from '../../app/lesson-context';

export type MusicPracticeEntryProps = {
  context?: LessonContext | null;
  lessonId: string;
  lessonTitle?: string;
  challengeMode?: boolean;
  challengeAvailable?: boolean;
  challengeHistoryEnabled?: boolean;
  audioAssessmentEnabled?: boolean;
  onBack?: () => void;
  onModeChange?: (mode: 'watch' | 'practice' | 'compete') => void;
};

export function MusicPracticeEntry({context, lessonId, lessonTitle, ...rest}: MusicPracticeEntryProps) {
  return <PianoPracticeWorkspace context={context ?? undefined} lessonId={lessonId}
                                 lessonTitle={lessonTitle} {...rest}/>;
}

export default MusicPracticeEntry;
