/**
 * Step-by-step drawing practice.
 *
 * One authoritative runtime; the transport is indexed by step, not wall-clock
 * media time. Every acquisition/subscription is released through the resource bag.
 * There is no score: the surface says "unassessed" explicitly.
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import {PracticeRuntime} from '../../../../../packages/learning-engine/practice-runtime';
import {createResourceBag} from '../../../../../packages/learning-engine/practice-adapter';
import {buildAttemptEnvelope} from '../../../../../packages/learning-engine/attempt-envelope';
import type {LessonContext} from '../../app/lesson-context';
import type {DrawingLessonManifest} from '../../../../../packages/lesson-schema/index';
import {submitPracticeAttempt,request} from '../../api';
import {createContextRevalidator} from '../../practice/session-guard';
import {createSessionGuard} from '../../practice/session-guard';
import {saveLocalAttempt} from '../../practice/practice-store';
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
  const resources = useRef<ReturnType<typeof createResourceBag> | null>(null);
  const guard = useRef<ReturnType<typeof createSessionGuard> | null>(null);

  useEffect(() => {
    if (!lesson || !transport) return;
    const bag = createResourceBag();
    resources.current = bag;
    const revalidator = createContextRevalidator(context)
      ?? (context ? null : async () => {
        await request(`/lessons/${lesson.lesson_id}`, 'GET', undefined, false,
          {'X-Lesson-Formats': '1,2,3'});
      });
    let stop = () => {};
    if (runtime && revalidator) {
      guard.current = createSessionGuard({
        runtime, transport, resources: bag, revalidate: revalidator,
        onLost: () => setAccessLost(true),
      });
      stop = guard.current.start();
    }
    bag.add({kind: 'worker', release: () => runtime?.destroy()});
    bag.add({kind: 'subscription', release: transport.subscribe(() => {
      setIndex(runtime?.snapshot.unitIndex ?? 0);
    })});
    const onKey = (event: KeyboardEvent) => {
      // Actions are routed through the one runtime; the transport is never driven
      // directly by the surface.
      if (event.key === 'ArrowRight') runtime?.action('next');
      if (event.key === 'ArrowLeft') runtime?.action('previous');
    };
    window.addEventListener('keydown', onKey);
    bag.add({kind: 'pointer_stylus', release: () => window.removeEventListener('keydown', onKey)});
    return () => { stop(); void bag.releaseAll(); };
  }, [lesson, transport, runtime, context]);

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
    void submitPracticeAttempt({
      attempt_id: envelope.attemptId, lesson_id: envelope.lessonId,
      revision_id: envelope.revisionId, act_id: envelope.actId, mode: envelope.mode,
      plan_id: envelope.planId, unit_id: envelope.unitId, duration_ms: envelope.durationMs,
      status: 'unassessed', assessment_adapter: null, rubric_version: null,
      report: envelope.report,
    }).then(() => setAttemptNotice('Attempt saved · unassessed.')).catch(cause => {
      // Guests/offline keep the neutral envelope account-scoped on this device.
      saveLocalAttempt(context?.accountScope ?? 'guest', envelope);
      setAttemptNotice('Attempt kept on this device · unassessed.');
      void guard.current?.handleError(cause);
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
