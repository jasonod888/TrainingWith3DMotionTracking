import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Copy,Globe,Link,Mail,Lock,Share2,Users,X} from 'lucide-react';
import type {LessonManifest} from '../../../packages/lesson-schema/index';
import {ApiError,request,type Account,addMoveToGroup,createGroup,loadGroups,updatePublic,type GroupSummary} from './api';

type Sharing={mode:'private'|'invite'|'link';published_revision_id:string|null;draft_revision_id:string;accepted_revision_id:string|null;
 public_listed:boolean;groups:number;public_listing:{title:string;creator_name:string;description:string;tags:string[]}|null;link_active:boolean;link_expires_at:string|null;
 students:{id:string;email:string;active:boolean;revoked:boolean;source:string;last_active_at:string|null}[];
 invitations:{id:string;email:string;expires_at:string}[];summary:{accepted:number;active:number;recently_practised:number}};
export type IncomingShare={lesson_id?:string;key?:string;invite?:string};
export function incomingShare():IncomingShare|null{
 const values=new URLSearchParams(location.hash.slice(1));const invite=values.get('invite'),key=values.get('key'),lesson_id=values.get('lesson');
 if(invite&&/^[A-Za-z0-9_-]{32,128}$/.test(invite))return {invite};
 if(key&&lesson_id&&/^[A-Za-z0-9_-]{32,128}$/.test(key)&&/^[a-f0-9]{32}$/.test(lesson_id))return {key,lesson_id};
 return null;
}

export function ShareLesson({lesson,onBack,onChange}:{lesson:LessonManifest;onBack:()=>void;onChange:()=>void}){
 const [data,setData]=useState<Sharing|null>(null),[tab,setTab]=useState<'friends'|'group'|'link'|'public'>('friends'),[reviewed,setReviewed]=useState(false);
 const [groups,setGroups]=useState<GroupSummary[]>([]),[selectedGroup,setSelectedGroup]=useState(''),[newGroup,setNewGroup]=useState('');
 const [publicTitle,setPublicTitle]=useState(''),[creatorName,setCreatorName]=useState(''),[publicTags,setPublicTags]=useState(''),[publicDescription,setPublicDescription]=useState('');
 const [email,setEmail]=useState(''),[emails,setEmails]=useState<string[]>([]),[link,setLink]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const path=`/lessons/${lesson.lesson_id}`;
 const load=async()=>{const value=await request<Sharing>(path+'/sharing');setData(value);return value;};
 useEffect(()=>{let stopped=false;request<Sharing>(path+'/sharing').then(value=>{if(!stopped){setData(value);setTab(value.mode==='link'?'link':'friends');}}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[path]);
 useEffect(()=>{loadGroups().then(value=>setGroups(value.groups)).catch(()=>{});},[]);
 useEffect(()=>{if(!data)return;if(data.public_listing){setPublicTitle(data.public_listing.title);setCreatorName(data.public_listing.creator_name);setPublicDescription(data.public_listing.description);setPublicTags(data.public_listing.tags.join(', '));}else{setPublicTitle(lesson.title);setPublicTags('');}},[data,lesson.title]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const ensurePublished=async()=>{
  if(data?.published_revision_id===lesson.revision_id&&data.mode!=='private')return;
  const mode=data?.mode==='link'?'link':'invite';
  await request(path+'/publish','POST',{revision_id:data?.published_revision_id??lesson.revision_id,keep_current_release:true,mode,reviewed:true,rights_acknowledged:true});
 };
 const addEmail=()=>{const value=email.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)){setError('Enter a valid email address.');return;}if(emails.includes(value)){setError('That person is already on the list.');return;}setEmails(previous=>[...previous,value]);setEmail('');setError('');};
 const send=()=>void run(async()=>{
  if(!emails.length)throw new Error('Add at least one person first.');
  if(!reviewed)throw new Error('Confirm you have the right to share this move.');
  await ensurePublished();
  const failed:string[]=[],problems:string[]=[];let sent=0,alreadyPending=0;
  for(const value of emails){try{await request(path+'/invitations','POST',{email:value});sent++;}catch(e){if(e instanceof ApiError&&e.status===409&&e.message.includes('already pending'))alreadyPending++;else{failed.push(value);problems.push(`${value}: ${(e as Error).message}`);}}}
  setEmails(failed);setNotice(`${sent} invitation${sent===1?'':'s'} sent.${alreadyPending?` ${alreadyPending} already pending; no duplicate sent.`:''}${failed.length?' Retry the remaining people below.':''}`);
  setError(problems.join(' '));if(!failed.length)setReviewed(false);await load();onChange();
 });
 const createLink=()=>void run(async()=>{
  if(!reviewed)throw new Error('Confirm you have the right to share this move.');
  const result=await request<{link:string|null}>(path+'/publish','POST',{revision_id:data?.published_revision_id??lesson.revision_id,keep_current_release:true,mode:'link',reviewed:true,rights_acknowledged:true,rotate_link:true});
  setLink(result.link??'');setNotice('Link ready. Anyone with it can open this move for 30 days.');await load();onChange();
 });
 const makePrivate=()=>{if(!window.confirm('Stop sharing this move? Everyone loses access.'))return;void run(async()=>{await request(path+'/unpublish','POST');setLink('');setNotice('This move is private again.');await load();onChange();});};
 const revokeStudent=(id:string)=>void run(async()=>{await request(path+'/students/'+id,'DELETE');setNotice('Access removed.');await load();onChange();});
 const revokeInvitation=(id:string)=>void run(async()=>{await request(path+'/invitations/'+id,'DELETE');setNotice('Invitation cancelled.');await load();onChange();});
 const shareGroup=()=>void run(async()=>{if(!selectedGroup)throw new Error('Choose a group first.');if(!reviewed)throw new Error('Confirm you have the right to share this move.');await addMoveToGroup(selectedGroup,lesson.lesson_id);setNotice('Shared with the group.');setReviewed(false);await load();onChange();});
 const savePublic=()=>void run(async()=>{
  if(!reviewed)throw new Error('Confirm you have the right to share this move publicly.');
  await updatePublic(lesson.lesson_id,{listed:true,title:publicTitle,description:publicDescription,creator_name:creatorName,
   release_revision_id:data?.public_listed?undefined:lesson.revision_id,tags:publicTags.split(',').map(value=>value.trim()).filter(Boolean),rights_acknowledged:true});
  setNotice('This move is now public.');setReviewed(false);await load();onChange();
 });
 const unlist=()=>void run(async()=>{await updatePublic(lesson.lesson_id,{listed:false});setNotice('This move is no longer public.');await load();onChange();});
 const active=data?data.students.filter(person=>person.active&&!person.revoked).length:0,pending=data?.invitations.length??0;
 const audience=[active?`${active} ${active===1?'person':'people'}`:'',pending?`${pending} invited`:'',data?.link_active?'Link':'',data?.groups?`${data.groups} ${data.groups===1?'group':'groups'}`:'',data?.public_listed?'Public':''].filter(Boolean);
 const isShared=audience.length>0;
 return <section className="share-sheet">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>{lesson.title}</button>
  <div className="share-heading"><p className="eyebrow">SHARE THIS MOVE</p><h1>Send it to someone.</h1><p className="subtle">Choose who can open it. Sharing is optional.</p></div>
  {!data&&!error?<p role="status">Loading who can see this move…</p>:data&&<>
   <div className="audience-summary"><span className="audience-icon"><Lock size={16}/></span><div><strong>{isShared?audience.join(' · '):'Private'}</strong><p>{isShared?(data.public_listed?'This move is public. Other access stays as it is.':'Only the people, groups or link you chose can open this move.'):'Only you can open this move.'}</p></div></div>
   {data.published_revision_id&&data.published_revision_id!==lesson.revision_id&&<div className="check-banner"><span>You have a newer accepted version. Friends, groups and public viewers still see the previous shared version.</span><button className="secondary" disabled={busy||data.accepted_revision_id!==lesson.revision_id} onClick={()=>{if(window.confirm('Update the shared version for everyone who can open this move?'))void run(async()=>{await request(path+'/publish','POST',{revision_id:lesson.revision_id,mode:data.mode==='link'?'link':'invite',reviewed:true,rights_acknowledged:true});setNotice('Shared version updated for everyone.');await load();onChange();});}}>Update shared version</button></div>}
   <div className="share-tabs" role="tablist" aria-label="How to share"><button role="tab" aria-selected={tab==='friends'} className={tab==='friends'?'selected':''} onClick={()=>setTab('friends')}><Users size={16}/>Friends</button><button role="tab" aria-selected={tab==='group'} className={tab==='group'?'selected':''} onClick={()=>setTab('group')}><Users size={16}/>A group</button><button role="tab" aria-selected={tab==='public'} className={tab==='public'?'selected':''} onClick={()=>setTab('public')}><Globe size={16}/>Public</button><button role="tab" aria-selected={tab==='link'} className={tab==='link'?'selected':''} onClick={()=>setTab('link')}><Link size={16}/>Link</button></div>
   {tab==='friends'&&<div className="share-panel">
    <p className="subtle">Invite people by email. They need an account with that email to open the move.</p>
    <div className="invite-row"><label>Email<input type="email" maxLength={254} placeholder="friend@example.com" value={email} disabled={busy} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addEmail();}}}/></label><button className="secondary" disabled={busy} onClick={addEmail}><Mail size={16}/>Add</button></div>
    {emails.length>0&&<div className="selected-people">{emails.map(value=><span key={value} className="person-chip">{value}<button aria-label={`Remove ${value}`} onClick={()=>setEmails(previous=>previous.filter(item=>item!==value))}><X size={13}/></button></span>)}</div>}
    <label className="check-line"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>I have the right to share this move with the people above.</span></label>
    <button className="primary" disabled={busy||!emails.length||!reviewed} onClick={send}><Share2 size={16}/>{busy?'Sending…':emails.length?`Send ${emails.length===1?'invitation':'invitations'}`:'Send invitations'}</button>
   </div>}
   {tab==='group'&&<div className="share-panel">
    <p className="subtle">Everyone in the group can open this move. It does not become public.</p>
    {groups.length?<div className="group-pick">{groups.map(group=><label key={group.id} className={selectedGroup===group.id?'selected':''}><input type="radio" name="share-group" checked={selectedGroup===group.id} onChange={()=>setSelectedGroup(group.id)}/><span><strong>{group.name}</strong><small>{group.members} {group.members===1?'member':'members'} · {group.moves} {group.moves===1?'move':'moves'}</small></span></label>)}</div>:<p className="subtle">No groups yet. You can create one in Groups.</p>}
    <div className="invite-row"><label>New group name<input maxLength={80} value={newGroup} onChange={e=>setNewGroup(e.target.value)}/></label><button className="secondary" disabled={busy||!newGroup.trim()} onClick={()=>void run(async()=>{const group=await createGroup(newGroup.trim());setGroups(previous=>[group,...previous]);setSelectedGroup(group.id);setNewGroup('');setNotice('Group created. Choose Share with group to add this move.');})}>Create group</button></div>
    <label className="check-line"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>I have the right to share this move with this group.</span></label>
    <button className="primary" disabled={busy||!selectedGroup||!reviewed} onClick={shareGroup}><Users size={16}/>{busy?'Sharing…':'Share with group'}</button>
   </div>}
   {tab==='public'&&<div className="share-panel">
    <p className="subtle">Anyone can find this move on Explore. Your original video, email, takes and scores stay private.</p>
    <label>Public title<input maxLength={200} value={publicTitle} disabled={busy} onChange={e=>setPublicTitle(e.target.value)}/></label>
    <label>Your public name<input maxLength={80} placeholder="How people see you" value={creatorName} disabled={busy} onChange={e=>setCreatorName(e.target.value)}/></label>
    <label>Description <span className="small muted">(optional)</span><textarea rows={2} maxLength={500} value={publicDescription} disabled={busy} onChange={e=>setPublicDescription(e.target.value)}/></label>
    <label>Tags <span className="small muted">separate with commas</span><input maxLength={200} placeholder="kick, basics" value={publicTags} disabled={busy} onChange={e=>setPublicTags(e.target.value)}/></label>
    <label className="check-line"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>I have the right to share this move publicly.</span></label>
    <div className="inline-actions"><button className="primary" disabled={busy||!reviewed||!publicTitle.trim()||!creatorName.trim()||!publicTags.trim()} onClick={savePublic}><Globe size={16}/>{busy?'Working…':data.public_listed?'Update public move':'List publicly'}</button>{data.public_listed&&<button className="back-link danger-link" disabled={busy} onClick={unlist}>Remove from public</button>}</div>
    {data.public_listed&&data.published_revision_id!==lesson.revision_id&&<button className="secondary" disabled={busy||!reviewed} onClick={()=>void run(async()=>{await updatePublic(lesson.lesson_id,{listed:true,release_revision_id:lesson.revision_id,rights_acknowledged:true});setNotice('Shared version updated for friends, groups and public viewers.');await load();onChange();})}>Share this accepted version with everyone</button>}
    <p className="small muted">Only the accepted 3D move and these details are public. Everyone follows the same shared version.</p>
   </div>}
   {tab==='link'&&<div className="share-panel">    <p className="subtle">A link anyone can open. Handy for a group chat; it can be forwarded, so use invitations for a private share.</p>
    {link?<div className="share-link-box"><input aria-label="Share link" readOnly value={link}/><button className="secondary" onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice('Link copied.')).catch(()=>setNotice('Select the link to copy it.'))}><Copy size={16}/>Copy</button></div>:data.link_active?<p className="small muted">A link is active. Create a new link to see it again; the previous link stops working.</p>:null}
    <label className="check-line"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/><span>I have the right to share this move by link.</span></label>
    <button className="primary" disabled={busy||!reviewed} onClick={createLink}><Link size={16}/>{busy?'Working…':data.link_active?'Create a new link':'Create link'}</button>
    <p className="small muted">Links last 30 days and can be forwarded.</p>
   </div>}
   {(active>0||pending>0||data.groups>0||data.public_listed)&&<details className="manage-access"><summary>Manage access</summary>
    {data.public_listed&&<p className="person-row"><span>Publicly listed</span><span className="small muted">Anyone can find it</span></p>}
    {data.groups>0&&<p className="person-row"><span>{data.groups} {data.groups===1?'group':'groups'}</span><span className="small muted">Members can open it</span></p>}
    {data.students.filter(person=>person.active&&!person.revoked).map(person=><div className="person-row" key={person.id}><span>{person.email}</span><button className="back-link" disabled={busy} onClick={()=>revokeStudent(person.id)}>Remove</button></div>)}
    {data.invitations.map(invitation=><div className="person-row" key={invitation.id}><span>{invitation.email} <small className="muted">invited</small></span><button className="back-link" disabled={busy} onClick={()=>revokeInvitation(invitation.id)}>Cancel</button></div>)}
    {data.mode!=='private'&&<button className="back-link danger-link" disabled={busy} onClick={makePrivate}><Lock size={14}/>Make private</button>}
   </details>}
   {notice&&<p className="inline-notice" role="status">{notice}</p>}
  </>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
 </section>;
}

export function JoinLesson({incoming,account,onSignIn,onJoined,onBack}:{incoming:IncomingShare;account:Account|null;onSignIn:()=>void;onJoined:(lesson:LessonManifest)=>void;onBack:()=>void}){
 const [info,setInfo]=useState<{title:string;sections:number;duration:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!account)return;let stopped=false;request<{title:string;sections:number;duration:number}>('/shares/inspect','POST',incoming).then(value=>{if(!stopped)setInfo(value);}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[incoming,account]);
 return <section className="join-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={17}/>My moves</button><div className="join-card"><span className="note-art"><Users size={34}/></span><p className="eyebrow">A MOVE SHARED WITH YOU</p><h1>{info?.title??'Someone sent you a move.'}</h1>{info&&<p className="subtle">{info.sections} {info.sections===1?'part':'parts'} · At your pace</p>}{!account?<><p className="subtle">Sign in to open this move.</p><button className="primary" onClick={onSignIn}>Sign in<ArrowRight size={17}/></button></>:info?<><p className="small muted">The person who shared this can see that you joined. Your camera stays private.</p><button className="primary" disabled={busy} onClick={()=>{setBusy(true);setError('');request<LessonManifest>('/shares/accept','POST',incoming).then(onJoined).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Opening…':'Try this move'}<ArrowRight size={17}/></button></>:!error?<p role="status">Checking your invitation…</p>:null}{error&&<p className="inline-notice error-notice" role="alert">{error}</p>}</div></section>;
}
