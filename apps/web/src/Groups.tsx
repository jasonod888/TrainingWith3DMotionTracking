import {useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,Plus,Share2,Trash2,UserPlus,Users} from 'lucide-react';
import {request,createGroup,inspectGroupInvite,inviteToGroup,joinGroup,loadGroup,loadGroups,removeGroupMember,removeGroupMove,transferGroup,type GroupDetail,type GroupSummary} from './api';

export function GroupsPage({onBack,onOpen}:{onBack:()=>void;onOpen:(id:string)=>void}){
 const [groups,setGroups]=useState<GroupSummary[]>([]),[name,setName]=useState(''),[description,setDescription]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=()=>loadGroups().then(value=>setGroups(value.groups)).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 const create=async()=>{setBusy(true);setError('');try{const value=await createGroup(name,description);setName('');setDescription('');setCreating(false);await load();onOpen(value.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="groups-screen">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>My moves</button>
  <div className="share-heading"><p className="eyebrow">GROUPS</p><h1>Practise together.</h1><p className="subtle">A group is a small shared collection of moves. No chat, no live room.</p></div>
  {creating?<div className="group-create"><label>Group name<input value={name} maxLength={80} placeholder="Tuesday practice" onChange={e=>setName(e.target.value)}/></label><label>Description <span className="small muted">(optional)</span><textarea value={description} maxLength={500} rows={2} onChange={e=>setDescription(e.target.value)}/></label><div className="inline-actions"><button className="primary" disabled={busy||!name.trim()} onClick={()=>void create()}>{busy?'Creating…':'Create group'}</button><button className="back-link" disabled={busy} onClick={()=>setCreating(false)}>Cancel</button></div></div>:<button className="primary" onClick={()=>setCreating(true)}><Plus size={17}/>Create a group</button>}
  {groups.length?<div className="group-list">{groups.map(group=><button key={group.id} className="group-card" onClick={()=>onOpen(group.id)}><span className="group-icon"><Users size={20}/></span><div><strong>{group.name}</strong><p>{group.members} {group.members===1?'member':'members'} · {group.moves} {group.moves===1?'move':'moves'}</p></div><span className="role-tag">{group.role}</span></button>)}</div>:<div className="empty-library"><Users size={28} strokeWidth={1.2}/><div><h3>No groups yet.</h3><p className="subtle">Create one for a class, team or a few friends.</p></div></div>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
 </section>;
}

export function GroupDetailPage({id,account,onBack,onTry}:{id:string;account:{id:string};onBack:()=>void;onTry:(lessonId:string,publicOnly?:boolean)=>void}){
 const [group,setGroup]=useState<GroupDetail|null>(null),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=()=>loadGroup(id).then(setGroup).catch(e=>setError(e.message));
 useEffect(()=>{void load();},[id]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await action();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const invite=()=>void run(async()=>{if(!email.trim())throw new Error('Enter an email address.');await inviteToGroup(id,email.trim());setEmail('');setNotice('Invitation sent.');});
 const removeMove=(lessonId:string,accessKind:'grant'|'collection')=>void run(async()=>{await removeGroupMove(id,lessonId,accessKind);setNotice('Move removed from this group.');});
 const removeMember=(accountId:string)=>void run(async()=>{await removeGroupMember(id,accountId);setNotice('Member removed.');});
 const leave=()=>{if(!window.confirm('Leave this group? You will lose access to its moves.'))return;void run(async()=>{await removeGroupMember(id,account.id);onBack();});};
 const transfer=(accountId:string)=>void run(async()=>{await transferGroup(id,accountId);setNotice('That member is now the owner.');});
 if(!group)return <section className="groups-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={16}/>Groups</button>{error?<p className="inline-notice error-notice" role="alert">{error}</p>:<p role="status">Loading group…</p>}</section>;
 return <section className="groups-screen">
  <button className="back-link" onClick={onBack}><ArrowLeft size={16}/>Groups</button>
  <div className="share-heading"><p className="eyebrow">{group.role.toUpperCase()} · GROUP</p><h1>{group.name}</h1>{group.description&&<p className="subtle">{group.description}</p>}</div>
  {group.role==='owner'&&<label>Who can add moves?<select disabled={busy} value={group.contribution_policy} onChange={e=>{const contribution_policy=e.target.value;void run(async()=>{await request(`/groups/${id}`,'PATCH',{contribution_policy});setNotice('Group setting saved.');});}}><option value="members">Everyone in the group</option><option value="managers">Owner and admins</option></select></label>}
  <div className="group-columns">
   <div className="group-moves"><div className="group-section-head"><h2>Moves <span>{group.moves.length}</span></h2><span className="small muted">Shared by members</span></div>
    {group.moves.length?group.moves.map(move=><div className="group-move" key={move.lesson_id}><div><strong>{move.title}</strong><p className="small muted">{move.sections} {move.sections===1?'part':'parts'}</p></div><div className="inline-actions"><button className="secondary" onClick={()=>onTry(move.lesson_id,move.access_kind==='collection')}>Try it<ArrowRight size={15}/></button>{move.can_remove&&<button className="round" aria-label={`Remove ${move.title}`} onClick={()=>removeMove(move.lesson_id,move.access_kind)}><Trash2 size={15}/></button>}</div></div>):<p className="subtle">No moves yet. Open a move, choose Share, then A group.</p>}
   </div>
   <div className="group-members"><div className="group-section-head"><h2>Members <span>{group.members.length}</span></h2></div>
    {group.can_manage&&<div className="invite-row"><label>Invite by email<input type="email" placeholder="friend@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label><button className="secondary" disabled={busy} onClick={invite}><UserPlus size={16}/>Invite</button></div>}
    {group.can_manage&&group.invitations.map(invitation=><div className="person-row" key={invitation.id}><span>{invitation.email}<small className="muted"> · invited</small></span><span className="inline-actions"><button className="back-link" disabled={busy} onClick={()=>void run(async()=>{await request(`/groups/${id}/invitations/${invitation.id}`,'DELETE');await inviteToGroup(id,invitation.email);setNotice('New invitation sent.');})}>Resend</button><button className="back-link" disabled={busy} onClick={()=>void run(async()=>{await request(`/groups/${id}/invitations/${invitation.id}`,'DELETE');setNotice('Invitation cancelled.');})}>Cancel</button></span></div>)}
    {group.members.map(member=><div className="person-row" key={member.account_id}><span>{member.email}{member.role!=='member'?<small className="muted"> · {member.role}</small>:null}</span>{group.can_manage&&member.role!=='owner'&&<span className="inline-actions">{group.role==='owner'&&<button className="back-link" disabled={busy} onClick={()=>transfer(member.account_id)}>Make owner</button>}<button className="back-link" disabled={busy} onClick={()=>removeMember(member.account_id)}>Remove</button></span>}</div>)}
   </div>
  </div>
  {group.role!=='owner'&&<button className="back-link danger-link" disabled={busy} onClick={leave}><ArrowLeft size={15}/>Leave group</button>}
  {notice&&<p className="inline-notice" role="status">{notice}</p>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}
  <p className="small muted group-note">Sharing a move here does not make it public. Members can practise it, but your take stays on their device.</p>
 </section>;
}

export function GroupJoinPage({invite,account,onSignIn,onJoined,onBack}:{invite:string;account:{id:string;email:string}|null;onSignIn:()=>void;onJoined:(id:string)=>void;onBack:()=>void}){
 const [info,setInfo]=useState<{name:string;description:string;members:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let stopped=false;inspectGroupInvite(invite).then(value=>{if(!stopped)setInfo(value);}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;};},[invite]);
 return <section className="join-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={17}/>My moves</button><div className="join-card"><span className="note-art"><Users size={34}/></span><p className="eyebrow">A GROUP INVITATION</p><h1>{info?.name??'Join a group.'}</h1>{info&&<p className="subtle">{info.members} {info.members===1?'member':'members'} · Practise together, at your own pace</p>}{!account?<><p className="subtle">Sign in to join this group.</p><button className="primary" onClick={onSignIn}>Sign in<ArrowRight size={17}/></button></>:info?<button className="primary" disabled={busy} onClick={()=>{setBusy(true);setError('');joinGroup(invite).then(value=>onJoined(value.id)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>{busy?'Joining…':'Join group'}<ArrowRight size={17}/></button>:!error?<p role="status">Checking your invitation…</p>:null}{error&&<p className="inline-notice error-notice" role="alert">{error}</p>}</div></section>;
}
