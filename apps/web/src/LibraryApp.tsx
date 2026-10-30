import {useCallback,useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,LogOut,MoveUpRight,Play,Plus,Rotate3D,Scissors,Trash2,User,Video} from 'lucide-react';
import type {LessonManifest,Section} from '../../../packages/lesson-schema/index';
import {LessonWorkspace} from './LessonWorkspace';
import {CreateLesson,ConversionList} from './CreateLesson';
import {ApiError,assetUrl,copyDemo,getSession,loadDemo,loadLesson,loadLibrary,request,saveSections,signIn,signOut,type Account} from './api';

type Page='library'|'practice'|'review'|'create'|'account';
type AuthView='login'|'register'|'forgot'|'reset'|'verify';
const stamp=(time:number)=>`${Math.floor(time/60)}:${Math.floor(time%60).toString().padStart(2,'0')}`;
const linkAction=()=>{const match=location.hash.match(/^#(verify|reset)=([A-Za-z0-9_-]{32,128})$/);return match?{view:match[1] as AuthView,token:match[2]}:null;};

export function App(){
 const [initialLink,setInitialLink]=useState(linkAction);
 const [page,setPage]=useState<Page>(initialLink?'account':'library'),[account,setAccount]=useState<Account|null>(null),[library,setLibrary]=useState<LessonManifest[]>([]),[demo,setDemo]=useState<LessonManifest|null>(null),[lesson,setLesson]=useState<LessonManifest|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{const session=await getSession();setAccount(session?.account??null);const [preview,saved]=await Promise.all([loadDemo(),session?loadLibrary():Promise.resolve([])]);setDemo(preview);setLibrary(saved);}
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[]);
 useEffect(()=>{if(initialLink)history.replaceState(null,'',location.pathname+location.search);void refresh();},[refresh,initialLink]);
 const navigate=(next:Page)=>{if(dirty&&!window.confirm('Leave without saving your changes?'))return;setDirty(false);setNotice('');setError('');setPage(next);window.scrollTo({top:0});};
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===401){setAccount(null);setLibrary([]);setLesson(null);setPage('account');}}finally{setBusy(false);}};
 const open=(value:LessonManifest,review=false)=>void run(async()=>{const current=value.animation.key.startsWith('lessons/')?await loadLesson(value.lesson_id):value;setLesson(current);navigate(review?'review':'practice');});
 const importDemo=()=>void run(async()=>{if(!account){navigate('account');return;}const value=await copyDemo();setLibrary(previous=>[value,...previous]);setLesson(value);navigate('review');setNotice('Private copy added to your library.');});
 const saved=!!lesson?.animation.key.startsWith('lessons/');
 const save=async(sections:Section[],title:string)=>{
  if(!lesson)return;
  if(saved){const value=await saveSections(lesson,sections,title);setLesson(value);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?value:item));setNotice('Saved to your private library.');}
  else{const value={...lesson,section_set:{...lesson.section_set,sections}};setLesson(value);setDemo(value);setNotice('Draft kept in this session. Add a private copy to save permanently.');}
 };
 return <div className={`app ${page==='practice'?'practising':''}`}>
  <header className="header"><a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('library');}} aria-label="Form home"><span className="brand-symbol">f<MoveUpRight size={14}/></span>form<span className="brand-dot">.</span></a><nav aria-label="Main navigation">{([{id:'library',label:'Library',Icon:BookOpen},{id:'create',label:'Create',Icon:Plus},{id:'account',label:'Account',Icon:User}] as const).map(({id,label,Icon})=><button key={id} aria-label={label} className={`nav-item ${page===id?'active':''}`} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><span className="preview-badge"><i/>{account?'Private library':'Your practice space'}</span></header>
  <main aria-busy={busy||loading}>
   {error&&<div className="inline-notice error-notice" role="alert">{error}{page==='library'&&<button className="back-link" onClick={()=>void refresh()}>Try again</button>}</div>}
   {busy&&<p className="operation-status" role="status">One moment…</p>}
   {page==='library'&&<>
    <section className="library-heading"><div><p className="eyebrow">YOUR PRACTICE SPACE</p><h1>A little practice.<br/><span>A lot of progress.</span></h1><p className="subtle">Find your rhythm, one movement at a time.</p></div><button className="primary" onClick={()=>navigate('create')}><Plus size={18}/>Create lesson</button></section>
    {account&&<ConversionList onReady={refresh} onOpen={id=>void run(async()=>{setLesson(await loadLesson(id));navigate('review');})}/>}
    <div className="library-filter"><h2>Your library <span>{library.length}</span></h2><span className="muted small">{account?'Only you can access these lessons':'Sign in to save your practice'}</span></div>
    {loading?<div className="empty-state" role="status"><span className="loader dark"/>Loading your library…</div>:library.length?<div className="lesson-grid saved-grid">{library.map(item=><LessonCard key={item.lesson_id} lesson={item} onOpen={()=>open(item)} onEdit={()=>open(item,true)} onRemove={()=>{if(window.confirm(`Remove “${item.title}” from your library?`))void run(async()=>{await request(`/lessons/${item.lesson_id}`,'DELETE');setLibrary(previous=>previous.filter(value=>value.lesson_id!==item.lesson_id));});}}/>)}</div>:<div className="empty-library"><BookOpen size={28} strokeWidth={1.2}/><div><h3>Your next movement starts here.</h3><p className="subtle">{account?'Add a lesson to make it yours.':'Save your sections. Come back anytime.'}</p></div><button className="secondary" onClick={()=>navigate(account?'create':'account')}>{account?'Add a lesson':'Sign in'}<ArrowRight size={16}/></button></div>}
    {demo&&!loading&&<><div className="library-filter demo-heading"><h2>Explore a movement</h2><span className="muted small">Try it at your pace</span></div><div className="lesson-grid"><LessonCard lesson={demo} demonstration onOpen={()=>open(demo)} onEdit={()=>open(demo,true)}/><div className="library-note"><span className="note-art"><Rotate3D size={38} strokeWidth={1}/></span><h3>Learn it your way.</h3><p>Slow it down. Break it up.<br/>Make each movement yours.</p><button className="secondary" disabled={busy} onClick={importDemo}>{account?'Add private copy':'Sign in to save'}<Plus size={16}/></button></div></div>{<button className="secondary mobile-import" disabled={busy} onClick={importDemo}>{account?'Add private copy':'Sign in to save'}<Plus size={16}/></button>}</>}
    <footer className="library-footer"><span className="tiny-orbit"/>Space to move. Room to grow.</footer>
   </>}
   {(page==='practice'||page==='review')&&lesson&&<LessonWorkspace key={`${lesson.revision_id}-${page}`} lesson={lesson} sections={lesson.section_set.sections} review={page==='review'} persistent={saved} legacyCompatible={saved&&demo?.animation.sha256===lesson.animation.sha256} onBack={()=>navigate('library')} onEdit={()=>navigate(page==='review'?'practice':'review')} onSave={save} onDirty={setDirty} notice={notice}/>}
   {page==='create'&&(account?<CreateLesson onBack={()=>navigate('library')} onDone={()=>{navigate('library');void refresh();}}/>:<section className="coming-screen"><div className="empty-state"><span className="note-art"><Video size={36}/></span><h1>Your next movement.</h1><p className="subtle">Sign in to create a private lesson.</p><button className="primary" onClick={()=>navigate('account')}>Sign in<ArrowRight size={18}/></button></div></section>)}
   {page==='account'&&(account?<section className="account-card"><span className="note-art"><Check size={32}/></span><p className="eyebrow">YOUR OWN SPACE</p><h1>Ready to move.</h1><p className="account-email">{account.email}</p><p className="subtle">Your lessons and sections are saved privately.</p><button className="primary" onClick={()=>navigate('library')}>Your library<ArrowRight size={18}/></button><button className="back-link" disabled={busy} onClick={()=>void run(async()=>{await signOut();setAccount(null);setLibrary([]);setLesson(null);setDemo(null);setNotice('');await refresh();})}><LogOut size={16}/>Sign out</button></section>:<AuthPanel initialLink={initialLink} onSignedIn={async value=>{const savedLibrary=await loadLibrary();setAccount(value);setLesson(null);setLibrary(savedLibrary);setInitialLink(null);setPage('library');}}/>)}
  </main>
 </div>;
}

function LessonCard({lesson,demonstration=false,onOpen,onEdit,onRemove}:{lesson:LessonManifest;demonstration?:boolean;onOpen:()=>void;onEdit:()=>void;onRemove?:()=>void}){
 return <article className="lesson-card"><button className="card-cover" onClick={onOpen} aria-label={`Practise ${lesson.title}`}>{lesson.thumbnail?<img src={assetUrl(lesson.thumbnail.key)} alt="Movement reference"/>:<span className="cover-placeholder"><Rotate3D size={48}/></span>}<span className="cover-tag">{demonstration?'DEMONSTRATION':'PRIVATE'}</span><span className="cover-play"><Play size={24} fill="currentColor"/></span><span className="duration">{stamp(lesson.duration)}</span></button><div className="card-body"><div><p className="eyebrow">{demonstration?'EXPLORE':'YOUR MOVEMENT'}</p><h3>{lesson.title}</h3><p className="muted small">{lesson.section_set.sections.length} sections · At your pace</p></div><button className="round" onClick={onOpen} aria-label={`Open ${lesson.title}`}><ArrowRight size={21}/></button></div><div className="card-footer"><button onClick={onEdit}><Scissors size={15}/>Edit sections</button>{onRemove?<button aria-label={`Remove ${lesson.title}`} onClick={onRemove}><Trash2 size={15}/></button>:<span className="small muted">Local reference</span>}</div></article>;
}

function AuthPanel({initialLink,onSignedIn}:{initialLink:{view:AuthView;token:string}|null;onSignedIn:(account:Account)=>Promise<void>}){
 const [view,setView]=useState<AuthView>(initialLink?.view??'login'),[token,setToken]=useState(initialLink?.token??''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const change=(next:AuthView)=>{setView(next);setPassword('');setMessage('');setError('');};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{
  if(view==='login'){await onSignedIn(await signIn(email,password));setPassword('');}
  else {const endpoint={register:'register',forgot:'forgot',verify:'verify',reset:'reset'}[view];const value=await request<{message:string}>(`/auth/${endpoint}`,'POST',view==='verify'?{token}:view==='reset'?{token,password}:view==='forgot'?{email}:{email,password});setMessage(value.message);setPassword('');if(view==='reset'||view==='verify'){setToken('');setView('login');}}
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const title={login:'Welcome back.',register:'Your own space.',forgot:'Find your way back.',reset:'A fresh start.',verify:'One last step.'}[view];
 return <section className="auth-panel"><p className="eyebrow">SPACE TO MOVE</p><h1>{title}</h1><p className="subtle">{view==='login'?'Sign in to your private library.':view==='register'?'Save your lessons. Learn at your pace.':view==='verify'?'Confirm your email to start practising.':view==='forgot'?'We’ll email you a reset link.':'Choose a new password.'}</p><form onSubmit={e=>void submit(e)}>
  {!['verify','reset'].includes(view)&&<label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>}
  {['login','register','reset'].includes(view)&&<label>Password<input type="password" autoComplete={view==='login'?'current-password':'new-password'} required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/>{view!=='login'&&<span className="small muted">At least 12 characters.</span>}</label>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}{message&&<p className="inline-notice" role="status">{message}</p>}
  <button className="primary" disabled={busy}>{busy?'One moment…':{login:'Sign in',register:'Create account',forgot:'Send reset link',reset:'Save password',verify:'Verify email'}[view]}<ArrowRight size={18}/></button>
 </form><div className="auth-links">{view==='login'?<><button className="back-link" disabled={busy} onClick={()=>change('register')}>Create account</button><button className="back-link" disabled={busy} onClick={()=>change('forgot')}>Forgot password?</button><button className="back-link" disabled={busy||!email} onClick={()=>{setBusy(true);setError('');request<{message:string}>('/auth/resend','POST',{email}).then(value=>setMessage(value.message)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Resend verification email</button></>:<button className="back-link" disabled={busy} onClick={()=>change('login')}>Back to sign in</button>}</div></section>;
}
