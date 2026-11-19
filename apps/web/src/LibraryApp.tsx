import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,Home,Check,Globe,LogOut,MoveUpRight,Menu,Plus,SlidersHorizontal,User,Users,Video} from 'lucide-react';
import type {DrawingLessonManifest,LessonDocument,LessonManifest,LessonSummary,MusicLessonManifest,Section} from '../../../packages/lesson-schema/index';
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
const MusicReviewRoute=lazy(()=>import('./music/MusicReviewRoute').then(module=>({default:module.MusicReviewRoute})));
const PianoModelComparison=lazy(()=>import('./music/PianoModelComparison').then(module=>({default:module.PianoModelComparison})));
const StudioPage=lazy(()=>import('./Studio').then(module=>({default:module.StudioPage})));
const MusicLessonEditor=lazy(()=>import('./music/MusicLessonEditor').then(module=>({default:module.MusicLessonEditor})));
const DrawingEditorRoute=lazy(()=>import('./acts/drawing/DrawingEditorRoute').then(module=>({default:module.DrawingEditorRoute})));
const DrawingShareLesson=lazy(()=>import('./acts/drawing/DrawingShareLesson').then(module=>({default:module.DrawingShareLesson})));
import {ShareLesson,JoinLesson,incomingShare} from './ShareLesson';
import {MusicShareLesson} from './music/MusicShareLesson';
import type {PracticePreferences} from './practice-types';
import {PracticePreview} from './PracticePreview';
import {LessonExperienceHost} from './LessonExperienceHost';
import {buildLessonContext,buildPublicLessonContext,clearLessonContextCache,invalidateLessonContext,loadLessonContext,type LessonContext} from './app/lesson-context';
import {applyReleaseChange,applySavedRevision} from './editor/revision-handoff';
import {groupInviteOf,lessonPageUrl,linkAction,pending,routeOf,type AuthView,type Page} from './app/routes';
import {createLibraryPager} from './app/library-pager';
import {bodyOpenTarget,musicManageTarget} from './app/open-target';
import {summarizeBody} from './lesson-summary';
import {PracticeFeed,type FeedFilter} from './PracticeFeed';
import {AccountMenu} from './AccountMenu';
import {FeedSearch} from './FeedSearch';
import {Button, IconButton} from './ui/controls';
import './feed.css';
import {ApiError,assetUrl,createDrawingLesson,loadCapabilities,loadPublicMove,copyDemo,getSession,loadDemo,loadLesson,loadLessonSummaries,loadLessonSummariesPage,loadMoveStates,loadSharedSummaries,needsCheck,request,saveSections,signIn,signOut,type Account,type MoveState} from './api';

export function App(){
 const [feedQuery,setFeedQuery]=useState(''),[feedFilter,setFeedFilter]=useState<FeedFilter>('all'),[drawerOpen,setDrawerOpen]=useState(false),[smallScreen,setSmallScreen]=useState(()=>matchMedia('(max-width:760px)').matches),[accountPreferences,setAccountPreferences]=useState(false),[sidebarExpanded,setSidebarExpanded]=useState(()=>window.matchMedia('(min-width:1101px)').matches);
 useEffect(()=>{const media=window.matchMedia('(min-width:1101px)');const change=()=>setSidebarExpanded(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 const [initialLink,setInitialLink]=useState(()=>linkAction()??pending<ReturnType<typeof linkAction>>('auth-action'));
 const [groupInvite,setGroupInvite]=useState(()=>groupInviteOf()??(['groupjoin','account'].includes(routeOf().page)?pending<string>('group-invite'):null)),[groupId,setGroupId]=useState<string|null>(routeOf().page==='group'?routeOf().id:null),[publicId,setPublicId]=useState<string|null>(routeOf().page==='public'?routeOf().id:null);
 const [studioEnabled,setStudioEnabled]=useState(()=>localStorage.getItem('form-studio')==='1');
 const setStudio=(value:boolean)=>{setStudioEnabled(value);localStorage.setItem('form-studio',value?'1':'0');};
 const [incoming,setIncoming]=useState(()=>incomingShare()??(['join','account'].includes(routeOf().page)?pending<ReturnType<typeof incomingShare>>('move-invite'):null)),[shared,setShared]=useState<LessonSummary[]>([]),[lessonOwned,setLessonOwned]=useState(true);
 const [page,setPage]=useState<Page>(initialLink?'account':groupInvite?'groupjoin':incoming?'join':routeOf().page),[account,setAccount]=useState<Account|null>(null),[library,setLibrary]=useState<LessonSummary[]>([]),[demo,setDemo]=useState<LessonManifest|null>(null),[lesson,setLesson]=useState<LessonManifest|null>(null),[music,setMusic]=useState<MusicLessonManifest|null>(null),[midiSetup,setMidiSetup]=useState(false),[musicHistory,setMusicHistory]=useState(false),[musicChallenge,setMusicChallenge]=useState(false),[musicInference,setMusicInference]=useState(false),[pianoLibrary,setPianoLibrary]=useState(false),[guitarLibrary,setGuitarLibrary]=useState(false),[shareMusic,setShareMusic]=useState<LessonSummary|null>(null),[editMusic,setEditMusic]=useState<LessonSummary|null>(null),[subjectFilter,setSubjectFilter]=useState(false);
 useEffect(()=>{setFeedQuery('');setFeedFilter('all');},[account?.id]);
 // Loaded lesson context (identity, audience, capabilities, specialized document).
 const [context,setContext]=useState<LessonContext|null>(null);
 const [drawing,setDrawing]=useState<DrawingLessonManifest|null>(null);
 const [drawingEditId,setDrawingEditId]=useState<string|null>(null);
 const [drawingShareId,setDrawingShareId]=useState<string|null>(null);
 // Any account change/sign-out invalidates owner-scoped contexts and references.
 useEffect(()=>{clearLessonContextCache();setContext(null);},[account?.id]);
 // History restoration and authentication can change the page without navigate().
 useEffect(()=>{if(!['preview','practice','compete'].includes(page)){setMusic(null);setContext(null);setDrawing(null);}},[page]);
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
 const [reviewId,setReviewId]=useState<string|null>(routeOf().page==='music-review'?routeOf().id:routeOf().page==='music-comparison'?routeOf().linkedLesson:null);
 const [reviewFocused,setReviewFocused]=useState(false);
const [editId,setEditId]=useState<string|null>(routeOf().page==='music-edit'?routeOf().id:null);
 const [comparisonId,setComparisonId]=useState<string|null>(routeOf().page==='music-comparison'?routeOf().id:null);
 const [states,setStates]=useState<MoveState[]>([]),[adjustFor,setAdjustFor]=useState<{lesson_id:string;title:string;subject?:string;feedback_enabled?:boolean}|null>(null);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false);
 const [routeReady,setRouteReady]=useState(false),replaceRoute=useRef(true),restoring=useRef(false);
 const [libraryTotal,setLibraryTotal]=useState(0);
 const [libraryHasMore,setLibraryHasMore]=useState(false);
 const [libraryLoadingMore,setLibraryLoadingMore]=useState(false);
 const [ownedSubject,setOwnedSubject]=useState('all');
 const [ownedAvailableSubjects,setOwnedAvailableSubjects]=useState<string[]>([]);
 const pager=useRef(createLibraryPager<LessonSummary>()).current;
 const refresh=useCallback(async()=>{
  const generation=pager.beginReload();
  setLoading(true);setError('');
  try{const session=await getSession();setAccount(session?.account??null);const [preview,received,workflow]=await Promise.all([loadDemo(),session?loadSharedSummaries():Promise.resolve([]),session?loadMoveStates():Promise.resolve({lessons:[]})]);
   const ownedPage=session?await loadLessonSummariesPage({limit:100,offset:0}):null;
   const next=pager.reload(generation,ownedPage??{lessons:[],total:0,has_more:false,available_subjects:[]});
   setDemo(preview);if(next){setLibrary(next.lessons);setLibraryTotal(next.total);setLibraryHasMore(next.hasMore);setOwnedAvailableSubjects(next.availableSubjects);}setShared(received);setStates(workflow.lessons);
   // The subject filter is a server-controlled rollout: absent or failing means off.
   void loadCapabilities().then(value=>{setSubjectFilter(Boolean(value.subject_filter));setMidiSetup(value.music_midi_setup===true);setMusicHistory(value.music_history===true);setMusicChallenge(value.music_challenge===true);setMusicInference(value.music_inference===true);setPianoLibrary(value.music_piano_library_ui===true);setGuitarLibrary(value.music_guitar_library_ui===true);}).catch(()=>{setSubjectFilter(false);setMidiSetup(false);setMusicHistory(false);setMusicChallenge(false);setMusicInference(false);setPianoLibrary(false);setGuitarLibrary(false);});
  }
  catch(e){setError((e as Error).message);}finally{setLoading(false);}
 },[]);
 const loadMoreLibrary=useCallback(async()=>{
  if(libraryLoadingMore||!libraryHasMore)return;
  const generation=pager.beginLoadMore();
  const current={lessons:library,total:libraryTotal,hasMore:libraryHasMore,
    availableSubjects:ownedAvailableSubjects,loadingMore:true};
  setLibraryLoadingMore(true);
  try{const page=await loadLessonSummariesPage({limit:100,offset:library.length,
    q:feedQuery,subject:ownedSubject==='all'?undefined:ownedSubject});
   const next=pager.append(generation,current,page);
   if(!next)return;
   setLibrary(next.lessons);setLibraryTotal(next.total);setLibraryHasMore(next.hasMore);
   setOwnedAvailableSubjects(next.availableSubjects);
  }catch(e){if(pager.isCurrent(generation))setError((e as Error).message);}
  finally{if(pager.isCurrent(generation))setLibraryLoadingMore(false);}
 },[library,libraryTotal,libraryHasMore,libraryLoadingMore,feedQuery,ownedSubject,
    ownedAvailableSubjects,pager]);
 useEffect(()=>{
  if(!account)return;
  const generation=pager.beginReload();
  const timer=window.setTimeout(()=>{
   loadLessonSummariesPage({limit:100,offset:0,q:feedQuery,
    subject:ownedSubject==='all'?undefined:ownedSubject}).then(page=>{
     const next=pager.reload(generation,page);
     if(!next)return;
     setLibrary(next.lessons);setLibraryTotal(next.total);setLibraryHasMore(next.hasMore);
     setOwnedAvailableSubjects(next.availableSubjects);setLibraryLoadingMore(false);
    }).catch(e=>{if(pager.isCurrent(generation))setError((e as Error).message);});
  },200);
  return()=>{window.clearTimeout(timer);};
 },[account?.id,feedQuery,ownedSubject,pager]);
 const restoreRoute=useCallback(async()=>{
  const route=routeOf();restoring.current=true;replaceRoute.current=true;setRouteReady(false);setError('');
  try{
   setGroupId(route.page==='group'?route.id:null);setPublicId(route.page==='public'?route.id:null);
   if(route.adjust&&account){const target=await loadLesson(route.adjust);setAdjustFor({lesson_id:target.lesson_id,title:target.title,subject:library.find(item=>item.lesson_id===target.lesson_id)?.subject,feedback_enabled:target.feedback_enabled ?? undefined});}else setAdjustFor(null);
   if(route.page==='drawing-share'){if(!account){pending('auth-return',location.search);setPage('account');return;}if(!route.id)throw new Error('This drawing link is incomplete.');setDrawingShareId(route.id);setPage('drawing-share');return;}
   if(route.page==='drawing-edit'){if(!account){pending('auth-return',location.search);setPage('account');return;}if(!route.id)throw new Error('This drawing link is incomplete.');setDrawingEditId(route.id);setPage('drawing-edit');return;}
    if(route.page==='music-review'){if(!account){pending('auth-return',location.search);setPage('account');return;}if(!route.id)throw new Error('This review link is incomplete.');setReviewId(route.id);setLesson(null);setMusic(null);setPage('music-review');return;}
   if(route.page==='music-comparison'){if(!account){pending('auth-return',location.search);setPage('account');return;}setComparisonId(route.id);setReviewId(route.linkedLesson);setLesson(null);setMusic(null);setPage('music-comparison');return;}
   if(['preview','compete','practice','review','check','move','share','group','public'].includes(route.page)&&!route.id)throw new Error('This link is incomplete. Choose a move from your library.');
   if(['preview','compete','practice','review','check','move','share'].includes(route.page)&&route.id){
    if(route.source==='public'){const loaded=buildPublicLessonContext(await loadPublicMove(route.id));setContext(loaded);setLessonOwned(false);const doc=loaded.document;setMusic(null);setDrawing(null);setLesson(null);if(doc.kind==='drawing'){if(route.page!=='practice')throw new Error('This drawing lesson opens in practice.');setDrawing(doc.value);}else if(doc.kind==='music'){if(!['preview','practice','compete'].includes(route.page))throw new Error('This music lesson opens in preview.');setMusic(doc.value);}else if(doc.kind==='body'){setLesson(doc.value);}else throw new Error('This lesson cannot be opened here.');}
    else if(route.source==='demo'){setMusic(null);setDrawing(null);const value=await loadDemo();setLesson(value);setLessonOwned(false);setContext(value?buildLessonContext({document:{kind:'body',value},audience:'demo',accountScope:'public'}):null);}
    else if(account){
     // The negotiated loader validates the specialized document and the Act.
     const loaded=await loadLessonContext(route.id,{audience:'owner',accountScope:account.id,challengeEnabled:musicChallenge});
     const document=loaded.document;
     if(document.kind==='music'){
      if(!['preview','practice','compete'].includes(route.page))throw new Error('This music lesson opens in preview on this version. Refresh to update.');
      setDrawing(null);setMusic(document.value);setLesson(null);setLessonOwned(false);setContext(loaded);
     }else if(document.kind==='drawing'){
if(route.page!=='practice')throw new Error('This drawing lesson opens in practice.');
setMusic(null);setDrawing(document.value);setLesson(null);setLessonOwned(false);setContext(loaded);
}else if(document.kind==='body'){
      setDrawing(null);setMusic(null);setLesson(document.value);setLessonOwned(library.some(item=>item.lesson_id===route.id));setContext(loaded);
     }else throw new Error('Open this lesson from your library.');
    }
    else{pending('auth-return',location.search);setPage('account');return;}
   }
   if(['group','studio','receiver','admin','drawing-edit'].includes(route.page)&&!account){pending('auth-return',location.search);setPage('account');return;}
   setPage(route.page);
  }catch(e){setLesson(null);setMusic(null);setDrawing(null);setContext(null);setError((e as Error).message);setPage('moves');}
  finally{restoring.current=false;setRouteReady(true);}
 },[account,library]);
 useEffect(()=>{if(!loading&&!routeReady&&!restoring.current&&!initialLink&&!incoming&&!groupInvite)void restoreRoute();else if(!loading&&(initialLink||incoming||groupInvite))setRouteReady(true);},[loading,routeReady,restoreRoute,initialLink,incoming,groupInvite]);
 useEffect(()=>{
  if(!routeReady||restoring.current)return;
  const q=new URLSearchParams();if(page!=='moves')q.set('page',page);
  if(page==='group'&&groupId)q.set('id',groupId);
  if(page==='public'&&publicId)q.set('id',publicId);
  if(page==='music-review'&&reviewId)q.set('id',reviewId);
  if(page==='music-comparison'&&comparisonId)q.set('id',comparisonId);
  if(page==='practice'&&drawing)q.set('id',drawing.lesson_id);
  if(page==='drawing-share'&&drawingShareId)q.set('id',drawingShareId);
  if(page==='drawing-edit'&&drawingEditId)q.set('id',drawingEditId);
  if(page==='music-comparison'&&reviewId)q.set('lesson',reviewId);
  if(page==='music-comparison'&&!comparisonId)q.delete('id');
  if(['preview','compete','practice','review','check','move','share'].includes(page)&&(lesson||music||drawing)){const active=lesson??music??drawing!;const built=new URL(lessonPageUrl({page,lessonId:active.lesson_id,audience:context?.audience}),location.origin);q.set('id',built.searchParams.get('id')!);const source=built.searchParams.get('source');if(source)q.set('source',source);else q.delete('source');}
  if(page==='create'&&adjustFor)q.set('adjust',adjustFor.lesson_id);
  const url='/'+(q.size?'?'+q.toString():'');
  if(url!==location.pathname+location.search){if(replaceRoute.current)history.replaceState(null,'',url);else history.pushState(null,'',url);}
  replaceRoute.current=false;
 },[page,lesson,music,publicId,groupId,adjustFor,routeReady,reviewId,comparisonId,drawingEditId,drawingShareId,drawing]);
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
 const navigate=(next:Page)=>{if(next==='account'&&page!=='account')pending('auth-return',location.search);if(dirty&&!window.confirm('Leave without saving your changes or take?'))return;if(page==='moves')feedScroll.current=window.scrollY;setDrawerOpen(false);setDirty(false);setNotice('');setError('');setPage(next);if(!['preview','practice','compete'].includes(next)){setMusic(null);setContext(null);setDrawing(null);}window.scrollTo({top:0});};
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===401){pending('auth-return',location.search);setAccount(null);setLibrary([]);setShared([]);setStates([]);setLesson(null);setMusic(null);setPage('account');}}finally{setBusy(false);}};
 const stateOf=(value:{lesson_id:string})=>states.find(item=>item.lesson_id===value.lesson_id);
 const open=(value:{lesson_id:string},mode:'auto'|'practice'|'check'|'edit'='auto',owned=true)=>void run(async()=>{
  const workflow=stateOf(value);
  const musicTarget=owned&&workflow?.experience_family==='music'
    ? musicManageTarget({owned,mode,latestRevisionId:workflow.latest_revision_id}) : null;
  if(musicTarget==='music-review'){setReviewId(value.lesson_id);setLesson(null);setMusic(null);setDrawing(null);setContext(null);navigate('music-review');return;}
  let document: LessonDocument;
  if(demo?.lesson_id===value.lesson_id){
   document={kind:'body' as const,value:demo};
   setContext(buildLessonContext({document,audience:'demo',accountScope:account?.id??'public'}));
  }else{
   const loaded=await loadLessonContext(value.lesson_id,{audience:owned?'owner':'invited',accountScope:account?.id??'guest',challengeEnabled:musicChallenge});
   document=loaded.document;setContext(loaded);
  }
  if(document.kind==='drawing'){setMusic(null);setDrawing(document.value);setLesson(null);setLessonOwned(owned);navigate('practice');return;}
  if(document.kind==='music'){setDrawing(null);setMusic(document.value);setLesson(null);setLessonOwned(owned);navigate('preview');return;}
  if(document.kind!=='body')throw new Error('This lesson is not available on this version.');
  const current=document.value;
  setDrawing(null);setMusic(null);setLesson(current);setLessonOwned(owned);
  navigate(bodyOpenTarget({owned,mode,needsCheck:needsCheck(current,stateOf(current))}));
 });
  const openPublicValue=async(id:string)=>{const loaded=buildPublicLessonContext(await loadPublicMove(id));setContext(loaded);const document=loaded.document;setLessonOwned(false);setSessionSection(null);setDrawing(null);setMusic(null);setLesson(null);if(document.kind==='drawing'){setDrawing(document.value);navigate('practice');return;}if(document.kind==='music'){setMusic(document.value);navigate('preview');return;}if(document.kind==='body'){setLesson(document.value);navigate('preview');return;}throw new Error('This lesson cannot be opened here.');};
 const importDemo=()=>void run(async()=>{if(!account){navigate('account');return;}const value=await copyDemo();setLibrary(previous=>[summarizeBody(value),...previous]);setLesson(value);setLessonOwned(true);setStates(previous=>[...previous,{lesson_id:value.lesson_id,latest_revision_id:value.revision_id,accepted_revision_id:null,accepted_at:null,published_revision_id:null,distribution:'private',audiences:{direct:0,groups:0,public:false},public_listing:null}]);navigate('check');setNotice('Private copy added to your moves.');});
 const [sessionSection,setSessionSection]=useState<number|null>(null);
 const practicePreferences=useRef<Record<string,PracticePreferences>>({});
 const previewPositions=useRef<Record<string,number>>({});
 const chooseMode=(mode:'practice'|'challenge')=>{setSessionSection(null);navigate(mode==='challenge'?'compete':'practice');};
 const saved=!!lesson?.landmarks?.key.startsWith('lessons/');
 const save=async(sections:Section[],title:string,feedbackEnabled?:boolean)=>{
  if(!lesson)return;
  if(!lessonOwned)throw new Error('Only the move creator can edit these sections.');
  if(saved){const value=await saveSections(lesson,sections,title,feedbackEnabled);setLesson(value);applySavedRevision(value.lesson_id,value.revision_id);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));void refresh();setNotice('Saved to your private moves.');}
  else{const value={...lesson,section_set:{...lesson.section_set,sections},...(feedbackEnabled===undefined?{}:{feedback_enabled:feedbackEnabled})};setLesson(value);setDemo(value);setNotice('Draft kept in this session. Add a private copy to save permanently.');}
 };
 const logout=()=>{if(dirty&&!window.confirm('Leave without saving your changes or take?'))return;setDirty(false);setDrawerOpen(false);void run(async()=>{await signOut();pager.beginReload();clearLessonContextCache();sessionStorage.removeItem('group-invite');sessionStorage.removeItem('move-invite');sessionStorage.removeItem('auth-return');sessionStorage.removeItem('auth-action');setGroupInvite(null);setAccount(null);setLibrary([]);setShared([]);setStates([]);setIncoming(null);setLesson(null);setMusic(null);setDrawing(null);setContext(null);setDemo(null);setNotice('');await refresh();setPage('moves');});};
 const beginAdjust=(value:LessonManifest)=>{setLesson(value);navigate('check');};
 const destinations=(account?[{id:'moves' as const,label:'Home',Icon:Home},{id:'explore' as const,label:'Explore',Icon:Globe},{id:'groups' as const,label:'Groups',Icon:Users},{id:'create' as const,label:'Create',Icon:Plus},...(studioEnabled?[{id:'studio' as const,label:'Studio',Icon:SlidersHorizontal}]:[]),{id:'account' as const,label:'You',Icon:User}]:[{id:'moves' as const,label:'Home',Icon:Home},{id:'explore' as const,label:'Explore',Icon:Globe},{id:'create' as const,label:'Create',Icon:Plus},{id:'account' as const,label:'You',Icon:User}]);
 return <div data-ui-surface="app" className={`app feed-app ${sidebarExpanded?'sidebar-expanded':'sidebar-compact'} ${(page==='music-review'&&reviewFocused)||(['practice','compete'].includes(page)&&Boolean(music&&!lesson))?'music-review-focus':''} ${['practice','compete'].includes(page)?'practising':''} ${page==='preview'?'watching-lesson':''} ${drawerNavigation?'navigation-overlay':''} ${drawerOpen?'navigation-open':''} ${page==='create'&&account?'creating-move':''} ${page==='check'?'checking-move':''} ${page==='review'&&lessonOwned?'editing-sections':''}`}>
  <header className="header">
   <div className="feed-header-brand"><IconButton variant="icon-feed" className="feed-sidebar-toggle" aria-label={drawerNavigation?(drawerOpen?'Close navigation':'Open navigation'):(sidebarExpanded?'Collapse sidebar':'Expand sidebar')} aria-expanded={drawerNavigation?drawerOpen:sidebarExpanded} aria-controls="primary-navigation" onClick={()=>drawerNavigation?setDrawerOpen(value=>!value):setSidebarExpanded(value=>!value)}><Menu size={22}/></IconButton><a className="brand" href="/" onClick={event=>{event.preventDefault();navigate('moves');}} aria-label="Form home"><span className="brand-symbol">f<MoveUpRight size={14}/></span>form<span className="brand-dot">.</span></a></div>
   <nav id="primary-navigation" aria-label="Main navigation" hidden={drawerNavigation&&!drawerOpen}>{destinations.filter(item=>item.id!=='account').map(({id,label,Icon})=><Button variant="nav" key={id} aria-label={label} title={label} className={`nav-item ${id==='create'?'mobile-create-nav':''} ${id==='studio'?'studio-nav':''} ${page===id?'active':''}`} aria-current={page===id?'page':undefined} onClick={()=>{if(id==='create')setAdjustFor(null);navigate(id);}}><Icon size={18}/><span>{label}</span></Button>)}</nav>
   <FeedSearch query={feedQuery} onQuery={setFeedQuery} label="Search practices" placeholder="Search lessons or creators" onSubmit={()=>{setFeedFilter('all');navigate('moves');}}/>
   <div className="feed-header-actions"><Button variant="feed-create" className="feed-create" aria-label="Create a practice" onClick={()=>{setAdjustFor(null);navigate('create');}}><Plus size={19}/><span>Create</span></Button><AccountMenu key={page} account={account} active={page==='account'} busy={busy} onAccount={()=>navigate('account')} onPractices={()=>{setFeedQuery('');setFeedFilter('own');navigate('moves');}} onPreferences={()=>{navigate('account');setAccountPreferences(true);}} onSignOut={logout}/></div>
  </header>
  {drawerOpen&&<button className="navigation-scrim" aria-label="Close navigation" onClick={()=>{setDrawerOpen(false);document.querySelector<HTMLElement>('.feed-sidebar-toggle')?.focus();}}/>}
  <main aria-busy={busy||loading} inert={drawerOpen||undefined}><Suspense fallback={<p role="status">Opening your move…</p>}>
   {error&&<div className="inline-notice error-notice" role="alert">{error}{page==='moves'&&<Button variant="feed-inline" className="back-link" onClick={()=>void refresh()}>Try again</Button>}</div>}
   {busy&&<p className="operation-status" role="status">One moment…</p>}
   {page==='receiver'&&<Suspense fallback={<p>Opening display…</p>}><MimicReceiver onBack={()=>navigate('moves')}/></Suspense>}
   <div className="feed-page" hidden={page!=='moves'}><PracticeFeed filter={feedFilter} setFilter={setFeedFilter} active={page==='moves'} query={feedQuery} onQuery={setFeedQuery} account={account} library={library} shared={shared} subjectFilterEnabled={subjectFilter} states={states} demo={demo} loading={loading} musicChallengeEnabled={musicChallenge} hasMore={libraryHasMore} loadingMore={libraryLoadingMore} onLoadMore={()=>void loadMoreLibrary()} total={libraryTotal} subject={ownedSubject} onSubject={setOwnedSubject} serverSubjects={ownedAvailableSubjects}
    onCreate={()=>{setAdjustFor(null);navigate('create');}} onSignIn={()=>navigate('account')}
    onOpen={(item,owned,check)=>open(item,check?'check':'practice',owned)}
    onPublic={id=>void run(()=>openPublicValue(id))}
    onManage={(item,action)=>{
     if(action==='check'||action==='edit'){if(action==='edit'&&item.experience_family==='music'){setEditMusic(item);setLesson(null);navigate('music-edit');return;}open(item,action);return;}
     if(action==='copy'){importDemo();return;}
     if(action==='share'){if(item.experience_family==='music'){setShareMusic(item);setLesson(null);navigate('share');return;}void run(async()=>{setLesson(await loadLesson(item.lesson_id));setLessonOwned(true);navigate('share');});}
     if(action==='remove'&&window.confirm(`Remove “${item.title}” from your practices?`))void run(async()=>{await request(`/lessons/${item.lesson_id}`,'DELETE');setLibrary(previous=>previous.filter(value=>value.lesson_id!==item.lesson_id));});
     if(action==='report'){const reason=window.prompt('What would you like to report?');if(reason&&reason.trim().length>=3)void run(async()=>{await request(`/lessons/${item.lesson_id}/report`,'POST',{reason});setNotice('Report received. Thank you.');});}
    }}>
    {account&&page==='moves'&&<div className="feed-uploads"><ConversionList readyIds={states.filter(state=>!state.latest_revision_id||state.accepted_revision_id!==state.latest_revision_id).map(state=>state.lesson_id)} onReady={()=>void refresh()} onOpen={id=>open({lesson_id:id},'check')}/></div>}
   </PracticeFeed>{notice&&<p className="inline-notice" role="status">{notice}</p>}</div>
   {page==='music-review'&&account&&reviewId&&<MusicReviewRoute lessonId={reviewId} onDirty={setDirty} onFocusedChange={setReviewFocused} onBack={()=>navigate('moves')} onReviewed={value=>{setDirty(false);applySavedRevision(value.lesson_id,value.revision_id);setMusic(value);setLesson(null);setLessonOwned(true);setPage('preview');void refresh();window.scrollTo({top:0});}}/>}
   {page==='music-comparison'&&account&&<PianoModelComparison comparisonId={comparisonId} linkedLessonId={reviewId} onStarted={id=>setComparisonId(id)} onBack={()=>navigate(reviewId?'music-review':'moves')}/>}
   {page==='preview'&&music&&!lesson&&<PracticePreview key={music.revision_id} lesson={music} owned={lessonOwned} capabilities={context?.lessonId===music.lesson_id?context.capabilities:null} resumeAt={previewPositions.current[music.lesson_id+':'+music.revision_id]??0} onPosition={time=>{previewPositions.current[music.lesson_id+':'+music.revision_id]=time;}} onChoose={()=>{setSessionSection(null);navigate('practice');}} onBack={()=>navigate('moves')}
     lessons={[...library.map(value=>({lesson:value,owned:true})),...shared.map(value=>({lesson:value,owned:false})),...(demo?[{lesson:summarizeBody(demo),owned:false}]:[])]}
     onOpen={item=>{setSessionSection(null);open(item.lesson,'practice',item.owned);}}
     onPublic={id=>void run(()=>openPublicValue(id))}/>}
   {page==='preview'&&lesson&&<PracticePreview key={lesson.revision_id} lesson={lesson} owned={lessonOwned} capabilities={context?.lessonId===lesson.lesson_id?context.capabilities:null} resumeAt={previewPositions.current[lesson.lesson_id+':'+lesson.revision_id]??lesson.source_start} onPosition={time=>{previewPositions.current[lesson.lesson_id+':'+lesson.revision_id]=time;}} onChoose={chooseMode} onBack={()=>navigate('moves')}
    lessons={[...library.map(value=>({lesson:value,owned:true})),...shared.map(value=>({lesson:value,owned:false})),...(demo?[{lesson:summarizeBody(demo),owned:false}]:[])]}
    onOpen={item=>{setSessionSection(null);open(item.lesson,'practice',item.owned);}}
    onPublic={id=>void run(()=>openPublicValue(id))}/>}
   {(page==='practice'||page==='compete'||(page==='review'&&!lessonOwned))&&(lesson||music||drawing)&&<LessonExperienceHost key={`${(lesson??music??drawing)!.revision_id}-${page}-${sessionSection}`} context={context?.lessonId===(lesson??music??drawing)!.lesson_id?context:null} document={lesson?{kind:'body',value:lesson}:music?{kind:'music',value:music}:{kind:'drawing',value:drawing!}} initialMode={page==='compete'?'compete':'practice'} challengeEnabled={musicChallenge} challengeHistoryEnabled={musicHistory} audioAssessmentEnabled={musicInference} onModeChange={mode=>{setSessionSection(null);navigate(mode==='watch'?'preview':mode);}} initialSettings={lesson?practicePreferences.current[lesson.lesson_id+':'+lesson.revision_id]:undefined} onSettings={value=>{if(lesson){practicePreferences.current[lesson.lesson_id+':'+lesson.revision_id]=value;}}} initialSection={sessionSection} onPracticeSection={index=>{setSessionSection(index<0?null:index);navigate('practice');}} sections={lesson?lesson.section_set.sections:[]} review={page==='review'&&lessonOwned} editable={lessonOwned} persistent={saved} legacyCompatible={lessonOwned&&saved&&Boolean(lesson?.animation)&&demo?.animation?.sha256===lesson?.animation?.sha256} onBack={()=>navigate(drawing||page==='review'?'moves':'preview')} onEdit={()=>navigate(page==='review'?'preview':'review')} onSave={save} onDirty={setDirty} notice={notice} pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary}/>}
   {page==='review'&&lesson&&lessonOwned&&<SectionEditor key={lesson.lesson_id} lesson={lesson} onBack={()=>navigate('moves')} onPractice={()=>navigate('preview')} onSave={save} onDirty={setDirty} persistent={saved}/>}
   {page==='check'&&lesson&&lessonOwned&&<MoveCheck key={lesson.revision_id} lesson={lesson} onDirty={setDirty} onBack={()=>navigate('moves')} onAccepted={value=>{setLesson(value);applySavedRevision(value.lesson_id,value.revision_id);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));setDirty(false);void refresh();setPage('move');window.scrollTo({top:0});}} onChooseAnother={()=>{setAdjustFor(null);navigate('create');}}/>}
   {page==='move'&&lesson&&lessonOwned&&<MoveDetail lesson={lesson} state={stateOf(lesson)} onBack={()=>navigate('moves')} onPractice={()=>navigate('preview')} onShare={()=>navigate('share')} onMore={()=>navigate('review')} onAdjust={()=>beginAdjust(lesson)} onRenamed={value=>{setLesson(value);setLibrary(previous=>previous.map(item=>item.lesson_id===value.lesson_id?summarizeBody(value,item):item));}}/>}
   {page==='share'&&lesson&&lessonOwned&&<ShareLesson lesson={lesson} onBack={()=>navigate('move')} onChange={()=>{applyReleaseChange(lesson.lesson_id);void refresh();}}/>}
   {page==='music-edit'&&(editMusic||editId)&&<Suspense fallback={<p role="status">Opening the lesson editor…</p>}><MusicLessonEditor lessonId={(editMusic?.lesson_id??editId)!} onDirty={setDirty} onBack={()=>{setEditMusic(null);setEditId(null);navigate('moves');}} onSaved={value=>{applySavedRevision(value.lesson_id,value.revision_id);setMusic(value);setLesson(null);setLessonOwned(true);setEditMusic(null);setEditId(null);navigate('preview');void refresh();}}/></Suspense>}
   {page==='drawing-share'&&drawingShareId&&account&&<Suspense fallback={<p role="status">Opening drawing share…</p>}><DrawingShareLesson lessonId={drawingShareId} title={library.find(item=>item.lesson_id===drawingShareId)?.title??'Drawing'} onBack={()=>{setDrawingShareId(null);navigate('studio');}} onChange={()=>{invalidateLessonContext(drawingShareId);void refresh();}}/></Suspense>}
    {page==='drawing-edit'&&drawingEditId&&account&&<Suspense fallback={<p role="status">Opening drawing editor…</p>}><DrawingEditorRoute lessonId={drawingEditId} accountId={account.id} onBack={()=>{setDrawingEditId(null);navigate('moves');}} onSaved={value=>{setDrawing(value);setDrawingEditId(value.lesson_id);invalidateLessonContext(value.lesson_id);void refresh();}}/></Suspense>}
    {page==='share'&&!lesson&&shareMusic&&<MusicShareLesson key={shareMusic.lesson_id} lessonId={shareMusic.lesson_id} title={shareMusic.title} onBack={()=>{setShareMusic(null);navigate('moves');}} onChange={()=>{applyReleaseChange(shareMusic.lesson_id);void refresh();}}/>}
   {page==='join'&&incoming&&<JoinLesson incoming={incoming} account={account} onSignIn={()=>navigate('account')} onBack={()=>navigate('moves')} onJoined={value=>{const musicValue=(value as MusicLessonManifest).schema_version===2?value as MusicLessonManifest:null;if(musicValue){setMusic(musicValue);setLesson(null);}else{setMusic(null);setLesson(value as LessonManifest);}setLessonOwned(false);try{setContext(buildLessonContext({document:musicValue?{kind:'music',value:musicValue}:{kind:'body',value:value as LessonManifest},audience:'invited',accountScope:account?.id??'guest',challengeEnabled:musicChallenge}));}catch{setContext(null);}setIncoming(null);sessionStorage.removeItem('move-invite');void loadSharedSummaries().then(setShared).catch(e=>setError(e.message));navigate('preview');}}/>}
   {page==='create'&&(account?<CreateLesson adjust={adjustFor??undefined} onBack={()=>{setAdjustFor(null);navigate('moves');}} onDone={()=>{setAdjustFor(null);navigate('moves');void refresh();}}/>:<section className="coming-screen"><div className="empty-state"><span className="note-art"><Video size={36}/></span><h1>Your next move.</h1><p className="subtle">Sign in to add a video and keep your moves.</p><button className="primary" onClick={()=>navigate('account')}>Sign in<ArrowRight size={18}/></button></div></section>)}
   {page==='explore'&&<ExplorePage query={feedQuery} onQuery={setFeedQuery} onOpen={id=>void run(()=>openPublicValue(id))}/>}
   {page==='public'&&publicId&&<PublicDetailPage id={publicId} account={account} onBack={()=>navigate('explore')} onSignIn={()=>navigate('account')} onTry={value=>void run(async()=>{const loaded=buildPublicLessonContext(value);setContext(loaded);const document=loaded.document;setLessonOwned(false);setSessionSection(null);setDrawing(null);setMusic(null);setLesson(null);if(document.kind==='drawing'){setDrawing(document.value);navigate('practice');}else if(document.kind==='music'){setMusic(document.value);navigate('preview');}else if(document.kind==='body'){setLesson(document.value);navigate('preview');}else throw new Error('This lesson cannot be opened here.');})}/>}
   {page==='groups'&&(account?<GroupsPage onOpen={id=>{setGroupId(id);navigate('group');}}/>:<section className="coming-screen"><div className="empty-state"><span className="note-art"><Users size={36}/></span><h1>Practise together.</h1><p className="subtle">Sign in to create or join a group.</p><button className="primary" onClick={()=>navigate('account')}>Sign in<ArrowRight size={18}/></button></div></section>)}
   {page==='group'&&groupId&&account&&<GroupDetailPage id={groupId} account={account} onBack={()=>navigate('groups')} onTry={move=>{if(move.access_kind!=='collection'){open(move,'practice',false);return;}void run(()=>openPublicValue(move.lesson_id));}}/>}
   {page==='groupjoin'&&groupInvite&&<GroupJoinPage invite={groupInvite} account={account} onSignIn={()=>navigate('account')} onBack={()=>navigate('moves')} onJoined={id=>{setGroupId(id);setGroupInvite(null);sessionStorage.removeItem('group-invite');navigate('group');}}/>}
   {page==='studio'&&account&&<StudioPage lessons={library} states={states} onBack={()=>navigate('moves')} onOpen={item=>open(item,'practice')} onCheck={item=>open(item,'check')} onAdjust={item=>open(item,'edit')} onEdit={item=>{if(item.experience_family==='visual'){setDrawingEditId(item.lesson_id);navigate('drawing-edit');}else open(item,'edit');}} onShare={item=>void run(async()=>{const loaded=await loadLessonContext(item.lesson_id,{audience:'owner',accountScope:account.id});setContext(loaded);if(loaded.actId==='piano'||loaded.actId==='guitar'){setShareMusic(item);setMusic(loaded.document.kind==='music'?loaded.document.value:null);setLesson(null);navigate('share');return;}if(loaded.actId==='drawing'){setDrawingShareId(item.lesson_id);setDrawing(loaded.document.kind==='drawing'?loaded.document.value:null);navigate('drawing-share');return;}if(loaded.document.kind==='body'){setLesson(loaded.document.value);setLessonOwned(true);navigate('share');return;}throw new Error('This lesson cannot be shared.');})} onCreate={()=>{setAdjustFor(null);navigate('create');}} onCreateDrawing={()=>void run(async()=>{const value=await createDrawingLesson({title:'New drawing',medium:'pencil',steps:[{id:'step-1',title:'First step',instruction:'Describe the first mark.'}]});invalidateLessonContext(value.lesson_id);await refresh();setDrawingEditId(value.lesson_id);navigate('drawing-edit');})} hasMore={libraryHasMore} loadingMore={libraryLoadingMore} onLoadMore={()=>void loadMoreLibrary()}/>}
   {page==='admin'&&(account&&['admin','super_admin'].includes(account.platform_role)?<AdminPage account={account} onBack={()=>navigate('moves')} onSessionLost={()=>{void refresh();navigate('account');}}/>:<section className="account-card"><h1>Administration</h1><p>Administrative access is required.</p><button className="primary" onClick={()=>navigate('account')}>Account</button></section>)}
   {page==='account'&&(account&&!initialLink?<section className="account-card"><span className="note-art"><Check size={32}/></span><p className="eyebrow">YOUR SPACE</p><h1>Ready to move.</h1><p className="account-email">{account.email}</p><p className="subtle">Your moves are saved privately. Sharing is always your choice.</p><button className="secondary" onClick={()=>navigate('receiver')}>Use as practice display</button>{['admin','super_admin'].includes(account.platform_role)&&<button className="secondary" onClick={()=>navigate('admin')}>Administration</button>}{musicHistory&&<Suspense fallback={<p>Opening music history…</p>}><MusicHistoryPanel key={account.id}/></Suspense>}<section id="account-preferences" className="account-preferences" tabIndex={-1}><h2>Preferences</h2><label className="check-line studio-toggle"><input type="checkbox" checked={studioEnabled} onChange={e=>setStudio(e.target.checked)}/><span>Show teaching tools (Studio)</span></label></section><button className="primary" onClick={()=>navigate('moves')}>My moves<ArrowRight size={18}/></button><button className="back-link" disabled={busy} onClick={logout}><LogOut size={16}/>Sign out</button></section>:<AuthPanel key={initialLink?.token??'sign-in'} initialLink={initialLink} onLinkHandled={()=>sessionStorage.removeItem('auth-action')} onSignedIn={async value=>{pager.beginReload();const savedLibrary=await loadLessonSummaries();const workflow=await loadMoveStates();setShared(await loadSharedSummaries());setAccount(value);setLesson(null);setMusic(null);setLibrary(savedLibrary);setStates(workflow.lessons);setInitialLink(null);sessionStorage.removeItem('auth-action');const destination=pending<string>('auth-return');sessionStorage.removeItem('auth-return');if(groupInvite)setPage('groupjoin');else if(incoming)setPage('join');else if(destination){history.replaceState(null,'','/'+destination);setRouteReady(false);}else setPage('moves');}}/>)}
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
