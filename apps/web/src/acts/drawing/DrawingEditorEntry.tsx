/**
 * Minimal drawing step editor wired into the shared Phase 3 lifecycle.
 *
 * The shared session owns lifecycle/dirty/review/release labels; the Act owns only
 * its steps and medium. It never constructs a body or piano editor.
 */
import {useEffect, useMemo, useState} from 'react';
import {createEditorSession} from '../../editor/editor-session';
import {editorReadiness} from '../../editor/editor-readiness';
import {applySavedRevision} from '../../editor/revision-handoff';
import {invalidateLessonContext} from '../../app/lesson-context';
import {usePublicationController} from '../../sharing/usePublicationController';
import {request} from '../../api';
import type {DrawingLessonManifest, DrawingStep} from '../../../../../packages/lesson-schema/index';

export function DrawingEditorEntry({lesson, onBack, onSaved, creatorName = 'Creator'}: {
  lesson: DrawingLessonManifest;
  onBack?: () => void;
  onSaved?: (value: DrawingLessonManifest) => void;
  creatorName?: string;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [medium, setMedium] = useState(lesson.medium);
  const [steps, setSteps] = useState<DrawingStep[]>(lesson.steps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const session = useMemo(() => createEditorSession({
    state: 'needs-review', revisionId: lesson.revision_id, reviewed: false,
  }), [lesson.revision_id]);
  const [snapshot, setSnapshot] = useState(session.getSnapshot());
  useEffect(() => session.subscribe(setSnapshot), [session]);

  const readiness = useMemo(() => editorReadiness({
    playback: {valid: steps.length > 0, reason: 'Add at least one drawing step.'},
    assessment: {support: 'unsupported', available: false,
      reasonCode: 'no_assessment_adapter', explanation: 'Drawing practice is unassessed.'},
    reviewRequired: true,
  }), [steps.length]);

  const change = (mutate: () => void) => { mutate(); session.beginEdit(); setNotice(''); };
  const updateStep = (index: number, patch: Partial<DrawingStep>) => {
    change(() => setSteps(current => current.map((step, at) => at === index ? {...step, ...patch} : step)));
  };

  const save = async () => {
    if (!readiness.playbackValid || !snapshot.revisionId) { setError(readiness.blockers[0]?.message ?? 'Add a step first.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const value = await request<DrawingLessonManifest>(
        `/drawing/lessons/${encodeURIComponent(lesson.lesson_id)}`, 'PUT', {
          base_revision_id: snapshot.revisionId, title, medium, steps,
        });
      session.saved(value.revision_id);
      applySavedRevision(lesson.lesson_id, value.revision_id);
      setNotice('Saved privately');
      onSaved?.(value);
    } catch (cause) {
      session.conflict(cause instanceof Error ? cause.message : 'The drawing could not be saved.');
      setError(cause instanceof Error ? cause.message : 'The drawing could not be saved.');
    } finally { setBusy(false); }
  };

  const review = async () => {
    if (!snapshot.revisionId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request(`/workflow/lessons/${encodeURIComponent(lesson.lesson_id)}/accept`, 'POST', {
        revision_id: snapshot.revisionId,
      });
      session.reviewed(snapshot.revisionId);
      setNotice('Review complete · saved privately');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The review could not be completed.');
    } finally { setBusy(false); }
  };

  const publication = usePublicationController({lessonId: lesson.lesson_id, initialRoles: ['reference']});
  const publish = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const ok = await publication.publish({title, creatorName, tags: ['drawing'],
        rightsAcknowledged: true, roles: ['reference'],
        releaseRevisionId: snapshot.revisionId ?? undefined});
      if (!ok) throw new Error(publication.error || 'The drawing could not be published.');
      if (snapshot.revisionId) session.published(snapshot.revisionId);
      invalidateLessonContext(lesson.lesson_id);
      setNotice('Published');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The drawing could not be published.');
    } finally { setBusy(false); }
  };

  return <section className="studio-page" aria-label="Drawing editor">
    <header className="share-heading">
      {onBack && <button className="back-link" onClick={onBack}>Back</button>}
      <p className="eyebrow">EDITOR · DRAWING</p>
      <h1>{title}</h1>
      <p className="small muted" role="status" data-authoring-state={snapshot.state}>
        {snapshot.state === 'needs-review' ? 'Review required' : session.statusLabel()}
      </p>
      {!readiness.playbackValid && <p role="alert">{readiness.blockers[0]?.message}</p>}
      <p className="small muted">{readiness.assessmentReady ? '' : 'Unassessed practice · no score'}</p>
    </header>
    <label>Title <input value={title} onChange={event => change(() => setTitle(event.target.value))}/></label>
    <label>Medium
      <select value={medium} onChange={event => change(() => setMedium(event.target.value as typeof medium))}>
        <option value="pencil">Pencil</option><option value="charcoal">Charcoal</option><option value="digital">Digital</option>
      </select>
    </label>
    <ol className="drawing-steps">
      {steps.map((step, index) => <li key={step.id}>
        <label>Step title <input value={step.title} onChange={event => updateStep(index, {title: event.target.value})}/></label>
        <label>Instruction <textarea value={step.instruction} onChange={event => updateStep(index, {instruction: event.target.value})}/></label>
        <button className="secondary" onClick={() => change(() => setSteps(current => current.filter((_value, at) => at !== index)))}>Remove step</button>
      </li>)}
    </ol>
    <div className="inline-actions">
      <button className="secondary" onClick={() => change(() => setSteps(current => [...current, {
        id: `step-${current.length + 1}`, title: 'New step', instruction: 'Describe what to draw.',
      }]))}>Add step</button>
      <button className="primary" disabled={busy} onClick={() => void save()}>Save privately</button>
      <button className="secondary" disabled={busy || !snapshot.revisionId || !readiness.reviewReady || snapshot.reviewed} onClick={() => void review()}>Mark reviewed</button>
      <button className="secondary" disabled={busy || !session.canPublish()} onClick={() => void publish()}>{session.publishActionLabel()}</button>
    </div>
    {notice && <p className="inline-notice" role="status">{notice}</p>}
    {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
  </section>;
}

export default DrawingEditorEntry;
