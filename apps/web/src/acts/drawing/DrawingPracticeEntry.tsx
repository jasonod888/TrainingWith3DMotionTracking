/**
 * Step-by-step drawing practice.
 *
 * One authoritative runtime; the transport is indexed by step, not wall-clock
 * media time. Every acquisition/subscription is released through the resource bag.
 * There is no score: the surface says "unassessed" explicitly.
 */
import {useEffect, useMemo, useState} from 'react';
import {PracticeRuntime} from '../../../../../packages/learning-engine/practice-runtime';
import {buildAttemptEnvelope} from '../../../../../packages/learning-engine/attempt-envelope';
import type {LessonContext} from '../../app/lesson-context';
import type {DrawingLessonManifest} from '../../../../../packages/lesson-schema/index';
import {request} from '../../api';
import {usePracticeAccessGuard} from '../../practice/usePracticeAccessGuard';
import {submitAttempt} from '../../practice/submit-attempt';
import {createDrawingTransport, currentStep, drawingPlan} from './drawing-adapter';

export function DrawingPracticeEntry({context, document: documentProp, onBack}: {
  context?: LessonContext | null;
  document?: DrawingLessonManifest;
  onBack?: () => void;
}) {
  const lesson = documentProp
    ?? (context?.document.kind === 'drawing' ? context.document.value : null);
  const transport = useMemo(() => lesson ? createDrawingTransport(lesson) : null, [lesson]);
  const runtime = useMemo(() => lesson && transport
    ? new PracticeRuntime({plan: drawingPlan(lesson), transport, mode: 'sections',
      countdownSeconds: 0, restSeconds: 0})
    : null, [lesson, transport]);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [attemptNotice, setAttemptNotice] = useState('');
  const [accessLost, setAccessLost] = useState(false);
  const fallbackRevalidate = useMemo(() => context || !lesson ? undefined
    : async () => { await request(`/lessons/${lesson.lesson_id}`, 'GET', undefined, false,
      {'X-Lesson-Formats': '1,2,3'}); }, [context, lesson]);
  const access = usePracticeAccessGuard({
    runtime, transport, context, revalidate: fallbackRevalidate,
    onLost: () => setAccessLost(true),
    register: bag => {
      bag.add({kind: 'worker', release: () => runtime?.destroy()});
      bag.add({kind: 'subscription', release: transport?.subscribe(() => {
        setIndex(runtime?.snapshot.unitIndex ?? 0);
      }) ?? (() => {})});
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'ArrowRight') runtime?.action('next');
        if (event.key === 'ArrowLeft') runtime?.action('previous');
      };
      window.addEventListener('keydown', onKey);
      bag.add({kind: 'pointer_stylus', release: () => window.removeEventListener('keydown', onKey)});
    },
  });
  useEffect(() => () => {
    transport?.destroy?.();
    runtime?.destroy();
  }, [transport, runtime]);

  if (!lesson || !transport) {    return <section className="practice-runtime-shell" aria-label="Drawing practice">
      {onBack && <button className="back-link" onClick={onBack}>Back</button>}
      <h1>This drawing lesson can’t open here.</h1>
      <p className="subtle">Open it from your library, or refresh to update the app.</p>
    </section>;
  }

  if (accessLost) {
    return <section className="practice-runtime-shell" data-access-lost="true" aria-label="Drawing practice">
      <h1>Access to this lesson was removed.</h1>
      <p role="status">Practice stopped and device resources were released.</p>
      {onBack && <button className="back-link" onClick={onBack}>Back</button>}
    </section>;
  }
  const step = currentStep(lesson, index);
  const total = lesson.steps.length;
  const go = (next: number) => {
    if (!runtime) return;
    if (next > index) runtime.action('next'); else runtime.action('previous');
    setIndex(runtime.snapshot.unitIndex);
    setFinished(false);
  };
  const finish = () => {
    if (!runtime) return;
    // Drive completion through the runtime, then persist the neutral envelope.
    runtime.select(total - 1);
    runtime.action('next');
    setIndex(runtime.snapshot.unitIndex);
    setFinished(true);
    const envelope = buildAttemptEnvelope({
      attemptId: `drawing-${lesson.lesson_id}-${lesson.revision_id}-${Date.now()}`,
      lessonId: lesson.lesson_id, revisionId: lesson.revision_id, actId: 'drawing',
      mode: 'practice', planId: drawingPlan(lesson).id, unitId: step?.id ?? null,
      durationMs: 0, status: 'unassessed', report: {stepsSeen: total},
    });
    void submitAttempt({attemptId: envelope.attemptId, lessonId: envelope.lessonId,
      revisionId: envelope.revisionId, actId: envelope.actId, mode: envelope.mode,
      planId: envelope.planId, unitId: envelope.unitId, durationMs: envelope.durationMs,
      status: 'unassessed', report: envelope.report,
      accountScope: context?.accountScope ?? 'guest'},
      {guard: access.guardRef.current}).then(result => {
        setAttemptNotice(result.ok ? 'Attempt saved · unassessed.'
          : 'Attempt kept on this device · unassessed.');
      });
  };

  return <section className="practice-runtime-shell" data-practice-mode="drawing" aria-label="Drawing practice">
    <header className="practice-runtime-header">
      {onBack && <button className="back-link" onClick={onBack}>Back</button>}
      <div><p className="ws-eyebrow">DRAWING · {lesson.medium}</p><h1>{lesson.title}</h1></div>
      <span className="practice-runtime-state" role="status">Unassessed · no score</span>
    </header>
    <div className="practice-runtime-stage">
      <p className="small muted" role="status">Step {index + 1} of {total}</p>
      <h2>{step?.title}</h2>
      <p>{step?.instruction}</p>
      {finished && <p role="status" className="inline-notice">Attempt complete · unassessed. No score is produced.</p>}
      {attemptNotice && <p role="status" className="small muted">{attemptNotice}</p>}
    </div>
    <footer className="practice-runtime-controls">
      <button className="secondary" disabled={index === 0} onClick={() => go(index - 1)}>Previous step</button>
      <button className="secondary" disabled={index >= total - 1} onClick={() => go(index + 1)}>Next step</button>
      <button className="primary" onClick={finish}>Finish practice</button>
    </footer>
  </section>;
}

export default DrawingPracticeEntry;
