import {useEffect, useState} from 'react';
import {ArrowLeft, Globe} from 'lucide-react';
import {loadPublishability, updatePublic, type Publishability} from '../../api';
import {availableRoles, readiness, rolesSummary, type PublicationView} from '../../sharing/publication-readiness';
import {invalidateLessonContext} from '../../app/lesson-context';

export function DrawingShareLesson({lessonId, title, onBack, onChange}: {
  lessonId: string; title: string; onBack: () => void; onChange?: () => void;
}) {
  const [publishability, setPublishability] = useState<Publishability | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [publicTitle, setPublicTitle] = useState(title);
  const [tags, setTags] = useState('drawing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const view: PublicationView = {actId: 'drawing', hasAnimation: false, hasPreviewVideo: false,
    hasReference: true, hasPoster: true, accepted: true};
  const available = availableRoles(view);
  const readinessState = readiness({view, audience: 'public', roles, rightsAcknowledged: rights});
  useEffect(() => {
    let stopped = false;
    loadPublishability(lessonId, 'public', roles).then(value => {
      if (!stopped) { setPublishability(value); if (!roles.length) setRoles(value.roles); }
    }).catch(() => {});
    return () => { stopped = true; };
  }, [lessonId, roles.join(',')]);

  const publish = async () => {
    if (!readinessState.enabled) { setError(readinessState.reason); return; }
    setBusy(true); setError('');
    try {
      await updatePublic(lessonId, {listed: true, title: publicTitle.trim(), creator_name: 'Creator',
        tags: tags.split(',').map(value => value.trim()).filter(Boolean),
        rights_acknowledged: true, public_roles: roles});
      invalidateLessonContext(lessonId);
      setNotice('This drawing lesson is now public.');
      setRights(false);
      onChange?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish.'); }
    finally { setBusy(false); }
  };
  const unlist = async () => {
    setBusy(true);
    try { await updatePublic(lessonId, {listed: false}); invalidateLessonContext(lessonId);
      setNotice('This drawing lesson is no longer public.'); onChange?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not unlist.'); }
    finally { setBusy(false); }
  };

  return <section className="share-sheet" aria-label="Share drawing">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>{title}</button>
    <div className="share-heading"><p className="eyebrow">DRAWING · PUBLIC</p><h1>Share the steps.</h1></div>
    {available.length ? available.map(role => <label className="check-line" key={role}>
      <input type="checkbox" checked={roles.includes(role)} disabled={busy}
        onChange={event => setRoles(current => event.target.checked
          ? [...current, role] : current.filter(value => value !== role))}/>
      <span>{rolesSummary([role])}</span>
    </label>) : <p role="status">No approved drawing representation yet.</p>}
    <p className="small muted" role="status">{readinessState.reason ||
      (publishability?.publishable ? 'Ready to publish.' : 'Choose a representation and confirm rights.')}</p>
    <label>Public title<input value={publicTitle} disabled={busy}
      onChange={event => setPublicTitle(event.target.value)}/></label>
    <label>Tags<input value={tags} disabled={busy}
      onChange={event => setTags(event.target.value)}/></label>
    <label className="check-line"><input type="checkbox" checked={rights} disabled={busy}
      onChange={event => setRights(event.target.checked)}/>
      <span>I have the right to publish this drawing publicly.</span></label>
    <div className="inline-actions">
      <button className="primary" disabled={busy || !readinessState.enabled} onClick={() => void publish()}>
        <Globe size={16}/>Publish drawing
      </button>
      <button className="secondary" disabled={busy} onClick={() => void unlist()}>Unlist</button>
    </div>
    {notice && <p role="status" className="inline-notice">{notice}</p>}
    {error && <p role="alert" className="inline-notice error-notice">{error}</p>}
  </section>;
}

export default DrawingShareLesson;
