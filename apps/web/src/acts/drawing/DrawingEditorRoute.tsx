import {useEffect, useState} from 'react';
import {loadLessonContext, type LessonContext} from '../../app/lesson-context';
import type {DrawingLessonManifest} from '../../../../../packages/lesson-schema/index';
import {DrawingEditorEntry} from './DrawingEditorEntry';

export function DrawingEditorRoute({lessonId, accountId, onBack, onSaved}: {
  lessonId: string; accountId: string; onBack: () => void;
  onSaved?: (value: DrawingLessonManifest) => void;
}) {
  const [lesson, setLesson] = useState<DrawingLessonManifest | null>(null);
  const [context, setContext] = useState<LessonContext | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stopped = false;
    // The shared loader validates the specialized document and Act identity.
    loadLessonContext(lessonId, {audience: 'owner', accountScope: accountId,
      challengeEnabled: false}).then(loaded => {
      if (stopped) return;
      if (loaded.document.kind !== 'drawing') {
        setError('This lesson is not a drawing lesson.');
        return;
      }
      setContext(loaded);
      setLesson(loaded.document.value);
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The drawing could not be opened.'); });
    return () => { stopped = true; };
  }, [lessonId, accountId]);

  if (error) return <section className="studio-page"><button className="back-link" onClick={onBack}>Back</button><p role="alert">{error}</p></section>;
  if (!lesson || !context) return <section className="studio-page"><p role="status">Opening drawing editor…</p></section>;
  return <DrawingEditorEntry lesson={lesson} onBack={onBack} onSaved={value => {
    setLesson(value);
    onSaved?.(value);
  }}/>;
}

export default DrawingEditorRoute;
