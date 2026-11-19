import {useEffect,useMemo,useRef,useState} from 'react';
import type {MusicDraftEvent,MusicDraftGuitarChord,MusicDraftView,MusicLessonManifest,Section} from '../../../../packages/lesson-schema/index';
import {parseMusicDraftView,parseMusicLessonManifest} from '../../../../packages/lesson-schema/parse';
import {assetUrl,request} from '../api';
import {DraftNotePreview} from './DraftNotePreview';
import {VerificationReview} from './VerificationReview';
import {auditionRange} from './note-audition';
import {clampOffsetSeconds,shiftOnset} from './piano-playback';
import {usePianoSourcePlayer} from './usePianoSourcePlayer';
import {usePianoPreferences} from './piano-preferences';
import {usePianoPreviewAsset} from './usePianoPreviewAsset';
import {applyFindingEdits, revertFindingEdits} from './working-edits';
import {assessmentPolicyForSubject, effectiveFeedbackEnabled} from './music-feedback';
import {decideVerification,findingDecision,loadVerification,parseVerificationState,rollbackAutomaticCorrections,type VerificationFinding,type VerificationState} from './verification';
import {VelocityInput} from './VelocityInput';
import './music.css';
import './music-review.css';

const PAGE_SIZE=50;
const OPEN_STRING:Record<number,number>={1:64,2:59,3:55,4:50,5:45,6:40};
const noteName=(pitch:number)=>`${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pitch%12]}${Math.floor(pitch/12)-1}`;

export function MusicDraftReview({lessonId,onBack,onCompare,onReviewed,onDirty}:{lessonId:string;onBack:()=>void;onCompare:()=>void;onReviewed:(lesson:MusicLessonManifest)=>void;onDirty:(dirty:boolean)=>void}){
 const [draft,setDraft]=useState<MusicDraftView|null>(null),[events,setEvents]=useState<MusicDraftEvent[]>([]),[sections,setSections]=useState<Section[]>([]),[title,setTitle]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[page,setPage]=useState(0),[retry,setRetry]=useState(0);
 const [feedbackEnabled,setFeedbackEnabled]=useState(true);
 const [chords,setChords]=useState<MusicDraftGuitarChord[]>([]);
 const [verification,setVerification]=useState<VerificationState|null>(null);
 const [verificationError,setVerificationError]=useState('');
 const [verificationBusy,setVerificationBusy]=useState(false);
 const [verificationLoading,setVerificationLoading]=useState(false);
 const [showComparison,setShowComparison]=useState(false);
 const [showDiagnostics,setShowDiagnostics]=useState(false);
 const [rollingBack,setRollingBack]=useState(false);
 const localDirty=useRef(false);
 const [selectedFinding,setSelectedFinding]=useState<string|null>(null);
 const [contextLoop,setContextLoop]=useState<{start:number;end:number}|null>(null);
 const auditionStop=useRef<(()=>void)|null>(null);
 const video=useRef<HTMLVideoElement>(null),alive=useRef(true);
 const piano=useRef<HTMLAudioElement>(null);
 const {audioMode,setAudioMode,volume,setVolume}=usePianoPreferences();
 const [playback,setPlayback]=useState<{sync_offset_seconds:number;revision:number}|null>(null);
 const [offsetMs,setOffsetMs]=useState('0');
 const [savingOffset,setSavingOffset]=useState(false);
 const [loop,setLoop]=useState(false),[loopStart,setLoopStart]=useState(0),[loopEnd,setLoopEnd]=useState(0);
 const syncOffset=playback?.sync_offset_seconds??0;
 useEffect(()=>{alive.current=true;let stopped=false;setError('');setDraft(null);
  request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft`).then(value=>{
   const parsed=parseMusicDraftView(value);if(!parsed.ok)throw new Error(parsed.message);
   if(stopped)return;localDirty.current=false;setDraft(parsed.value);setEvents(parsed.value.events);setChords(parsed.value.guitar_chords);setTitle(parsed.value.title);
   setFeedbackEnabled(effectiveFeedbackEnabled(parsed.value));
   setPlayback(parsed.value.playback??{sync_offset_seconds:0,revision:1});
   setOffsetMs(String(Math.round((parsed.value.playback?.sync_offset_seconds??0)*1000)));
   setSections([{id:'whole',label:'Whole lesson',start:0,end:parsed.value.duration}]);setConfirmed(false);setPage(0);
  }).catch(e=>{if(!stopped)setError(e.message);});
  return()=>{stopped=true;alive.current=false;onDirty(false);};
 },[lessonId,retry,onDirty]);
 useEffect(()=>{
  if(!draft||draft.raw_model){setVerification(null);setSelectedFinding(null);setVerificationLoading(false);return;}
  let stopped=false;setVerificationError('');setSelectedFinding(null);setVerificationLoading(true);
  loadVerification(lessonId,draft.draft_id).then(value=>{
   if(stopped)return;
   if(value===null){setVerification(null);return;}
   const parsed=parseVerificationState(value);if(!parsed.ok)throw new Error(parsed.message);
   setVerification(parsed.value);
   if(!localDirty.current)setEvents(parsed.value.events);
   else if(parsed.value.decisions.length>0)setVerificationError('Verification finished after you started editing, so accepted suggestions from another session were not merged into your unsaved notes. Reload to apply them.');
  }).catch(e=>{if(!stopped)setVerificationError((e as Error).message);})
   .finally(()=>{if(!stopped)setVerificationLoading(false);});
  return()=>{stopped=true;};
 },[draft,lessonId]);
 useEffect(()=>{
  const element=video.current;if(!element||!contextLoop)return;
  const tick=()=>{if(element.currentTime>=contextLoop.end){element.currentTime=contextLoop.start;void element.play().catch(()=>{});}};
  element.addEventListener('timeupdate',tick);
  return()=>element.removeEventListener('timeupdate',tick);
 },[contextLoop]);
 useEffect(()=>()=>{auditionStop.current?.();},[]);
 const previewStale=!!draft&&JSON.stringify(events)!==JSON.stringify(draft.events);
 const preview=usePianoPreviewAsset(draft?.piano_preview);
 const player=usePianoSourcePlayer(video,piano,preview.url&&!previewStale?audioMode:'original',syncOffset,`${draft?.draft_id}:${preview.url}`,()=>setAudioMode('original'));
 useEffect(()=>{if(video.current&&video.current.volume!==volume)video.current.volume=volume;});
 useEffect(()=>{if(draft&&!draft.piano_preview)setAudioMode('original');},[draft?.draft_id]);
 useEffect(()=>{if(previewStale)setAudioMode('original');},[previewStale]);
 useEffect(()=>{
  const media=video.current;if(!media||!loop||loopEnd<=loopStart)return;
  const tick=()=>{if(media.currentTime>=loopEnd)media.currentTime=loopStart;};
  media.addEventListener('timeupdate',tick);
  return()=>media.removeEventListener('timeupdate',tick);
 },[loop,loopStart,loopEnd]);

 const saveOffset=async(override?:number)=>{
  if(!playback)return;
  setSavingOffset(true);setError('');
  try{
   const milliseconds=override??Number(offsetMs);
   if(!Number.isFinite(milliseconds))throw new Error('Enter a finite sync adjustment in milliseconds.');
   const seconds=clampOffsetSeconds(milliseconds/1000);
   const value=await request<{sync_offset_seconds:number;revision:number}>(
     `/lessons/${encodeURIComponent(lessonId)}/music-draft/playback`,'PATCH',
     {draft_id:draft?.draft_id,sync_offset_seconds:seconds,revision:playback.revision});
   setPlayback(value);setOffsetMs(String(Math.round(value.sync_offset_seconds*1000)));
   setDraft(current=>current?{...current,playback:value}:current);
  }catch(e){setError((e as Error).message);}
  finally{setSavingOffset(false);}
 };
 useEffect(()=>{const last=Math.max(0,Math.ceil(events.length/PAGE_SIZE)-1);setPage(value=>Math.min(value,last));},[events.length]);
 const eventNumbers=useMemo<Record<string,number>>(()=>Object.fromEntries(events.map((event,index)=>[event.id,index+1])),[events]);
 const displayEvents=useMemo(()=>draft?events.map(event=>({...event,onset:shiftOnset(event.onset,syncOffset)}))
   .filter(event=>event.onset<draft.duration&&event.onset+(event.duration??.25)>0):events,[events,syncOffset,draft]);
 const selectedDetail=verification?.report?.findings.find(item=>item.id===selectedFinding);
 const highlighted=useMemo(()=>{
  const values=new Set<string>();
  if(!selectedDetail)return values;
  for(const event of events){
   if(selectedDetail.event_ids.includes(event.id))values.add(event.id);
   else if(selectedDetail.pitch!==null&&event.pitch===selectedDetail.pitch&&
     event.onset>=selectedDetail.time_range[0]-.12&&event.onset<=selectedDetail.time_range[1]+.12)values.add(event.id);
  }
  return values;
 },[events,selectedDetail]);
 const selection=useMemo(()=>{
  const pitches=new Set<number>();
  if(selectedDetail?.pitch!==null&&selectedDetail?.pitch!==undefined)pitches.add(selectedDetail.pitch);
  for(const event of events)if(highlighted.has(event.id))pitches.add(event.pitch);
  return {ids:highlighted,pitches,time:selectedDetail?.time_range[0]??0};
 },[events,highlighted,selectedDetail]);
 const changed=()=>{localDirty.current=true;setConfirmed(false);onDirty(true);};
 const edit=(index:number,patch:Partial<MusicDraftEvent>)=>{changed();setEvents(previous=>previous.map((event,i)=>i===index?{...event,...patch}:event));};
 const remove=(index:number)=>{changed();setEvents(previous=>previous.filter((_,i)=>i!==index));};
  const refreshReviewedLesson = async () => {
    try {
      const value = await request<unknown>(`/lessons/${lessonId}`, 'GET', undefined, false,
        {'X-Lesson-Formats': '1,2'});
      const parsed = parseMusicLessonManifest(value);
      if (parsed.ok) onReviewed(parsed.value);
    } catch {
      // The workspace reported the save; the route can refresh on its next visit.
    }
  };
 const save=async()=>{if(!draft||!confirmed||busy||verificationBusy||verificationLoading||savingOffset)return;setBusy(true);setError('');
  try{const result=await request<unknown>(`/lessons/${encodeURIComponent(lessonId)}/music-draft/review`,'POST',{
   draft_id:draft.draft_id,reference_sha256:draft.reference.sha256,title,events,spans:draft.spans,guitar_chords:chords,sections,confirm_reviewed:true,
   verification_state_token:verification?.state_token,
   assessment:assessmentPolicyForSubject(draft.subject),
   feedback_enabled:feedbackEnabled,
  });const parsed=parseMusicLessonManifest(result);if(!parsed.ok)throw new Error(parsed.message);if(alive.current){onDirty(false);onReviewed(parsed.value);}}
  catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}
 };
 const decisionFinding=(findingId:string,finding?:VerificationFinding):VerificationFinding|undefined=>{
  if(finding)return finding;
  const decision=verification?.decisions.find(item=>item.finding_id===findingId);
  if(!decision)return undefined;
  const summary=decision.finding;
  return {id:findingId,kind:summary?.kind??'verification',status:'suggested',
   time_range:summary?.time_range??[0,0],event_ids:[],pitch:summary?.pitch??null,
   explanation:summary?.explanation??'',evidence:{},alternatives:[],proposed_edits:decision.edits,
   ambiguous:false,ambiguity_reasons:[]};
 };
 const selectFinding=(finding:VerificationFinding)=>{
  setSelectedFinding(finding.id);
  if(video.current){video.current.currentTime=Math.max(0,finding.time_range[0]-.5);}
  const index=events.findIndex(event=>finding.event_ids.includes(event.id)
   ||(finding.pitch!==null&&event.pitch===finding.pitch
      &&event.onset>=finding.time_range[0]-.12&&event.onset<=finding.time_range[1]+.12));
  if(index<0)return;
  setPage(Math.floor(index/PAGE_SIZE));
  requestAnimationFrame(()=>document.getElementById(`draft-note-${events[index].id}`)?.scrollIntoView({block:'center',behavior:'smooth'}));
 };
 const decideFinding=async(findingId:string,decision:'accepted'|'rejected'|'cleared',finding?:VerificationFinding)=>{
  if(!draft||!verification||verificationBusy)return;
  const previous=findingDecision(verification,findingId);
  let nextEvents=events;
  if(decision==='accepted'){
   if(!finding)return;
   try{nextEvents=applyFindingEdits(events,finding,draft.duration);}
   catch(e){setError((e as Error).message);return;}
  }else if(decision==='cleared'&&previous?.decision==='accepted'){
   const target=decisionFinding(findingId,finding);
   if(!target)return;
   try{nextEvents=revertFindingEdits(events,target,draft.duration);}
   catch(e){setError((e as Error).message);return;}
  }
  setVerificationBusy(true);setError('');
  try{
   const value=await decideVerification(lessonId,draft.draft_id,verification.proposal_sha256,
     verification.state_token,verification.report_sha256,findingId,decision);
   const parsed=parseVerificationState(value);if(!parsed.ok)throw new Error(parsed.message);
   setVerification(parsed.value);
   if(decision!=='rejected'){
    // A rejected acceptance conflict is resolved by the server: its reconstruction
    // falls back to the baseline rather than leaving a locally invalid mixture.
    if(parsed.value.conflicts.length>0||parsed.value.invalid_working)setEvents(parsed.value.events);
    else setEvents(nextEvents);
    changed();
   }
  }catch(e){if(alive.current)setError((e as Error).message);}
  finally{if(alive.current)setVerificationBusy(false);}
 };
 const playContext=(finding:VerificationFinding)=>{
  const element=video.current;if(!element||!draft)return;
  const start=Math.max(0,finding.time_range[0]-.8),end=Math.min(draft.duration,finding.time_range[1]+.8);
  element.currentTime=start;setContextLoop({start,end});void element.play().catch(()=>{});
 };
 const stopContext=()=>{video.current?.pause();setContextLoop(null);auditionStop.current?.();auditionStop.current=null;};
 const auditionFinding=(finding:VerificationFinding,proposed:boolean)=>{
  video.current?.pause();auditionStop.current?.();
  const source=proposed?applyFindingEdits(events,finding,draft?.duration??finding.time_range[1]+1,false):events;
  const start=Math.max(0,finding.time_range[0]-.8),end=Math.min(draft?.duration??finding.time_range[1]+1,finding.time_range[1]+.5);
  auditionStop.current=auditionRange(source,start,end);
 };
 const rollbackAutomatic=async()=>{
  if(!draft||rollingBack||busy||verificationBusy)return;
  if(!verification){setError('Verification state is still loading. Try again before restoring the original notes.');return;}
  if(localDirty.current&&!window.confirm('Restore the original notes and discard your unsaved note edits?'))return;
  setRollingBack(true);setError('');
  try{
   await rollbackAutomaticCorrections(lessonId,draft.draft_id,verification.state_token);
   setShowComparison(false);setRetry(value=>value+1);
  }catch(e){if(alive.current)setError((e as Error).message);}
  finally{if(alive.current)setRollingBack(false);}
 };
 const locked=busy||verificationBusy||verificationLoading||rollingBack||savingOffset;
 return <section className="music-home music-review" aria-label="Review music reference">
  <div className="review-toolbar">
   <button className="back-link" disabled={locked} onClick={onBack}>Back to lessons</button>
   <button className="compare-models" disabled={locked} onClick={onCompare}>Compare AI models</button>
  </div>
  <h1>Review your music reference</h1>
  {error&&<p className="inline-notice error-notice" role="alert">{error}{!draft&&<button onClick={()=>setRetry(n=>n+1)}>Try again</button>}</p>}
  {!draft?!error&&<p role="status">Opening your proposal…</p>:draft.status==='reviewed'?<p role="status">This proposal has already been reviewed. Open the lesson from your library.</p>:<>
   <p className="review-intro">Follow the piano guide alongside your video, then refine the notes and teaching sections below.</p>
   {draft.working_corrected&&<div className="inline-notice" role="status">
    <p>Automatic verification applied {draft.automatic_corrections?.length??0} validated correction{draft.automatic_corrections?.length===1?'':'s'} to these working notes. The original proposal is kept internally and can be restored before saving.</p>
    <div className="verification-actions">
     <button type="button" disabled={locked} onClick={()=>setShowComparison(value=>!value)}>{showComparison?'Hide technical comparison':'Compare with original'}</button>
     <button type="button" disabled={locked} onClick={()=>{void rollbackAutomatic();}}>{rollingBack?'Restoring…':'Restore original notes'}</button>
    </div>
   </div>}
   {draft.working_corrected&&showComparison&&<div className="verification-unavailable">
    <p className="small muted">Original: {draft.baseline_events?.length??0} notes. Working: {events.length} notes. The original is the immutable draft; the working notes below are what you review and save.</p>
    <ul className="verification-decisions">
     {(draft.automatic_corrections??[]).map(correction=><li key={correction.finding_id}>
      <span className="verification-decision is-accepted">Automatic</span>
      <span>{correction.attribute ? `${correction.attribute} updated` : `${correction.kind} · ${correction.edits.length} edit${correction.edits.length===1?'':'s'} applied`} {new Date(correction.applied_at).toLocaleString()}</span>
     </li>)}
    </ul>
   </div>}
   {draft.provenance.engine==='fixture'&&<p className="inline-notice" role="status">Synthetic fixture proposal for testing. These notes are not a transcription of the video.</p>}
   <div className="review-source">
    <DraftNotePreview events={displayEvents} duration={draft.duration} highlightIds={highlighted} selection={selection} sourceRef={video} pedal={(draft.pedal??[]).map(span=>({...span,onset:span.onset+syncOffset,offset:span.offset+syncOffset}))}/>
    <aside className="review-reference" aria-label="Reference video">
     <div className="review-reference-heading"><span className="eyebrow">REFERENCE VIDEO</span><span className="small muted">{draft.subject==='piano'?'Piano':'Guitar'}</span></div>
     {draft.source_video?<video ref={video} src={assetUrl(draft.source_video.key)} controls playsInline preload="metadata" onVolumeChange={event=>setVolume(event.currentTarget.volume)} aria-label="Instructor video for reference review" onLoadedMetadata={event=>{if(loopEnd===0)setLoopEnd(event.currentTarget.duration);}}/>:<p className="inline-notice">Instructor video is unavailable for this older draft.</p>}
     <p className="small muted review-source-note">Play the video to follow the notes and keys in sync.</p>
    </aside>
   </div>
   <div className="review-audio">
    <div className="review-playback-bar">
    <div className="review-audio-modes" role="group" aria-label="Playback audio">
     <button type="button" className={audioMode==='original'?'primary':'secondary'} aria-pressed={audioMode==='original'} onClick={()=>setAudioMode('original')}>Original audio</button>
     <button type="button" className={audioMode==='piano'?'primary':'secondary'} aria-pressed={audioMode==='piano'} disabled={!preview.url||previewStale||!player.ready} onClick={()=>setAudioMode('piano')}>Piano audio</button>
    </div>
    <audio ref={piano} src={preview.url||undefined} preload="auto" aria-hidden="true"/>
    <label>Listening volume<input aria-label="Listening volume" type="range" min={0} max={1} step={.01} value={volume} onChange={event=>setVolume(Number(event.target.value))}/></label>
    </div>
    {player.error&&<p role="alert">{player.error}</p>}
    {preview.error&&<p role="alert">{preview.error} <button type="button" onClick={preview.retry}>Retry piano audio</button></p>}
    {previewStale&&<p role="status">Piano audio is unavailable after note edits. Original audio and the edited guide remain available.</p>}
    {draft.piano_preview&&!player.ready&&!previewStale&&!player.error&&<p role="status">Preparing piano audio…</p>}
    <details className="review-playback-settings"><summary>Sync &amp; loop settings</summary><div className="review-settings-fields">
    <label className="review-sync">Sync notes
     <input aria-label="Sync offset in milliseconds" type="number" step={10} min={-10000} max={10000} value={offsetMs} onChange={event=>setOffsetMs(event.target.value)}/> ms
    </label>
    <button type="button" disabled={savingOffset} onClick={()=>void saveOffset(syncOffset*1000-10)}>Earlier</button>
    <button type="button" disabled={savingOffset} onClick={()=>void saveOffset(syncOffset*1000+10)}>Later</button>
    <button type="button" disabled={savingOffset} onClick={()=>void saveOffset()}>Save sync</button>
    <button type="button" disabled={savingOffset} onClick={()=>{setOffsetMs('0');void saveOffset(0);}}>Reset</button>
    <label className="review-sync"><input aria-label="Loop playback" type="checkbox" checked={loop} onChange={event=>setLoop(event.target.checked)}/> Loop</label>
    <label className="review-sync">from <input aria-label="Loop start" type="number" min={0} max={draft.duration} step={0.1} value={loopStart} onChange={event=>setLoopStart(Number(event.target.value))}/></label>
    <label className="review-sync">to <input aria-label="Loop end" type="number" min={0} max={draft.duration} step={0.1} value={loopEnd} onChange={event=>setLoopEnd(Number(event.target.value))}/></label>
    <p className="small muted">Moves all detected notes and piano playback together. Original audio stays unchanged.</p>
    </div></details>
    {!draft.piano_preview&&<p className="inline-notice">Piano audio is not available for this draft.</p>}
    {draft.raw_model&&<p className="small muted">Detected notes: Kong raw model. Note lengths and velocity are model estimates.</p>}
   </div>
   <form onSubmit={event=>{event.preventDefault();void save();}}>
    <label>Lesson title<input required maxLength={200} value={title} disabled={locked} onChange={e=>{changed();setTitle(e.target.value);}}/></label>
    <fieldset className="music-review-policy"><legend>Feedback</legend>
     <label className="review-checkbox"><input type="checkbox" checked={feedbackEnabled} data-feedback-enabled disabled={locked}
       onChange={event=>{changed();setFeedbackEnabled(event.target.checked);}}/>Enable practice feedback</label>
     <p className="small muted">{feedbackEnabled
       ?`Reviewed ${draft.subject} references offer local pitch-and-timing note feedback. Microphone or MIDI input is selected during practice; scoring remains experimental and withheld. Guitar feedback assesses sounding pitch only, not string/fret certainty.`
       :'Practice feedback will be unavailable to learners for this lesson. Notes, sections and the reviewed reference are unchanged; ordinary playback still works.'}</p>
    </fieldset>
    {verificationLoading&&<p className="small muted" role="status">Checking automatic verification… Editing is paused until the report and any accepted suggestions have loaded.</p>}
    {verificationError&&<p className="inline-notice error-notice" role="alert">{verificationError}</p>}
    {verification&&<div className="verification-optional">
      <p className="small muted" role="status">Automatic processing is complete. {draft.automatic_corrections?.length??0} validated correction{draft.automatic_corrections?.length===1?'':'s'} applied; {verification.report?.findings.length??0} diagnostic observation{verification.report?.findings.length===1?'':'s'} available. Uncertain values were left unchanged.</p>
      <button type="button" className="secondary" aria-expanded={showDiagnostics}
              disabled={locked} onClick={()=>setShowDiagnostics(value=>!value)}>
        {showDiagnostics?'Hide advanced diagnostics':'Show advanced diagnostics'}
      </button>
      {showDiagnostics&&<VerificationReview state={verification} busy={locked} selected={selectedFinding}
        eventNumbers={eventNumbers} hasVideo={!!draft.source_video} playing={contextLoop!==null} baselineCount={draft.events.length}
        onSelect={selectFinding} onDecision={decideFinding} onPlay={playContext} onStop={stopContext}
        onAudition={auditionFinding}/>}
    </div>}
    {!draft.raw_model&&!verification&&!verificationError&&!verificationLoading&&draft.subject==='piano'&&<p className="small muted">Automatic verification was not retained for this draft. The proposal can still be reviewed and edited manually.</p>}
    <h2>Edit proposed notes</h2><p>{events.length} notes. Changes reset the review confirmation.</p>
    <div className="music-review-notes">{events.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((event,i)=>{const index=page*PAGE_SIZE+i;return <fieldset key={event.id} id={`draft-note-${event.id}`} className={highlighted.has(event.id)?'is-verification-target':undefined} disabled={locked}><legend>Note {index+1}</legend>
     <label>Note<select aria-label={`Note ${index+1} pitch`} value={event.pitch} onChange={e=>edit(index,{pitch:Number(e.target.value),string:null,fret:null})}>{Array.from({length:128},(_,pitch)=><option key={pitch} value={pitch}>{noteName(pitch)}</option>)}</select></label>
     {draft.subject==='guitar'&&<>
      <label>String<select aria-label={`Note ${index+1} string`} value={event.string??''} onChange={e=>{const string=e.target.value===''?null:Number(e.target.value);edit(index,string===null?{string:null,fret:null}:{string,fret:event.fret??0,pitch:OPEN_STRING[string]+(event.fret??0)});}}>
       <option value="">Not reviewed</option>{[6,5,4,3,2,1].map(string=><option key={string} value={string}>{string} ({noteName(OPEN_STRING[string])})</option>)}
      </select></label>
      <label>Fret<input aria-label={`Note ${index+1} fret`} type="number" min={0} max={12} value={event.fret??''} disabled={event.string===null}
       onChange={e=>{if(event.string===null)return;const fret=Math.max(0,Math.min(12,Number(e.target.value)||0));edit(index,{fret,pitch:OPEN_STRING[event.string]+fret});}}/></label>
     </>}
     <label>Start (seconds)<input aria-label={`Note ${index+1} start`} type="number" min={0} max={draft.duration} step="any" value={event.onset} onChange={e=>edit(index,{onset:Number(e.target.value)})}/></label>
     <label>Length (seconds)<input aria-label={`Note ${index+1} length`} type="number" min={.001} max={draft.duration} step="any" value={event.duration??''} onChange={e=>edit(index,{duration:e.target.value===''?null:Number(e.target.value)})}/></label>
     <label className="review-checkbox"><input type="checkbox" checked={event.optional} onChange={e=>edit(index,{optional:e.target.checked})}/>Optional</label>
     <VelocityInput label={`Note ${index+1} intensity`} value={event.velocity} disabled={locked} onChange={velocity=>edit(index,{velocity})}/>
     <button type="button" onClick={()=>{if(video.current){video.current.currentTime=event.onset;void video.current.play().catch(()=>{});}}} disabled={!draft.source_video}>Listen from note {index+1}</button>
     <button type="button" onClick={()=>remove(index)}>Remove note {index+1}</button>
    </fieldset>;})}</div>
    <div className="music-review-actions"><button type="button" disabled={locked||page===0} onClick={()=>setPage(n=>n-1)}>Previous notes</button><span>Page {page+1} of {Math.max(1,Math.ceil(events.length/PAGE_SIZE))}</span><button type="button" disabled={locked||(page+1)*PAGE_SIZE>=events.length} onClick={()=>setPage(n=>n+1)}>Next notes</button>
    <button type="button" disabled={locked||events.length>=20000} onClick={()=>{changed();setEvents(previous=>[...previous,{id:crypto.randomUUID(),onset:0,duration:Math.min(.25,draft.duration),pitch:60,velocity:null,confidence:null,optional:false,string:null,fret:null}]);setPage(Math.floor(events.length/PAGE_SIZE));}}>Add note</button></div>
    {draft.subject==='guitar'&&<>
     <h2>Reviewed chord shapes</h2>
     <p className="small muted">Strings low E to high E; -1 muted, 0 open. Saved with the reviewed reference.</p>
     {chords.map((chord,index)=><fieldset key={chord.id} disabled={locked}><legend>Chord {index+1}</legend>
      <label>Name<input aria-label={`Chord ${index+1} name`} maxLength={40} value={chord.name} onChange={e=>{changed();setChords(previous=>previous.map((item,i)=>i===index?{...item,name:e.target.value}:item));}}/></label>
      <label>Start (seconds)<input aria-label={`Chord ${index+1} start`} type="number" min={0} max={draft.duration} step="any" value={chord.start} onChange={e=>{changed();setChords(previous=>previous.map((item,i)=>i===index?{...item,start:Number(e.target.value)}:item));}}/></label>
      <label>Base position<input aria-label={`Chord ${index+1} position`} type="number" min={1} max={9} value={chord.position} onChange={e=>{changed();setChords(previous=>previous.map((item,i)=>i===index?{...item,position:Math.max(1,Math.min(12,Number(e.target.value)||1))}:item));}}/></label>
      {chord.frets.map((fret,string)=><label key={string}>{['low E','A','D','G','B','high E'][string]}<input aria-label={`Chord ${index+1} fret ${string+1}`} type="number" min={-1} max={12} value={fret} onChange={e=>{changed();setChords(previous=>previous.map((item,i)=>i===index?{...item,frets:item.frets.map((value,slot)=>slot===string?Math.max(-1,Math.min(12,Number(e.target.value))):value)}:item));}}/></label>)}
      <button type="button" onClick={()=>{changed();setChords(previous=>previous.filter((_,i)=>i!==index));}}>Remove chord {index+1}</button>
     </fieldset>)}
     <button type="button" disabled={locked||chords.length>=100} onClick={()=>{changed();setChords(previous=>[...previous,{id:crypto.randomUUID(),name:'C',start:0,frets:[-1,3,2,0,1,0],position:1}]);}}>Add chord</button>
    </>}
    <h2>Teaching sections</h2>{sections.map((section,index)=><fieldset key={section.id} disabled={locked}><legend>Section {index+1}</legend><label>Section name<input required maxLength={80} value={section.label} onChange={e=>{changed();setSections(previous=>previous.map((item,i)=>i===index?{...item,label:e.target.value}:item));}}/></label>
     <span>{section.start.toFixed(2)}–{section.end.toFixed(2)} seconds</span>{index<sections.length-1&&<label>Boundary (seconds)<input type="number" step="any" min={section.start+.05} max={sections[index+1].end-.05} value={section.end} onChange={e=>{changed();const boundary=Number(e.target.value);setSections(previous=>previous.map((item,i)=>i===index?{...item,end:boundary}:i===index+1?{...item,start:boundary}:item));}}/></label>}</fieldset>)}
    <button type="button" disabled={locked||sections.length>=500||sections[sections.length-1].end-sections[sections.length-1].start<.1} onClick={()=>{changed();setSections(previous=>{const last=previous[previous.length-1],mid=(last.start+last.end)/2;return [...previous.slice(0,-1),{...last,end:mid},{id:crypto.randomUUID(),label:`Section ${previous.length+1}`,start:mid,end:last.end}];});}}>Add section</button>
    {draft.spans.length>0&&<p>{draft.spans.length} proposed passages remain recorded with the reference. No scoring is enabled.</p>}
    {draft.warnings.map((warning,index)=><p className="small muted" key={index}>{warning}</p>)}
    <label className="review-checkbox"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)}/>I have checked the notes and teaching sections against the instructor material.</label>
    <button className="primary" disabled={locked||!confirmed}>{busy?'Saving review…':'Save reviewed reference'}</button>
   </form>
  </>}
 </section>;
}
