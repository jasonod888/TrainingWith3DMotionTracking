import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ApiError,cancelPianoComparison,createPianoComparison,loadComparisonSources,loadPianoComparison,loadPianoComparisonResults,pianoComparisonAssetUrl,pianoComparisonSourceUrl,registerLessonComparisonSource,retryPianoRun,type PianoComparison,type PianoComparisonRun,type PianoComparisonSource} from '../api';
import './piano-comparison.css';

const VARIANTS:{id:string;label:string}[]=[
 {id:'basic-pitch-native',label:'Basic Pitch — native'},
 {id:'basic-pitch-current-app',label:'Basic Pitch — current app'},
 {id:'kong-piano',label:'Kong'},
 {id:'transkun-v2',label:'Transkun'},
 {id:'onsets-frames-piano',label:'Onsets and Frames'},
];
const labelOf=(id:string)=>VARIANTS.find(value=>value.id===id)?.label??id;
const READY=new Set(['ready','partial']);

type Note={id:string;pitch_midi:number;onset_seconds:number;key_release_seconds?:number|null};
type Cell={value:unknown;state:string;reasons:string[]};
type Row={attribute:string;units:string;direction:string|null;note?:string;cells:Record<string,Cell>};

const stateText=(state:string)=>state==='measured'?'measured':state==='diagnostic_only'?'diagnostic only':state==='reference_unavailable'?'no reference':state==='not_estimated'?'not estimated':state==='unsupported_semantics'?'unsupported':state==='blocked_license'?'blocked by licence':state.replaceAll('_',' ');

function formatCell(row:Row,cell:Cell|undefined):string{
 if(!cell)return 'not run';
 if(cell.state!=='measured'&&cell.state!=='diagnostic_only')return stateText(cell.state);
 const value=cell.value as Record<string,unknown>|null;
 if(!value)return stateText(cell.state);
 const number=(key:string,digits=3)=>{const item=value[key];return typeof item==='number'?item.toFixed(digits):'—';};
 const milliseconds=(key:string)=>{const item=value[key];return typeof item==='number'?`${(item*1000).toFixed(1)} ms`:'—';};
 switch(row.attribute){
  case 'detected_notes':return `${value.notes} notes`;
  case 'note_correctness':return `F1 ${number('f1')} · P ${number('precision')} · R ${number('recall')} · ${value.matched}/${value.missing}/${value.extra}`;
  case 'fine_timing':return `MAE ${milliseconds('mae_seconds')} · p95 ${milliseconds('p95_seconds')} · bias ${milliseconds('bias_seconds')} · ${typeof value.all_reference_within_tolerance==='number'?`${(value.all_reference_within_tolerance*100).toFixed(1)}% within 20 ms`:'—'}`;
  case 'velocity':return `MAE ${number('mae',1)} units`;
  case 'relative_dynamics':return `ρ ${number('rank_correlation')}`;
  case 'audio':return `objective ${number('objective')} · ${number('gain_db',1)} dB`;
  case 'stereo_room':return stateText(cell.state);
  case 'human_similarity':return stateText(cell.state);
  case 'pedal':return Array.isArray(value.types)&&value.types.length?value.types.map((item:Record<string,unknown>)=>`${item.pedal_type} F1 ${typeof item.f1==='number'?item.f1.toFixed(3):'—'}`).join(' · '):stateText('not_estimated');
  case 'practicality':return `${number('inference_seconds',1)} s · ${String(value.device??'—')}`;
  default:return stateText(cell.state);
 }
}

function statusLabel(run:PianoComparisonRun|undefined){
 if(!run)return 'not run';
 if(run.status==='blocked_license')return 'blocked by licence';
 if(run.status==='failed')return 'failed';
 if(run.status==='ready')return 'ready';
 if(run.status==='partial')return 'ready with warnings';
 return run.status;
}

export function PianoModelComparison({comparisonId,linkedLessonId,onStarted,onBack}:{comparisonId:string|null;linkedLessonId?:string|null;onStarted:(id:string|null)=>void;onBack:()=>void}){
 const[comparison,setComparison]=useState<PianoComparison|null>(null);
 const[sources,setSources]=useState<PianoComparisonSource[]>([]);
 const[sourceId,setSourceId]=useState('');
 const[sourceLoading,setSourceLoading]=useState(true);
 const registrations=useRef(new Map<string,Promise<PianoComparisonSource>>());
 const[selected,setSelected]=useState<string[]>(VARIANTS.map(value=>value.id));
 const[results,setResults]=useState<{table?:Row[];blocked?:{variant:string;label:string;reasons:string[]}[]}|null>(null);
 const[selectedModel,setSelectedModel]=useState('original');
 const[notesOnly,setNotesOnly]=useState(false);
 const[notes,setNotes]=useState<Note[]>([]);
 const[nativeEndings,setNativeEndings]=useState<Record<string,{offset_seconds:number}>>({});
 const[preview,setPreview]=useState<{clipping?:boolean;controls?:Record<string,boolean>;mapping?:{native_offsets?:{convention?:string;notes?:number}}}|null>(null);
 const[time,setTime]=useState(0);
 const[duration,setDuration]=useState(0);
 const[loopEnabled,setLoopEnabled]=useState(false);
 const[loopStart,setLoopStart]=useState(0);
 const[loopEnd,setLoopEnd]=useState(0);
 const[loading,setLoading]=useState(true);
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const audioRef=useRef<HTMLAudioElement|null>(null);
 const resume=useRef({time:0,playing:false});
 const canvasRef=useRef<HTMLCanvasElement|null>(null);

 const ensureLessonSource=useCallback((lessonId:string)=>{
  const existing=registrations.current.get(lessonId);if(existing)return existing;
  const request=registerLessonComparisonSource(lessonId).catch(error=>{registrations.current.delete(lessonId);throw error;});
  registrations.current.set(lessonId,request);return request;
 },[]);

 const load=useCallback(async(id:string)=>{
  try{const value=await loadPianoComparison(id);setComparison(value);setLoading(false);}
  catch(caught){setError((caught as Error).message);setLoading(false);}
 },[]);

 useEffect(()=>{
  let cancelled=false;setSourceLoading(true);setSourceId('');
  void (async()=>{
   try{
    const value=await loadComparisonSources();if(cancelled)return;
    setSources(value.sources);
    if(!comparisonId&&linkedLessonId){
     const source=value.sources.find(item=>item.lesson_id===linkedLessonId)??await ensureLessonSource(linkedLessonId);
     if(cancelled)return;
     setSources(previous=>[source,...previous.filter(item=>item.id!==source.id)]);
     setSourceId(source.id);
    }
   }catch(caught){if(!cancelled)setError((caught as Error).message);}
   finally{if(!cancelled)setSourceLoading(false);}
  })();
  return()=>{cancelled=true;};
 },[linkedLessonId,comparisonId,ensureLessonSource]);

 useEffect(()=>{if(comparisonId)void load(comparisonId);else setLoading(false);},[comparisonId,load]);

 useEffect(()=>{
  if(!comparison||!['queued','running'].includes(comparison.status))return;
  const timer=window.setInterval(()=>{void load(comparison.id);},2500);
  return()=>window.clearInterval(timer);
 },[comparison,load]);

 useEffect(()=>{
  if(!comparison||!['complete','partial','blocked'].includes(comparison.status))return;
  let cancelled=false;
  void loadPianoComparisonResults(comparison.id).then(value=>{if(!cancelled)setResults(value as typeof results);}).catch(()=>{if(!cancelled)setResults(null);});
  return()=>{cancelled=true;};
 },[comparison]);

 const audioUrl=useMemo(()=>{
  if(!comparison)return '';
  if(selectedModel==='original')return pianoComparisonSourceUrl(comparison.id);
  return pianoComparisonAssetUrl(comparison.id,selectedModel,notesOnly?'preview-notes.wav':'preview.wav');
 },[comparison,selectedModel,notesOnly]);

 useEffect(()=>{
  if(!comparison||selectedModel==='original'){setNotes([]);setNativeEndings({});setPreview(null);return;}
  let cancelled=false;
  const loadJson=(asset:string)=>fetch(pianoComparisonAssetUrl(comparison.id,selectedModel,asset),{credentials:'same-origin'}).then(response=>response.ok?response.json():null).catch(()=>null);
  void Promise.all([loadJson('document.json'),loadJson('native.json'),loadJson('preview.json')]).then(([document,native,manifest])=>{
   if(cancelled)return;
   setNotes(document?.notes??[]);
   const endings:Record<string,{offset_seconds:number}>={};
   for(const event of native?.events??[]){if(typeof event.offset_seconds==='number')endings[String(event.id)]={offset_seconds:event.offset_seconds};}
   setNativeEndings(endings);
   setPreview(manifest?.previews?.as_transcribed??null);
  });
  return()=>{cancelled=true;};
 },[comparison,selectedModel]);

 useEffect(()=>{
  const audio=audioRef.current;if(!audio)return;
  const prior=resume.current;
  audio.load();
  const restore=()=>{if(prior.time&&Number.isFinite(prior.time))audio.currentTime=prior.time;audio.removeEventListener('loadedmetadata',restore);};
  audio.addEventListener('loadedmetadata',restore);
  if(prior.playing)void audio.play().catch(()=>undefined);
 },[audioUrl]);

 useEffect(()=>{
  const canvas=canvasRef.current;if(!canvas)return;
  const context=canvas.getContext('2d');if(!context)return;
  const ratio=window.devicePixelRatio||1;
  const width=canvas.clientWidth||640,height=180;
  canvas.width=width*ratio;canvas.height=height*ratio;
  context.setTransform(ratio,0,0,ratio,0,0);
  context.clearRect(0,0,width,height);
  context.fillStyle='#f4f1ea';context.fillRect(0,0,width,height);
  const start=comparison?.interval[0]??0,end=comparison?.interval[1]??Math.max(duration,1);
  const span=Math.max(end-start,0.001);
  const low=21,high=108;
  for(const note of notes){
   const x=((note.onset_seconds-start)/span)*width;
   const release=nativeEndings[note.id]?.offset_seconds??note.key_release_seconds??note.onset_seconds+0.5;
   const w=Math.max(((release-note.onset_seconds)/span)*width,1);
   const y=height-((note.pitch_midi-low)/(high-low))*height;
   context.fillStyle='#35556b';context.fillRect(x,y,w,3);
  }
  const playhead=((time-start)/span)*width;
  context.strokeStyle='#b6442e';context.lineWidth=2;
  context.beginPath();context.moveTo(playhead,0);context.lineTo(playhead,height);context.stroke();
 },[notes,time,comparison,duration,nativeEndings]);

 const chooseModel=useCallback((model:string)=>{
  const audio=audioRef.current;if(audio)resume.current={time:audio.currentTime,playing:!audio.paused};
  setSelectedModel(model);
 },[]);

 const start=async()=>{
  if(!sourceId||sourceLoading)return;
  setBusy(true);setError('');
  try{const value=await createPianoComparison(sourceId,selected);setComparison(value);onStarted(value.id);}
  catch(caught){setError(caught instanceof ApiError?caught.message:(caught as Error).message);}
  finally{setBusy(false);}
 };

 const registerLesson=async()=>{
  if(!linkedLessonId)return;
  setBusy(true);setError('');
  try{const source=await ensureLessonSource(linkedLessonId);const value=await loadComparisonSources();setSources(value.sources);setSourceId(source.id);}
  catch(caught){setError(caught instanceof ApiError?caught.message:(caught as Error).message);}
  finally{setBusy(false);}
 };

 const reset=()=>{setComparison(null);onStarted(null);setResults(null);setSelectedModel('original');setNotes([]);setNativeEndings({});setPreview(null);setTime(0);setDuration(0);resume.current={time:0,playing:false};};

 if(loading)return <main className="comparison-page"><p>Loading comparisons…</p></main>;

 if(!comparison)return <main className="comparison-page">
  <button className="back-link" onClick={onBack}>Back</button>
  <h1>Compare AI models</h1>
  <p className="comparison-note">Run the permitted transcription models on one registered recording. Each model's raw output is scored independently; no correction is applied.</p>
  {error&&<p className="comparison-error" role="alert">{error}</p>}
  {sourceLoading&&<p role="status">Preparing this recording for comparison…</p>}
  {sources.length===0?<p>No comparison source has been registered for this account yet.</p>:<>
   <label className="comparison-field">Recording
    <select value={sourceId} disabled={sourceLoading||busy} onChange={event=>setSourceId(event.target.value)}>
     <option value="" disabled>Choose a recording</option>
     {sources.map(source=><option key={source.id} value={source.id}>{source.label} · {source.seconds.toFixed(1)} s{source.has_reference?' · scored':' · observation only'}</option>)}
    </select>
   </label>
   {linkedLessonId&&<button className="comparison-secondary" disabled={busy} onClick={()=>void registerLesson()}>Use this lesson's retained source</button>}
   <fieldset className="comparison-variants"><legend>Models</legend>
    {VARIANTS.map(variant=><label key={variant.id}><input type="checkbox" checked={selected.includes(variant.id)} onChange={event=>setSelected(current=>event.target.checked?[...current,variant.id]:current.filter(value=>value!==variant.id))}/> {variant.label}</label>)}
   </fieldset>
   <button className="comparison-start" disabled={busy||sourceLoading||!sourceId||selected.length===0} onClick={()=>void start()}>{busy?'Starting…':'Start comparison'}</button>
  </>}
 </main>;

 const runOf=(variant:string)=>comparison.runs.find(run=>run.variant===variant);
 const current=runOf(selectedModel);
 const modelButtons=['original',...comparison.variants];
 const resultRows=results?.table??[];

 return <main className="comparison-page">
  <button className="back-link" onClick={onBack}>Back</button>
  <header className="comparison-header">
   <div><h1>Compare AI models</h1>
    <p className="comparison-note">{comparison.status==='complete'?'All requested models finished.':comparison.status==='partial'?'Some models finished; blocked or failed rows are shown.':'Models are running. Each finished result becomes playable immediately.'}</p></div>
   <span className={`comparison-state comparison-${comparison.status}`}>{comparison.status}</span>
  </header>
  <p className="comparison-note comparison-recording"><strong>Recording: </strong>{sources.find(source=>source.id===comparison.source_id)?.label??'Loading recording…'} · {(comparison.interval[1]-comparison.interval[0]).toFixed(1)} seconds</p>
  {error&&<p className="comparison-error" role="alert">{error}</p>}
  <div className="comparison-transport">
   <div className="comparison-buttons">
    {modelButtons.map(model=>{
     const run=model==='original'?undefined:runOf(model);
     const available=model==='original'||(run&&READY.has(run.status));
     const blocked=run?.status==='blocked_license'||run?.status==='identity_unresolved';
     return <button key={model} className={selectedModel===model?'comparison-source active':'comparison-source'} disabled={!available} title={blocked?(run?.blocked_reasons.join('; ')||'Blocked'):undefined} onClick={()=>chooseModel(model)}>
      {model==='original'?'Original audio':labelOf(model)}
      {run&&!available&&<small> · {statusLabel(run)}</small>}
     </button>;
    })}
   </div>
   {selectedModel!=='original'&&<label className="comparison-toggle"><input type="checkbox" checked={notesOnly} onChange={event=>setNotesOnly(event.target.checked)}/> Notes and timing only</label>}
   <audio ref={audioRef} src={audioUrl} controls preload="metadata"
    onLoadedMetadata={event=>{const value=event.currentTarget.duration||0;setDuration(value);if(loopEnd===0)setLoopEnd(value);}}
    onTimeUpdate={event=>{const audio=event.currentTarget;setTime(audio.currentTime);if(loopEnabled&&loopEnd>loopStart&&audio.currentTime>=loopEnd){audio.currentTime=loopStart;setTime(loopStart);}}}/>
   <div className="comparison-seek">
    <input aria-label="Seek" type="range" min={0} max={duration||comparison.interval[1]} step={0.01} value={Math.min(time,duration||comparison.interval[1])} onChange={event=>{const audio=audioRef.current;if(audio)audio.currentTime=Number(event.target.value);}}/>
    <span>{time.toFixed(1)} / {(duration||comparison.interval[1]).toFixed(1)} s</span>
   </div>
   <div className="comparison-loop">
    <label><input type="checkbox" checked={loopEnabled} onChange={event=>setLoopEnabled(event.target.checked)}/> Loop</label>
    <label>from <input aria-label="Loop start" type="number" min={0} max={duration} step={0.1} value={loopStart} onChange={event=>setLoopStart(Number(event.target.value))}/></label>
    <label>to <input aria-label="Loop end" type="number" min={0} max={duration} step={0.1} value={loopEnd} onChange={event=>setLoopEnd(Number(event.target.value))}/></label>
   </div>
  </div>
  <canvas ref={canvasRef} className="comparison-roll" aria-label="Note roll for the selected model"/>
  {selectedModel!=='original'&&Object.keys(nativeEndings).length>0&&<p className="comparison-note">Note lengths use the model's declared predicted offsets{preview?.mapping?.native_offsets?.convention?` (${preview.mapping.native_offsets.convention})`:''}; they are not measured physical key release.</p>}
  {selectedModel!=='original'&&preview?.clipping&&<p className="comparison-warning" role="status">Preview clipped at the synthesis stage. Level and attack comparisons from this preview are not evidence; regenerate with the common headroom policy.</p>}
  {selectedModel!=='original'&&preview?.controls&&!preview.controls.soft_pedal&&<p className="comparison-note">The common renderer does not support soft pedal; a soft-pedal listening conclusion is not available.</p>}
  {selectedModel!=='original'&&commonWarnings(current).map(warning=><p className="comparison-note" key={warning}>{warning}</p>)}
  <section className="comparison-runs">
   <h2>Model runs</h2>
   <ul>
    {comparison.runs.map(run=><li key={run.variant}>
     <strong>{labelOf(run.variant)}</strong> · {statusLabel(run)}
     {run.blocked_reasons.length>0&&<span> · {run.blocked_reasons.join('; ')}</span>}
     {run.error&&<span className="comparison-error"> · {run.error}</span>}
     {run.status==='failed'&&<button onClick={()=>void retryPianoRun(comparison.id,run.variant).then(()=>load(comparison.id)).catch(caught=>setError((caught as Error).message))}>Retry</button>}
    </li>)}
   </ul>
   <div className="comparison-actions">
    {['queued','running'].includes(comparison.status)&&<button onClick={()=>void cancelPianoComparison(comparison.id).then(value=>setComparison(value)).catch(caught=>setError((caught as Error).message))}>Cancel remaining</button>}
    <button onClick={reset}>New comparison</button>
   </div>
  </section>
  {resultRows.length>0&&<section className="comparison-results">
   <h2>Results</h2>
   <p className="comparison-note">Attribute rows are never combined into an overall score or a winner. A diagnostic or unavailable state is not a pass.</p>
   <div className="comparison-table-wrap">
    <table>
     <thead><tr><th>Attribute</th>{comparison.variants.map(variant=><th key={variant}>{labelOf(variant)}</th>)}</tr></thead>
     <tbody>{resultRows.map(row=><tr key={row.attribute}>
      <th scope="row" title={row.note}>{row.attribute.replaceAll('_',' ')}<small>{row.units}{row.direction?` · ${row.direction.replaceAll('_',' ')}`:''}</small></th>
      {comparison.variants.map(variant=><td key={variant} title={row.note} className={`cell-${row.cells[variant]?.state??'not_run'}`}>{formatCell(row,row.cells[variant])}</td>)}
     </tr>)}</tbody>
    </table>
   </div>
  </section>}
  {!results&&['complete','partial'].includes(comparison.status)&&<p className="comparison-note">Results are being prepared; refresh in a moment.</p>}
  {!results&&comparison.status==='blocked'&&<p className="comparison-note">No permitted model completed for this comparison. The blocked rows explain why.</p>}
  <p className="comparison-note">Listening does not change the owner's proposed notes. Downloads expose raw MIDI/events separately.</p>
 </main>;
}

function commonWarnings(run:PianoComparisonRun|undefined):string[]{
 if(!run||!READY.has(run.status))return [];
 return ['Common synthetic preview: one renderer and gain policy for every model. It is not evidence of fidelity.'];
}
