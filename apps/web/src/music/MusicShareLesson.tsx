import {useEffect, useState} from 'react';
import {ArrowLeft, Globe, Mail, Lock, X} from 'lucide-react';
import {ApiError, loadPublishability, request, type Publishability} from '../api';
import {availableRoles, readiness, rolesSummary, type PublicationView} from '../sharing/publication-readiness';
import {usePublicationController} from '../sharing/usePublicationController';

type Sharing = {
  mode: 'private' | 'invite' | 'link';
  published_revision_id: string | null;
  accepted_revision_id: string | null;
  draft_revision_id: string | null;
  students: {id: string; email: string; active: boolean; revoked: boolean}[];
  invitations: {id: string; email: string; expires_at: string}[];
  public_listed?: boolean;
};

/**
 * Private release for a reviewed music lesson. Only the existing email invitation
 * workflow is offered: no link, group or public audience, and no automatic publishing.
 */
export function MusicShareLesson({lessonId, title, onBack, onChange}: {
  lessonId: string; title: string; onBack: () => void; onChange?: () => void;
}) {
  const path = `/lessons/${encodeURIComponent(lessonId)}`;
  const [data, setData] = useState<Sharing | null>(null);
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [publishability, setPublishability] = useState<Publishability | null>(null);
  const [publicRoles, setPublicRoles] = useState<string[]>([]);
  const [rights, setRights] = useState(false);
  const [publicTitle, setPublicTitle] = useState(title);
  const [creatorName, setCreatorName] = useState('Creator');
  const [tags, setTags] = useState('music');
  const [email, setEmail] = useState('');
  const publication = usePublicationController({lessonId, initialRoles: []});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => setData(await request<Sharing>(path + '/sharing'));
  useEffect(() => {
    let stopped = false;
    request<Sharing>(path + '/sharing')
      .then(value => { if (!stopped) setData(value); })
      .catch(cause => { if (!stopped) setError(cause.message); });
    request<Record<string, unknown>>(`/lessons/${encodeURIComponent(lessonId)}`, 'GET', undefined, false,
      {'X-Lesson-Formats': '1,2'})
      .then(value => { if (!stopped) setManifest(value); })
      .catch(() => { if (!stopped) setManifest(null); });
    return () => { stopped = true; };
  }, [path, lessonId]);

  const view: PublicationView = {
    actId: manifest?.subject === 'guitar' ? 'guitar' : 'piano',
    hasAnimation: false,
    hasPreviewVideo: Boolean(manifest?.playable_preview || manifest?.preview_video),
    hasReference: Boolean(manifest?.reference),
    hasPoster: Boolean(manifest?.public_poster || manifest?.poster),
    accepted: Boolean(data?.accepted_revision_id) && data?.accepted_revision_id === data?.draft_revision_id,
  };
  const available = availableRoles(view);
  const publicReadiness = readiness({view, audience: 'public', roles: publicRoles,
    rightsAcknowledged: rights});

  useEffect(() => {
    let stopped = false;
    if (!view.accepted) return () => { stopped = true; };
    loadPublishability(lessonId, 'public', publicRoles).then(value => {
      if (stopped) return;
      setPublishability(value);
      if (!publicRoles.length && value.roles.length) setPublicRoles(value.roles);
    }).catch(() => { /* readiness UI still uses the local mirror */ });
    return () => { stopped = true; };
  }, [lessonId, view.accepted, publicRoles.join(',')]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'That action could not be completed.'); }
    finally { setBusy(false); }
  };

  const savePublic = () => void run(async () => {
    if (!publicReadiness.enabled) throw new Error(publicReadiness.reason);
    const ok = await publication.publish({
      listed: true, title: publicTitle.trim(), creatorName: creatorName.trim(),
      tags: tags.split(',').map(value => value.trim()).filter(Boolean),
      rightsAcknowledged: true, roles: publicRoles,
    } as never);
    if (!ok) throw new Error(publication.error || 'This music lesson could not be published.');
    setNotice('This music lesson is now public.');
    setRights(false);
    await load(); onChange?.();
  });
  const unlistPublic = () => void run(async () => {
    if (!(await publication.unlist())) throw new Error(publication.error || 'This music lesson could not be unpublished.');
    setNotice('This music lesson is no longer public.');
    await load(); onChange?.();
  });

  const ensurePublished = async () => {
    // Inviting a new person never changes what existing recipients are watching.
    if (data?.published_revision_id && data.mode === 'invite') return;
    if (!data?.accepted_revision_id || data.accepted_revision_id !== data.draft_revision_id)
      throw new Error('Review and save the latest music reference before sharing it.');
    await request(path + '/publish', 'POST', {
      revision_id: data.accepted_revision_id, mode: 'invite', reviewed: true, rights_acknowledged: true,
    });
  };

  const updateRelease = () => {
    if (!window.confirm('Update the shared music version for everyone who can open this lesson?')) return;
    void run(async () => {
      if (!data?.accepted_revision_id || data.accepted_revision_id !== data.draft_revision_id)
        throw new Error('Review the latest reference before updating the shared version.');
      await request(path+'/publish','POST',{revision_id:data.accepted_revision_id,mode:'invite',reviewed:true,rights_acknowledged:true});
      setNotice('Shared version updated for everyone.');
      await load();onChange?.();
    });
  };

  const send = () => void run(async () => {
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
    if (!confirmed) throw new Error('Confirm you have the right to share this lesson with this person.');
    await ensurePublished();
    try {
      await request(path + '/invitations', 'POST', {email: value});
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.message.includes('already pending')) {
        setNotice('That person already has a pending invitation.');
        await load();
        return;
      }
      throw cause;
    }
    setEmail(''); setConfirmed(false);
    setNotice(`Invitation sent to ${value}.`);
    await load(); onChange?.();
  });

  const makePrivate = () => {
    if (!window.confirm('Stop sharing this music lesson? Everyone loses access.')) return;
    void run(async () => {
      await request(path + '/unpublish', 'POST');
      setNotice('This music lesson is private again.');
      await load(); onChange?.();
    });
  };

  const revoke = (invitationId: string) => void run(async () => {
    await request(path + '/invitations/' + encodeURIComponent(invitationId), 'DELETE');
    setNotice('Invitation cancelled.');
    await load(); onChange?.();
  });

  const remove = (accountId: string) => void run(async () => {
    await request(path + '/students/' + encodeURIComponent(accountId), 'DELETE');
    setNotice('Access removed.');
    await load(); onChange?.();
  });

  const published = Boolean(data?.published_revision_id) && data?.mode === 'invite';
  const latestReviewed = Boolean(data?.accepted_revision_id) && data?.accepted_revision_id === data?.draft_revision_id;
  const accepted = published || latestReviewed;

  return <section className="share-sheet music-share">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>{title}</button>
    <div className="share-heading">
      <p className="eyebrow">PRIVATE MUSIC LESSON</p>
      <h1>Send it to someone.</h1>
      <p className="subtle">Only the people you invite can open this reviewed music lesson.</p>
    </div>
    {!data && !error ? <p role="status">Loading who can see this lesson…</p> : data && <>
      <div className="audience-summary"><span className="audience-icon"><Lock size={16}/></span><div>
        <strong>{published ? 'Invitation only' : 'Private'}</strong>
        <p>Invite people directly, or publish the approved public representation below.</p>
      </div></div>
      {accepted && <div className="share-panel">
        <h2><Globe size={16}/> Public gallery</h2>
        {available.length ? available.map(role => <label className="check-line" key={role}>
          <input type="checkbox" checked={publicRoles.includes(role)} disabled={busy}
            onChange={event => setPublicRoles(current => event.target.checked
              ? [...current, role] : current.filter(value => value !== role))}/>
          <span>{rolesSummary([role])}</span>
        </label>) : <p className="inline-notice" role="status">No approved public representation yet. Add a preview video or reviewed reference.</p>}
        <p className="small muted" role="status">
          {publicReadiness.reason || (publishability?.publishable
            ? 'Server readiness confirmed. Choose representations and confirm rights.'
            : 'Choose at least one representation, then confirm rights.')}
        </p>
        <label>Public title<input maxLength={200} value={publicTitle} disabled={busy}
          onChange={event => setPublicTitle(event.target.value)}/></label>
        <label>Creator name<input maxLength={80} value={creatorName} disabled={busy}
          onChange={event => setCreatorName(event.target.value)}/></label>
        <label>Tags<input maxLength={200} value={tags} disabled={busy}
          onChange={event => setTags(event.target.value)}/></label>
        <label className="check-line"><input type="checkbox" checked={rights} disabled={busy}
          onChange={event => setRights(event.target.checked)}/>
          <span>I have the right to publish this music lesson publicly.</span></label>
        <div className="inline-actions">
          <button className="primary" disabled={busy || !publicReadiness.enabled}
            onClick={savePublic}><Globe size={16}/>List publicly</button>
          {data.public_listed && <button className="secondary" disabled={busy}
            onClick={unlistPublic}>Remove from public</button>}
        </div>
      </div>}
      {!accepted && <p className="inline-notice" role="status">Save the reviewed reference before sharing this music lesson.</p>}
      {published && data.published_revision_id !== data.draft_revision_id && <div className="check-banner">
        <span>People keep the current shared version, including new invitees. Review and explicitly update to release your newer changes.</span>
        <button className="secondary" disabled={busy||!latestReviewed} onClick={updateRelease}>Update shared version</button>
      </div>}
      {accepted && <>
        <div className="share-panel">
          <h2>Invite by email</h2>
          <p className="subtle">They need an account with that email address. Access is private and can be removed.</p>
          <div className="invite-row"><label>Email<input type="email" maxLength={254} placeholder="friend@example.com"
            value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/></label></div>
          <label className="check-line"><input type="checkbox" checked={confirmed} disabled={busy}
            onChange={event => setConfirmed(event.target.checked)}/><span>I have the right to share this music lesson with this person.</span></label>
          <button className="primary" disabled={busy || !email.trim() || !confirmed} onClick={send}>
            <Mail size={16}/>{busy ? 'Sending…' : 'Send invitation'}
          </button>
        </div>
        {data.invitations.length > 0 && <div className="share-panel">
          <h2>Pending invitations <span>{data.invitations.length}</span></h2>
          {data.invitations.map(invitation => <div className="person-row" key={invitation.id}>
            <span>{invitation.email}<small className="muted"> · invited</small></span>
            <button className="back-link" disabled={busy} onClick={() => revoke(invitation.id)}><X size={14}/>Cancel</button>
          </div>)}
        </div>}
        {data.students.filter(person => !person.revoked).length > 0 && <div className="share-panel">
          <h2>People with access</h2>
          {data.students.filter(person => !person.revoked).map(person => <div className="person-row" key={person.id}>
            <span>{person.email}{!person.active ? <small className="muted"> · inactive</small> : null}</span>
            <button className="back-link" disabled={busy} onClick={() => remove(person.id)}>Remove</button>
          </div>)}
        </div>}
        {published && <button className="secondary" disabled={busy} onClick={makePrivate}><Lock size={15}/>Make private</button>}
      </>}
      {notice && <p className="inline-notice" role="status">{notice}</p>}
      {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
    </>}
    {!data && error && <p className="inline-notice error-notice" role="alert">{error}</p>}
  </section>;
}

export default MusicShareLesson;
