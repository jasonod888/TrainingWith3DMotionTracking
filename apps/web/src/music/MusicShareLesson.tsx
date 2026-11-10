import {useEffect, useState} from 'react';
import {ArrowLeft, Mail, Lock, X} from 'lucide-react';
import {ApiError, request} from '../api';

type Sharing = {
  mode: 'private' | 'invite' | 'link';
  published_revision_id: string | null;
  accepted_revision_id: string | null;
  draft_revision_id: string | null;
  students: {id: string; email: string; active: boolean; revoked: boolean}[];
  invitations: {id: string; email: string; expires_at: string}[];
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
  const [email, setEmail] = useState('');
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
    return () => { stopped = true; };
  }, [path]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'That action could not be completed.'); }
    finally { setBusy(false); }
  };

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
        <p>This music lesson cannot be shared by link, with a group or publicly. It has no public listing.</p>
      </div></div>
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
