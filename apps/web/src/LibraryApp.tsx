import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Home,Check,Globe,LogOut,MoveUpRight,Menu,Plus,SlidersHorizontal,User,Users,Video} from 'lucide-react';
import type {LessonManifest,LessonSummary,MusicLessonManifest,Section} from '../../../packages/lesson-schema/index';
const MimicReceiver=lazy(()=>import('./MimicReceiver').then(module=>({default:module.MimicReceiver})));
import {LessonWorkspace} from './LessonWorkspace';
import {CreateLesson,ConversionList} from './CreateLesson';
const SectionEditor=lazy(()=>import('./SectionEditor').then(module=>({default:module.SectionEditor})));
const MoveCheck=lazy(()=>import('./MoveCheck').then(module=>({default:module.MoveCheck})));
const MoveDetail=lazy(()=>import('./MoveDetail').then(module=>({default:module.MoveDetail})));
import {GroupsPage,GroupDetailPage,GroupJoinPage} from './Groups';
const ExplorePage=lazy(()=>import('./Public').then(module=>({default:module.ExplorePage})));
const PublicDetailPage=lazy(()=>import('./Public').then(module=>({default:module.PublicDetailPage})));
const AdminPage=lazy(()=>import('./Admin').then(module=>({default:module.AdminPage})));
const MusicHistoryPanel=lazy(()=>import('./music/MusicHistoryPanel').then(module=>({default:module.MusicHistoryPanel})));
const MusicDraftReview=lazy(()=>import('./music/MusicDraftReview').then(module=>({default:module.MusicDraftReview})));
const StudioPage=lazy(()=>import('./Studio').then(module=>({default:module.StudioPage})));
import {ShareLesson,JoinLesson,incomingShare} from './ShareLesson';
import {MusicShareLesson} from './music/MusicShareLesson';
import type {PracticePreferences} from './practice-types';
import {PracticePreview} from './PracticePreview';
import {LessonExperienceHost, MusicLessonScreen} from './LessonExperienceHost';
import {loadLessonDocument} from './lesson-document';
import {summarizeBody} from './lesson-summary';
import {PracticeFeed,type FeedFilter} from './PracticeFeed';
import {AccountMenu} from './AccountMenu';
import {FeedSearch} from './FeedSearch';
import './feed.css';
import {ApiError,assetUrl,loadCapabilities,loadPublicMove,copyDemo,getSession,loadDemo,loadLesson,loadLessonSummaries,loadMoveStates,loadSharedSummaries,needsCheck,request,saveSections,signIn,signOut,type Account,type MoveState} from './api';

type Page='music-review'|'moves'|'preview'|'compete'|'practice'|'review'|'create'|'account'|'share'|'join'|'receiver'|'check'|'move'|'groups'|'group'|'groupjoin'|'explore'|'public'|'studio'|'admin';
type AuthView='login'|'register'|'forgot'|'reset'|'verify';
const linkAction=()=>{const match=location.hash.match(/^#(verify|reset)=([A-Za-z0-9_-]{32,128})$/);return match?{view:match[1] as AuthView,token:match[2]}:null;};
const groupInviteOf=()=>{const match=location.hash.match(/^#group=([A-Za-z0-9_-]{32,128})$/);return match?match[1]:null;};

const routePages=new Set(['music-review','moves','preview','compete','practice','review','create','account','share','join','receiver','check','move','groups','group','groupjoin','explore','public','studio','admin']);
const routeOf=()=>{const q=new URLSearchParams(location.search);return {page:(routePages.has(q.get('page')??'')?q.get('page'):'moves') as Page,id:q.get('id'),source:q.get('source'),adjust:q.get('adjust')};};
const pending=<T,>(key:string,value?:T):T|null=>{try{if(value!==undefined){sessionStorage.setItem(key,JSON.stringify({value,until:Date.now()+30*60*1000}));return value;}const item=JSON.parse(sessionStorage.getItem(key)??'null');if(item?.until>Date.now())return item.value;sessionStorage.removeItem(key);}catch{}return null;};
export function App(){
 const [feedQuery,setFeedQuery]=useState(''),[feedFilter,setFeedFilter]=useState<FeedFilter>('all'),[drawerOpen,setDrawerOpen]=useState(false),[smallScreen,setSmallScreen]=useState(()=>matchMedia('(max-width:760px)').matches),[accountPreferences,setAccountPreferences]=useState(false),[sidebarExpanded,setSidebarExpanded]=useState(()=>window.matchMedia('(min-width:1101px)').matches);
 useEffect(()=>{const media=window.matchMedia('(min-width:1101px)');const change=()=>setSidebarExpanded(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const [initialLink,setInitialLink]=useState(()=>linkAction()??pending<ReturnType<typeof linkAction>>('auth-action'));
 const [groupInvite,setGroupInvite]=useState(()=>groupInviteOf()??(['groupjoin','account'].includes(routeOf().page)?pending<string>('group-invite'):null)),[groupId,setGroupId]=useState<string|null>(routeOf().page==='group'?routeOf().id:null),[publicId,setPublicId]=useState<string|null>(routeOf().page==='public'?routeOf().id:null);
 const [studioEnabled,setStudioEnabled]=useState(()=>localStorage.getItem('form-studio')==='1');
 const setStudio=(value:boolean)=>{setStudioEnabled(value);localStorage.setItem('form-studio',value?'1':'0');};
 const [incoming,setIncoming]=useState(()=>incomingShare()??(['join','account'].includes(routeOf().page)?pending<ReturnType<typeof incomingShare>>('move-invite'):null)),[shared,setShared]=useState<LessonSummary[]>([]),[lessonOwned,setLessonOwned]=useState(true);
 const [page,setPage]=useState<Page>(initialLink?'account':groupInvite?'groupjoin':incoming?'join':routeOf().page),[account,setAccount]=useState<Account|null>(null),[library,setLibrary]=useState<LessonSummary[]>([]),[demo,setDemo]=useState<LessonManifest|null>(null),[lesson,setLesson]=useState<LessonManifest|null>(null),[music,setMusic]=useState<MusicLessonManifest|null>(null),[midiSetup,setMidiSetup]=useState(false),[musicHistory,setMusicHistory]=useState(false),[pianoLibrary,setPianoLibrary]=useState(false),[guitarLibrary,setGuitarLibrary]=useState(false),[shareMusic,setShareMusic]=useState<LessonSummary|null>(null),[subjectFilter,setSubjectFilter]=useState(false);
 useEffect(()=>{setFeedQuery('');setFeedFilter('all');},[account?.id]);
 // History restoration and authentication can change the page without navigate().
 useEffect(()=>{if(!['preview','practice','compete'].includes(page))setMusic(null);},[page]);
 useEffect(()=>{const media=matchMedia('(max-width:760px)');const update=()=>setSmallScreen(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 const drawerNavigation=smallScreen||page==='preview';
 useEffect(()=>{setDrawerOpen(false);},[page,smallScreen]);
 useEffect(()=>{
  if(!drawerOpen)return;
  const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  document.querySelector<HTMLElement>('#primary-navigation button')?.focus();
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setDrawerOpen(false);document.querySelector<HTMLElement>('.feed-sidebar-toggle')?.focus();}};
  window.addEventListener('keydown',escape);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',escape);};
 },[drawerOpen]);
 useEffect(()=>{if(page==='account'&&accountPreferences){const section=document.getElementById('account-preferences');section?.scrollIntoView({block:'center'});section?.focus();setAccountPreferences(false);}},[page,accountPreferences]);
 const [reviewId,setReviewId]=useState<string|null>(routeOf().page==='music-review'?routeOf().id:null);
 const [states,setStates]=useState<MoveState[]>([]),[adjustFor,setAdjustFor]=useState<{lesson_id:string;title:string;subject?:string}|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false);
 const [routeReady,setRouteReady]=useState(false),replaceRoute=useRef(true),restoring=useRef(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{const session=await getSession();setAccount(session?.account??null);const [preview,saved,received,workflow]=await Promise.all([loadDemo(),session?loadLessonSummaries():Promise.resolve([]),session?loadSharedSummaries():Promise.resolve([]),session?loadMoveStates():Promise.resolve({lessons:[]})]);setDemo(preview);setLibrary(saved);setShared(received);setStates(workflow.lessons);
   // The subject filter is a server-controlled rollout: absent or failing means off.
   void loadCapabilities().then(value=>{setSubjectFilter(Boolean(value.subject_filter));setMidiSetup(value.music_midi_setup===true);setMusicHistory(value.music_history===true);setPianoLibrary(value.music_piano_library_ui===true);setGuitarLibrary(value.music_guitar_library_ui===true);}).catch(()=>{setSubjectFilter(false);setMidiSetup(false);setMusicHistory(false);setPianoLibrary(false);setGuitarLibrary(false);});
  }
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[]);
 const restoreRoute=useCallback(async()=>{
  const route=routeOf();restoring.current=true;replaceRoute.current=true;setRouteReady(false);setError('');
  try{
   setGroupId(route.page==='group'?route.id:null);setPublicId(route.page==='public'?route.id:null);
   if(route.adjust&&account){const target=await loadLesson(route.adjust);setAdjustFor({lesson_id:target.lesson_id,title:target.title,subject:library.find(item=>item.lesson_id===target.lesson_id)?.subject});}else setAdjustFor(null);
   if(route.page==='music-review'){if(!account){pending('auth-return',location.search);setPage('account');return;}if(!route.id)throw new Error('This review link is incomplete.');setReviewId(route.id);setLesson(null);setMusic(null);setPage('music-review');return;}
   if(['preview','compete','practice','review','check','move','share','group','public'].includes(route.page)&&!route.id)throw new Error('This link is incomplete. Choose a move from your library.');
   if(['preview','compete','practice','review','check','move','share'].includes(route.page)&&route.id){
    if(route.source==='public'){setMusic(null);setLesson(await loadPublicMove(route.id));setLessonOwned(false);}
    else if(route.source==='demo'){setMusic(null);const value=await loadDemo();setLesson(value);setLessonOwned(false);}
    else if(account){
     const document=await loadLessonDocument(route.id);
     if(document.kind==='music'){
      if(!['preview','practice','compete'].includes(route.page))throw new Error('This music lesson opens in preview on this version. Refresh to update.');
      setMusic(document.value);setLesson(null);setLessonOwned(false);
     }else if(document.kind==='body'){
      setMusic(null);setLesson(document.value);setLessonOwned(library.some(item=>item.lesson_id===route.id));
     }else throw new Error('Open this lesson from your library.');
    }
    else{pending('auth-return',location.search);setPage('account');return;}
   }
   if(['group','studio','receiver','admin'].includes(route.page)&&!account){pending('auth-return',location.search);setPage('account');return;}
   setPage(route.page);
  }catch(e){setLesson(null);setMusic(null);setError((e as Error).message);setPage('moves');}
  finally{restoring.current=false;setRouteReady(true);}
 },[account,library]);
 useEffect(()=>{if(!loading&&!routeReady&&!restoring.current&&!initialLink&&!incoming&&!groupInvite)void restoreRoute();else if(!loading&&(initialLink||incoming||groupInvite))setRouteReady(true);},[loading,routeReady,restoreRoute,initialLink,incoming,groupInvite]);
 useEffect(()=>{
  if(!routeReady||restoring.current)return;
  const q=new URLSearchParams();if(page!=='moves')q.set('page',page);
  if(page==='group'&&groupId)q.set('id',groupId);
  if(page==='public'&&publicId)q.set('id',publicId);
  if(page==='music-review'&&reviewId)q.set('id',reviewId);
  if(['preview','compete','practice','review','check','move','share'].includes(page)&&(lesson||music)){const active=lesson??music!;q.set('id',active.lesson_id);if(lesson){if(lesson.animation.key.startsWith('public/'))q.set('source','public');else if(!lesson.animation.key.startsWith('lessons/'))q.set('source','demo');}}
  if(page==='create'&&adjustFor)q.set('adjust',adjustFor.lesson_id);
  const url='/'+(q.size?'?'+q.toString():'');
  if(url!==location.pathname+location.search){if(replaceRoute.current)history.replaceState(null,'',url);else history.pushState(null,'',url);}
  replaceRoute.current=false;
 },[page,lesson,music,publicId,groupId,adjustFor,routeReady,reviewId]);
 useEffect(()=>{const back=()=>{if(dirty&&!window.confirm('Leave without saving your changes or take?')){history.go(1);return;}setDirty(false);void restoreRoute();};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[dirty,restoreRoute]);
 useEffect(()=>{if(initialLink)pending('auth-action',initialLink);if(incoming)pending('move-invite',incoming);if(groupInvite)pending('group-invite',groupInvite);if(initialLink||incoming||groupInvite)history.replaceState(null,'',location.pathname+location.search);void refresh();},[refresh,initialLink]);
 useEffect(()=>{const receive=()=>{const sharedLink=incomingShare();const authenticationLink=linkAction();const invite=groupInviteOf();if(!sharedLink&&!authenticationLink&&!invite)return;history.replaceState(null,'',location.pathname+location.search);if(dirty&&!window.confirm('Leave without saving your changes or take?'))return;setDirty(false);setError('');setNotice('');if(invite){pending('group-invite',invite);setGroupInvite(invite);setPage('groupjoin');}else if(sharedLink){pending('move-invite',sharedLink);setIncoming(sharedLink);setPage('join');}else{pending('auth-action',authenticationLink);setInitialLink(authenticationLink);setPage('account');}};window.addEventListener('hashchange',receive);return()=>window.removeEventListener('hashchange',receive);},[dirty]);
 // Verification may open in another tab. Transfer the short-lived return intent only over
 // the same-origin channel; invitation secrets never enter ordinary URLs or persistent storage.
 useEffect(()=>{
  if(typeof BroadcastChannel==='undefined')return;
  const channel=new BroadcastChannel('form-auth-return');
  channel.onmessage=event=>{
   if(event.data?.type==='request'&&!initialLink){const destination=pending<string>('auth-return');if(destination)channel.postMessage({type:'context',destination,incoming:pending('move-invite'),group:pending('group-invite')});}
   if(event.data?.type==='context'&&initialLink){const value=event.data;if(typeof value.destination==='string'&&value.destination.startsWith('?'))pending('auth-return',value.destination);if(typeof value.group==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value.group)){pending('group-invite',value.group);setGroupInvite(value.group);}if(value.incoming&&(value.incoming.invite||value.incoming.key)){pending('move-invite',value.incoming);setIncoming(value.incoming);}}
  };
  if(initialLink)channel.postMessage({type:'request'});
  return()=>channel.close();
 },[initialLink]);
 const feedScroll=useRef(0);
 useEffect(()=>{if(page==='moves'){const frame=requestAnimationFrame(()=>window.scrollTo({top:feedScroll.current}));return()=>cancelAnimationFrame(frame);}},[page]);
 const navigate=(next:Page)=>{if(next==='account'&&page!=='account')pending('auth-return',location.search);if(dirty&&!window.confirm('Leave without saving your changes or take?'))return;if(page==='moves')feedScroll.current=window.scrollY;setDrawerOpen(false);setDirty(false);setNotice('');setError('');setPage(next);if(!['preview','practice','compete'].includes(next))setMusic(null);window.scrollTo({top:0});};
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===401){pending('auth-return',location.search);setAccount(null);setLibrary([]);setShared([]);setStates([]);setLesson(null);setMusic(null);setPage('account');}}finally{setBusy(false);}};
 const stateOf=(value:{lesson_id:string})=>states.find(item=>item.lesson_id===value.lesson_id);
 const open=(value:{lesson_id:string},mode:'auto'|'practice'|'check'|'edit'='auto',owned=true)=>void run(async()=>{
  const workflow=stateOf(value);
  if(owned&&workflow?.experience_family==='music'&&(mode==='check'||!workflow.latest_revision_id)){setReviewId(value.lesson_id);setLesson(null);setMusic(null);navigate('music-review');return;}
  const document=demo?.lesson_id===value.lesson_id?{kind:'body' as const,value:demo}:await loadLessonDocument(value.lesson_id);
  if(document.kind==='music'){setMusic(document.value);setLesson(null);setLessonOwned(owned);navigate('preview');return;}
  if(document.kind!=='body')throw new Error('This lesson is not available on this version.');
  const current=document.value;
  setMusic(null);setLesson(current);setLessonOwned(owned);
  if(!owned||mode==='practice'){navigate('preview');return;}
  if(mode==='edit'){navigate('review');return;}
  if(mode==='check'||needsCheck(current,stateOf(current))){navigate('check');return;}
  navigate('move');
 });
 const importDemo=()=>void run(async()=>{if(!account){navigate('account');return;}const value=await copyDemo();setLibrary(previous=>[summarizeBody(value),...previous]);setLesson(value);setLessonOwned(true);setStates(previous=>[...previous,{lesson_id:value.lesson_id,latest_revision_id:value.revision_id,accepted_revision_id:null,accepted_at:null,published_revision_id:null,distribution:'private',audiences:{direct:0,groups:0,public:false},public_listing:null}]);navigate('check');setNotice('Private copy added to your moves.');});
 const [sessionSection,setSessionSection]=useState<number|null>(null);
 const practicePreferences=useRef<Record<string,PracticePreferences>>({});
 const previewPositions=useRef<Record<string,number>>({});
 const chooseMode=(mode:'practice'|'compete')=>{setSessionSection(null);navigate(mode);};
 const saved=!!lesson?.animation.key.startsWith('lessons/');
 const save=async(sections:Section[],title:string)=>{
  if(!lesson)return;
  if(!lessonOwned)throw new Error('Only the move creator can edit these sections.');
  if(saved){const value=await saveSections(lesson,sections,title);setLesson(value);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));void refresh();setNotice('Saved to your private moves.');}
  else{const value={...lesson,section_set:{...lesson.section_set,sections}};setLesson(value);setDemo(value);setNotice('Draft kept in this session. Add a private copy to save permanently.');}
 };
 const logout=()=>{if(dirty&&!window.confirm('Leave without saving your changes or take?'))return;setDirty(false);setDrawerOpen(false);void run(async()=>{await signOut();sessionStorage.removeItem('group-invite');sessionStorage.removeItem('move-invite');sessionStorage.removeItem('auth-return');sessionStorage.removeItem('auth-action');setGroupInvite(null);setAccount(null);setLibrary([]);setShared([]);setStates([]);setIncoming(null);setLesson(null);setMusic(null);setDemo(null);setNotice('');await refresh();setPage('moves');});};
 const beginAdjust=(value:LessonManifest)=>{setLesson(value);navigate('check');};
 const destinations=(account?[{id:'moves' as const,label:'Home',Icon:Home},{id:'explore' as const,label:'Explore',Icon:Globe},{id:'groups' as const,label:'Groups',Icon:Users},{id:'create' as const,label:'Create',Icon:Plus},...(studioEnabled?[{id:'studio' as const,label:'Studio',Icon:SlidersHorizontal}]:[]),{id:'account' as const,label:'You',Icon:User}]:[{id:'moves' as const,label:'Home',Icon:Home},{id:'explore' as const,label:'Explore',Icon:Globe},{id:'create' as const,label:'Create',Icon:Plus},{id:'account' as const,label:'You',Icon:User}]);
 return <div className={`app feed-app ${sidebarExpanded?'sidebar-expanded':'sidebar-compact'} ${['practice','compete'].includes(page)?'practising':''} ${page==='preview'?'watching-lesson':''} ${drawerNavigation?'navigation-overlay':''} ${drawerOpen?'navigation-open':''} ${page==='check'?'checking-move':''} ${page==='review'&&lessonOwned?'editing-sections':''}`}>
  <header className="header">
   <div className="feed-header-brand"><button className="feed-sidebar-toggle" aria-label={drawerNavigation?(drawerOpen?'Close navigation':'Open navigation'):(sidebarExpanded?'Collapse sidebar':'Expand sidebar')} aria-expanded={drawerNavigation?drawerOpen:sidebarExpanded} aria-controls="primary-navigation" onClick={()=>drawerNavigation?setDrawerOpen(value=>!value):setSidebarExpanded(value=>!value)}><Menu size={22}/></button><a className="brand" href="/" onClick={event=>{event.preventDefault();navigate('moves');}} aria-label="Form home"><span className="brand-symbol">f<MoveUpRight size={14}/></span>form<span className="brand-dot">.</span></a></div>
   <nav id="primary-navigation" aria-label="Main navigation" hidden={drawerNavigation&&!drawerOpen}>{destinations.filter(item=>item.id!=='account').map(({id,label,Icon})=><button key={id} aria-label={label} title={label} className={`nav-item ${id==='create'?'mobile-create-nav':''} ${id==='studio'?'studio-nav':''} ${page===id?'active':''}`} aria-current={page===id?'page':undefined} onClick={()=>{if(id==='create')setAdjustFor(null);navigate(id);}}><Icon size={18}/><span>{label}</span></button>)}</nav>
   <FeedSearch query={feedQuery} onQuery={setFeedQuery} label="Search practices" placeholder="Search lessons or creators" onSubmit={()=>{setFeedFilter('all');navigate('moves');}}/>
   <div className="feed-header-actions"><button className="feed-create" aria-label="Create a practice" onClick={()=>{setAdjustFor(null);navigate('create');}}><Plus size={19}/><span>Create</span></button><AccountMenu key={page} account={account} active={page==='account'} busy={busy} onAccount={()=>navigate('account')} onPractices={()=>{setFeedQuery('');setFeedFilter('own');navigate('moves');}} onPreferences={()=>{navigate('account');setAccountPreferences(true);}} onSignOut={logout}/></div>
  </header>
  {drawerOpen&&<button className="navigation-scrim" aria-label="Close navigation" onClick={()=>{setDrawerOpen(false);document.querySelector<HTMLElement>('.feed-sidebar-toggle')?.focus();}}/>}
  <main aria-busy={busy||loading} inert={drawerOpen||undefined}><Suspense fallback={<p role="status">Opening your move…</p>}>
   {error&&<div className="inline-notice error-notice" role="alert">{error}{page==='moves'&&<button className="back-link" onClick={()=>void refresh()}>Try again</button>}</div>}
   {busy&&<p className="operation-status" role="status">One moment…</p>}
   {page==='receiver'&&<Suspense fallback={<p>Opening display…</p>}><MimicReceiver onBack={()=>navigate('moves')}/></Suspense>}
   <div className="feed-page" hidden={page!=='moves'}><PracticeFeed filter={feedFilter} setFilter={setFeedFilter} active={page==='moves'} query={feedQuery} onQuery={setFeedQuery} account={account} library={library} shared={shared} subjectFilterEnabled={subjectFilter} states={states} demo={demo} loading={loading}
    onCreate={()=>{setAdjustFor(null);navigate('create');}} onSignIn={()=>navigate('account')}
    onOpen={(item,owned,check)=>open(item,check?'check':'practice',owned)}
    onPublic={id=>void run(async()=>{const value=await loadPublicMove(id);setMusic(null);setLesson(value);setLessonOwned(false);navigate('preview');})}
    onManage={(item,action)=>{
     if(action==='check'||action==='edit'){open(item,action);return;}
     if(action==='copy'){importDemo();return;}
     if(action==='share'){if(item.experience_family==='music'){setShareMusic(item);setLesson(null);navigate('share');return;}void run(async()=>{setLesson(await loadLesson(item.lesson_id));setLessonOwned(true);navigate('share');});}
     if(action==='remove'&&window.confirm(`Remove “${item.title}” from your practices?`))void run(async()=>{await request(`/lessons/${item.lesson_id}`,'DELETE');setLibrary(previous=>previous.filter(value=>value.lesson_id!==item.lesson_id));});
     if(action==='report'){const reason=window.prompt('What would you like to report?');if(reason&&reason.trim().length>=3)void run(async()=>{await request(`/lessons/${item.lesson_id}/report`,'POST',{reason});setNotice('Report received. Thank you.');});}
    }}>
    {account&&page==='moves'&&<div className="feed-uploads"><ConversionList readyIds={states.filter(state=>!state.latest_revision_id||state.accepted_revision_id!==state.latest_revision_id).map(state=>state.lesson_id)} onReady={()=>void refresh()} onOpen={id=>open({lesson_id:id},'check')}/></div>}
   </PracticeFeed>{notice&&<p className="inline-notice" role="status">{notice}</p>}</div>
   {page==='music-review'&&account&&reviewId&&<MusicDraftReview lessonId={reviewId} onDirty={setDirty} onBack={()=>navigate('moves')} onReviewed={value=>{setDirty(false);setMusic(value);setLesson(null);setLessonOwned(true);setPage('preview');void refresh();window.scrollTo({top:0});}}/>}
   {page==='preview'&&music&&!lesson&&<MusicLessonScreen pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary} midiSetupEnabled={midiSetup} musicHistoryEnabled={musicHistory} lesson={music} onBack={()=>navigate('moves')}/>}
   {page==='preview'&&lesson&&<PracticePreview key={lesson.revision_id} lesson={lesson} owned={lessonOwned} resumeAt={previewPositions.current[lesson.lesson_id+':'+lesson.revision_id]??lesson.source_start} onPosition={time=>{previewPositions.current[lesson.lesson_id+':'+lesson.revision_id]=time;}} onChoose={chooseMode} onBack={()=>navigate('moves')}
    lessons={[...library.map(value=>({lesson:value,owned:true})),...shared.map(value=>({lesson:value,owned:false})),...(demo?[{lesson:summarizeBody(demo),owned:false}]:[])]}
    onOpen={item=>{setSessionSection(null);open(item.lesson,'practice',item.owned);}}
    onPublic={id=>void run(async()=>{const value=await loadPublicMove(id);setMusic(null);setLesson(value);setLessonOwned(false);setSessionSection(null);navigate('preview');})}/>}
   {(page==='practice'||page==='compete'||(page==='review'&&!lessonOwned))&&(lesson||music)&&<LessonExperienceHost key={`${(lesson??music)!.revision_id}-${page}-${sessionSection}`} document={lesson?{kind:'body',value:lesson}:{kind:'music',value:music!}} initialMode={page==='compete'?'compete':'practice'} onModeChange={mode=>{setSessionSection(null);navigate(mode==='watch'?'preview':mode);}} initialSettings={lesson?practicePreferences.current[lesson.lesson_id+':'+lesson.revision_id]:undefined} onSettings={value=>{if(lesson){practicePreferences.current[lesson.lesson_id+':'+lesson.revision_id]=value;}}} initialSection={sessionSection} onPracticeSection={index=>{setSessionSection(index<0?null:index);navigate('practice');}} sections={lesson?lesson.section_set.sections:[]} review={page==='review'&&lessonOwned} editable={lessonOwned} persistent={saved} legacyCompatible={lessonOwned&&saved&&!!lesson&&demo?.animation.sha256===lesson.animation.sha256} onBack={()=>navigate(page==='review'?'moves':'preview')} onEdit={()=>navigate(page==='review'?'preview':'review')} onSave={save} onDirty={setDirty} notice={notice}/>}
   {page==='review'&&lesson&&lessonOwned&&<SectionEditor key={lesson.lesson_id} lesson={lesson} onBack={()=>navigate('moves')} onPractice={()=>navigate('preview')} onSave={save} onDirty={setDirty} persistent={saved}/>}
   {page==='check'&&lesson&&lessonOwned&&<MoveCheck key={lesson.revision_id} lesson={lesson} onDirty={setDirty} onBack={()=>navigate('moves')} onAccepted={value=>{setLesson(value);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));setDirty(false);void refresh();setPage('move');window.scrollTo({top:0});}} onChooseAnother={()=>{setAdjustFor(null);navigate('create');}}/>}
   {page==='move'&&lesson&&lessonOwned&&<MoveDetail lesson={lesson} state={stateOf(lesson)} onBack={()=>navigate('moves')} onPractice={()=>navigate('preview')} onShare={()=>navigate('share')} onMore={()=>navigate('review')} onAdjust={()=>beginAdjust(lesson)} onRenamed={value=>{setLesson(value);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));}}/>}
   {page==='share'&&lesson&&lessonOwned&&<ShareLesson lesson={lesson} onBack={()=>navigate('move')} onChange={refresh}/>}
   {page==='share'&&!lesson&&shareMusic&&<MusicShareLesson key={shareMusic.lesson_id} lessonId={shareMusic.lesson_id} title={shareMusic.title} onBack={()=>{setShareMusic(null);navigate('moves');}} onChange={refresh}/>}
   {page==='join'&&incoming&&<JoinLesson incoming={incoming} account={account} onSignIn={()=>navigate('account')} onBack={()=>navigate('moves')} onJoined={value=>{if((value as MusicLessonManifest).schema_version===2){setMusic(value as MusicLessonManifest);setLesson(null);}else{setMusic(null);setLesson(value as LessonManifest);}setLessonOwned(false);setIncoming(null);sessionStorage.removeItem('move-invite');void loadSharedSummaries().then(setShared).catch(e=>setError(e.message));navigate('preview');}}/>}
   {page==='create'&&(account?<CreateLesson adjust={adjustFor??undefined} onBack={()=>{setAdjustFor(null);navigate('moves');}} onDone={()=>{setAdjustFor(null);navigate('moves');void refresh();}}/>:<section className="coming-screen"><div className="empty-state"><span className="note-art"><Video size={36}/></span><h1>Your next move.</h1><p className="subtle">Sign in to add a video and keep your moves.</p><button className="primary" onClick={()=>navigate('account')}>Sign in<ArrowRight size={18}/></button></div></section>)}
   {page==='explore'&&<ExplorePage query={feedQuery} onQuery={setFeedQuery} onOpen={id=>void run(async()=>{const value=await loadPublicMove(id);setMusic(null);setLesson(value);setLessonOwned(false);setSessionSection(null);navigate('preview');})}/>}
   {page==='public'&&publicId&&<PublicDetailPage id={publicId} account={account} onBack={()=>navigate('explore')} onSignIn={()=>navigate('account')} onTry={value=>{setMusic(null);setLesson(value as LessonManifest);setLessonOwned(false);navigate('preview');}}/>}
   {page==='groups'&&(account?<GroupsPage onOpen={id=>{setGroupId(id);navigate('group');}}/>:<section className="coming-screen"><div className="empty-state"><span className="note-art"><Users size={36}/></span><h1>Practise together.</h1><p className="subtle">Sign in to create or join a group.</p><button className="primary" onClick={()=>navigate('account')}>Sign in<ArrowRight size={18}/></button></div></section>)}
   {page==='group'&&groupId&&account&&<GroupDetailPage id={groupId} account={account} onBack={()=>navigate('groups')} onTry={move=>{if(move.access_kind!=='collection'){open(move,'practice',false);return;}void run(async()=>{const value=await loadPublicMove(move.lesson_id);setMusic(null);setLesson(value);setLessonOwned(false);setSessionSection(null);navigate('preview');});}}/>}
   {page==='groupjoin'&&groupInvite&&<GroupJoinPage invite={groupInvite} account={account} onSignIn={()=>navigate('account')} onBack={()=>navigate('moves')} onJoined={id=>{setGroupId(id);setGroupInvite(null);sessionStorage.removeItem('group-invite');navigate('group');}}/>}
   {page==='studio'&&account&&<StudioPage lessons={library} states={states} onBack={()=>navigate('moves')} onOpen={item=>open(item,'practice')} onCheck={item=>open(item,'check')} onAdjust={item=>open(item,'edit')} onShare={item=>void run(async()=>{setLesson(await loadLesson(item.lesson_id));setLessonOwned(true);navigate('share');})} onCreate={()=>{setAdjustFor(null);navigate('create');}}/>}
   {page==='admin'&&(account&&['admin','super_admin'].includes(account.platform_role)?<AdminPage account={account} onBack={()=>navigate('moves')} onSessionLost={()=>{void refresh();navigate('account');}}/>:<section className="account-card"><h1>Administration</h1><p>Administrative access is required.</p><button className="primary" onClick={()=>navigate('account')}>Account</button></section>)}
   {page==='account'&&(account&&!initialLink?<section className="account-card"><span className="note-art"><Check size={32}/></span><p className="eyebrow">YOUR SPACE</p><h1>Ready to move.</h1><p className="account-email">{account.email}</p><p className="subtle">Your moves are saved privately. Sharing is always your choice.</p><button className="secondary" onClick={()=>navigate('receiver')}>Use as practice display</button>{['admin','super_admin'].includes(account.platform_role)&&<button className="secondary" onClick={()=>navigate('admin')}>Administration</button>}{musicHistory&&<Suspense fallback={<p>Opening music history…</p>}><MusicHistoryPanel key={account.id}/></Suspense>}<section id="account-preferences" className="account-preferences" tabIndex={-1}><h2>Preferences</h2><label className="check-line studio-toggle"><input type="checkbox" checked={studioEnabled} onChange={e=>setStudio(e.target.checked)}/><span>Show teaching tools (Studio)</span></label></section><button className="primary" onClick={()=>navigate('moves')}>My moves<ArrowRight size={18}/></button><button className="back-link" disabled={busy} onClick={logout}><LogOut size={16}/>Sign out</button></section>:<AuthPanel key={initialLink?.token??'sign-in'} initialLink={initialLink} onLinkHandled={()=>sessionStorage.removeItem('auth-action')} onSignedIn={async value=>{const savedLibrary=await loadLessonSummaries();const workflow=await loadMoveStates();setShared(await loadSharedSummaries());setAccount(value);setLesson(null);setMusic(null);setLibrary(savedLibrary);setStates(workflow.lessons);setInitialLink(null);sessionStorage.removeItem('auth-action');const destination=pending<string>('auth-return');sessionStorage.removeItem('auth-return');if(groupInvite)setPage('groupjoin');else if(incoming)setPage('join');else if(destination){history.replaceState(null,'','/'+destination);setRouteReady(false);}else setPage('moves');}}/>)}
  </Suspense></main>
 </div>;
}

function AuthPanel({initialLink,onSignedIn,onLinkHandled}:{initialLink:{view:AuthView;token:string}|null;onSignedIn:(account:Account)=>Promise<void>;onLinkHandled:()=>void}){
 const [view,setView]=useState<AuthView>(initialLink?.view??'login'),[token,setToken]=useState(initialLink?.token??''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const change=(next:AuthView)=>{setView(next);setPassword('');setMessage('');setError('');};
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{
  if(view==='login'){await onSignedIn(await signIn(email,password));setPassword('');}
  else {const endpoint={register:'register',forgot:'forgot',verify:'verify',reset:'reset'}[view];const value=await request<{message:string}>(`/auth/${endpoint}`,'POST',view==='verify'?{token}:view==='reset'?{token,password}:view==='forgot'?{email}:{email,password});setMessage(value.message);setPassword('');if(view==='reset'||view==='verify'){onLinkHandled();setToken('');setView('login');}}
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const title={login:'Welcome back.',register:'Your own space.',forgot:'Find your way back.',reset:'A fresh start.',verify:'One last step.'}[view];
 return <section className="auth-panel"><p className="eyebrow">SPACE TO MOVE</p><h1>{title}</h1><p className="subtle">{view==='login'?'Sign in to your moves.':view==='register'?'Keep your moves. Practise at your pace.':view==='verify'?'Confirm your email to start practising.':view==='forgot'?'We’ll email you a reset link.':'Choose a new password.'}</p><form onSubmit={e=>void submit(e)}>
  {!['verify','reset'].includes(view)&&<label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>}
  {['login','register','reset'].includes(view)&&<label>Password<input type="password" autoComplete={view==='login'?'current-password':'new-password'} required minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/>{view!=='login'&&<span className="small muted">At least 12 characters.</span>}</label>}
  {error&&<p className="inline-notice error-notice" role="alert">{error}</p>}{message&&<p className="inline-notice" role="status">{message}</p>}
  <button className="primary" disabled={busy}>{busy?'One moment…':{login:'Sign in',register:'Create account',forgot:'Send reset link',reset:'Save password',verify:'Verify email'}[view]}<ArrowRight size={18}/></button>
 </form><div className="auth-links">{view==='login'?<><button className="back-link" disabled={busy} onClick={()=>change('register')}>Create account</button><button className="back-link" disabled={busy} onClick={()=>change('forgot')}>Forgot password?</button><button className="back-link" disabled={busy||!email} onClick={()=>{setBusy(true);setError('');request<{message:string}>('/auth/resend','POST',{email}).then(value=>setMessage(value.message)).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Resend verification email</button></>:<button className="back-link" disabled={busy} onClick={()=>change('login')}>Back to sign in</button>}</div></section>;
}
