import {useState} from 'react';
import {ArrowLeft, Globe} from 'lucide-react';
import {usePublicationController} from '../../sharing/usePublicationController';
import {readiness, rolesSummary, type PublicationView} from '../../sharing/publication-readiness';

export function DrawingShareLesson({lessonId, title, onBack, onChange}: {
  lessonId: string; title: string; onBack: () => void; onChange?: () => void;
}) {
  const publication = usePublicationController({lessonId, initialRoles: ['reference']});
  const [publicTitle, setPublicTitle] = useState(title);
  const [tags, setTags] = useState('drawing');
  const view: PublicationView = {actId: 'drawing', hasAnimation: false, hasPreviewVideo: false,
    hasReference: true, hasPoster: true, accepted: true};
  const readinessState = readiness({view, audience: 'public', roles: publication.roles,
    rightsAcknowledged: publication.rights});
  const available = publication.publishability?.allowed_roles?.length
    ? publication.publishability.allowed_roles : ['poster', 'reference'];

  const publish = async () => {
    const ok = await publication.publish({title: publicTitle.trim(), creatorName: 'Creator',
      tags: tags.split(',').map(value => value.trim()).filter(Boolean),
      rightsAcknowledged: publication.rights, roles: publication.roles});
    if (ok) { publication.setRights(false); onChange?.(); }
  };
  const unlist = async () => { if (await publication.unlist()) onChange?.(); };

  return <section className="share-sheet" aria-label="Share drawing">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>{title}</button>
    <div className="share-heading"><p className="eyebrow">DRAWING · PUBLIC</p><h1>Share the steps.</h1></div>
    {publication.loading ? <p role="status">Loading publication readiness…</p> : <>
      {available.map(role => <label className="check-line" key={role}>
        <input type="checkbox" checked={publication.roles.includes(role)} disabled={publication.busy}
          onChange={event => publication.setRoles(current => event.target.checked
            ? [...current, role] : current.filter(value => value !== role))}/>
        <span>{rolesSummary([role])}</span>
      </label>)}
      <p className="small muted" role="status">
        {publication.publishability?.reasons?.[0] ?? (publication.publishability?.publishable
          ? (readinessState.reason || 'Ready to publish.') : 'Choose a representation and confirm rights.')}
      </p>
      <label>Public title<input value={publicTitle} disabled={publication.busy}
        onChange={event => setPublicTitle(event.target.value)}/></label>
      <label>Tags<input value={tags} disabled={publication.busy}
        onChange={event => setTags(event.target.value)}/></label>
      <label className="check-line"><input type="checkbox" checked={publication.rights}
        disabled={publication.busy}
        onChange={event => publication.setRights(event.target.checked)}/>
        <span>I have the right to publish this drawing publicly.</span></label>
      <div className="inline-actions">
        <button className="primary" disabled={publication.busy || !readinessState.enabled}
          onClick={() => void publish()}><Globe size={16}/>Publish drawing</button>
        <button className="secondary" disabled={publication.busy}
          onClick={() => void unlist()}>Unlist</button>
      </div>
    </>}
    {publication.notice && <p role="status" className="inline-notice">{publication.notice}</p>}
    {publication.error && <p role="alert" className="inline-notice error-notice">{publication.error}</p>}
  </section>;
}

export default DrawingShareLesson;
