import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Music2, Pause, Play} from 'lucide-react';
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import {assetUrl} from '../api';
import {
  activeEvents, currentSpan, GUITAR_STRING_LABELS, guitarPosition, parseMusicReference,
  bindMusicReference, supportsGuitarDiagram, pianoGeometry, pitchName, type MusicReference,
} from './music-reference';
import './music.css';
import {MidiKeyboardCheck} from './MidiKeyboardCheck';
import {attackSourceTime} from '../../../../packages/music-engine/onsets';
import {buildRunFeedback, calibrateLatency, feedbackEligibility, invalidFeedback, type Attack, type MusicFeedback, type RunClock} from './music-feedback';
import {
  advancePractice, practiceLabel, practiceSourceTime, PRACTICE_SPEEDS, startPractice,
  type PracticeOptions, type PracticeSpeed, type PracticeState,
} from './music-practice';

const label = (lesson: MusicLessonManifest) => lesson.subject === 'piano' ? 'Piano' : 'Guitar';

function timeLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

/**
 * Reviewed music lesson: instructor playback plus an animated guide.
 *
 * The reviewed reference is read and validated at runtime. It requests no camera,
 * microphone or MIDI access, offers no scoring, and keeps the original instructor audio.
 */
export function MusicLessonHome({lesson, onBack,midiSetupEnabled=false}: {lesson: MusicLessonManifest; onBack: () => void;midiSetupEnabled?:boolean}) {
  const [loaded,setLoaded]=useState<{identity:string;value:MusicReference}|null>(null);
  const identity=`${lesson.revision_id}:${lesson.reference.key}:${lesson.reference.sha256}`;
  const reference=loaded?.identity===identity?loaded.value:null;
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [videoFailed,setVideoFailed]=useState(false),[retry,setRetry]=useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const clock = useRef(0);
  const [practice,setPractice]=useState<PracticeState|null>(null);
  const [practiceOptions,setPracticeOptions]=useState<PracticeOptions|null>(null);
  const [captured,setCaptured]=useState(0);
  const [keyboardConnected,setKeyboardConnected]=useState(false);
  const [practiceSection,setPracticeSection]=useState('all');
  const [countIn,setCountIn]=useState(4);
  const [repeats,setRepeats]=useState(1);
  const [speed,setSpeed]=useState<PracticeSpeed>(1);
  const practiceRef=useRef<PracticeState|null>(null),optionsRef=useRef<PracticeOptions|null>(null);
  const [latency,setLatency]=useState<number|null>(null);
  const [calibration,setCalibration]=useState<{pulse:number;samples:number}|null>(null);
  const [feedback,setFeedback]=useState<MusicFeedback[]>([]);
  const [feedbackNotice,setFeedbackNotice]=useState('');
  const runs=useRef<{run:number;attacks:Attack[];clock:RunClock;complete:boolean}[]>([]);
  const runClock=useRef<RunClock|null>(null);
  const practiceStarted=useRef(0);
  const referenceRef=useRef<MusicReference|null>(null);referenceRef.current=reference;
  const latencyRef=useRef<number|null>(null);latencyRef.current=latency;
  const calibrationRef=useRef<{active:boolean;expected:number[];samples:number[]}>({active:false,expected:[],samples:[]});
  const calibrationTimer=useRef<number|null>(null);
  const calibrationFinish=useRef<number|null>(null);
  const cancelCalibration=()=>{
    if(calibrationTimer.current!==null)window.clearInterval(calibrationTimer.current);
    if(calibrationFinish.current!==null)window.clearTimeout(calibrationFinish.current);
    calibrationTimer.current=null;calibrationFinish.current=null;
    calibrationRef.current={active:false,expected:[],samples:[]};setCalibration(null);
  };
  const eligibility=feedbackEligibility({assessment:lesson.assessment,subject:lesson.subject,
    referenceReviewed:lesson.reference_reviewed===true,inputSelected:keyboardConnected,latencyMeasured:latency!==null});
  const eligibilityRef=useRef(eligibility);eligibilityRef.current=eligibility;
  const source = lesson.source_video && !videoFailed ? assetUrl(lesson.source_video.key) : '';

  useEffect(() => {
    let stopped = false;const abort=new AbortController();
    setLoaded(null);setError('');setTime(0);clock.current=0;setPlaying(false);setVideoFailed(false);
    practiceRef.current=null;optionsRef.current=null;setPractice(null);setPracticeOptions(null);setCaptured(0);setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;cancelCalibration();setLatency(null);
    void fetch(assetUrl(lesson.reference.key), {signal:abort.signal,credentials:'same-origin',headers: {'Accept': 'application/json'}})
      .then(async response => {
        if (!response.ok) throw new Error('The reviewed reference could not be loaded.');
        const bytes=await response.arrayBuffer();
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
        if(bytes.byteLength!==lesson.reference.bytes||digest!==lesson.reference.sha256)throw new Error('The reference does not match its reviewed file. Reopen the lesson.');
        return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      })
      .then(value => { if (!stopped) setLoaded({identity,value:bindMusicReference(parseMusicReference(value),lesson)}); })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The reviewed reference could not be loaded.'); });
    return () => { stopped = true;abort.abort(); };
  }, [identity,retry]);

  useEffect(() => {
    if (!playing || !reference) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(reference.duration, video.current ? video.current.currentTime : clock.current + (now - last) / 1000);
      last = now;
      clock.current = next;
      setTime(next);
      if (next >= reference.duration) {video.current?.pause();setPlaying(false);}
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source, reference]);

  const practiceActive=Boolean(practice&&practice.phase!=='done');
  useEffect(()=>{
    if(!practiceOptions||!practiceActive)return;
    let frame=0,last=practiceStarted.current;
    const tick=(now:number)=>{
      const current=practiceRef.current,options=optionsRef.current;
      if(!current||!options||current.phase==='done')return;
      const delta=(now-last)/1000;last=now;
      if(delta>0.25){
        const run=current.run;stopPractice(false);
        setFeedback([invalidFeedback('Practice timing was interrupted. Try this run again.',run,options.sectionId)]);return;
      }
      const next=advancePractice(current,delta,options);
      practiceRef.current=next;setPractice(next);
      const value=next.phase==='done'?options.end:practiceSourceTime(next,options);
      clock.current=value;setTime(value);if(video.current)video.current.currentTime=value;
      if(next.phase==='playing'&&(current.phase!=='playing'||next.run!==current.run||!runClock.current)){
        const measured={wallStartMs:now-next.elapsed*1000,sourceStart:options.start,sourceEnd:options.end,speed:options.speed,inputLatencyMs:latencyRef.current??0};
        runClock.current=measured;runs.current.push({run:next.run,attacks:[],clock:measured,complete:false});
      }
      if(current.phase==='playing'&&next.phase!=='playing'){
        const run=runs.current.find(item=>item.run===current.run);
        if(run){run.complete=true;const gate=eligibilityRef.current;
          if(gate.eligible&&referenceRef.current){
            setFeedback(previous=>[...previous,buildRunFeedback({reference:referenceRef.current!,sectionId:options.sectionId,
              start:options.start,end:options.end,speed:options.speed,run:run.run,attacks:run.attacks,
              latencyMs:latencyRef.current??0,latencyMeasured:latencyRef.current!==null})]);
          }else{setFeedbackNotice(gate.reasons[0]??'Feedback is unavailable for this lesson.');}
        }
      }
      if(next.phase==='done'){setPlaying(false);return;}
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[practiceOptions,practiceActive]);

  useEffect(()=>()=>{
    if(calibrationTimer.current!==null)window.clearInterval(calibrationTimer.current);
    if(calibrationFinish.current!==null)window.clearTimeout(calibrationFinish.current);
    calibrationRef.current.active=false;
  },[]);

  useEffect(()=>{const media=video.current;const pause=()=>{cancelCalibration();media?.pause();setPlaying(false);if(practiceRef.current)stopPractice(false);};const hide=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',pause);return()=>{media?.pause();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',pause);};},[source,lesson.revision_id,reference]);

  const seek = (value: number) => {
    if(practiceRef.current)stopPractice(false);
    const next = Math.max(0, Math.min(reference?.duration ?? lesson.duration, value));
    clock.current = next;
    setTime(next);
    if (video.current) video.current.currentTime = next;
  };

  const toggle = async () => {
    setError('');
    if(practiceRef.current)stopPractice(false);
    if (!playing&&clock.current>=(reference?.duration??lesson.duration)-.01)seek(0);
    if (!video.current) { setPlaying(value => !value); return; }
    if (video.current.paused) {
      try { await video.current.play(); } catch { setError('Playback could not start. Press play again.'); }
    } else {
      video.current.pause();
    }
  };

  const stopPractice=(returnToStart=true)=>{
    const current=optionsRef.current;
    practiceRef.current=null;optionsRef.current=null;setPractice(null);setPracticeOptions(null);setCaptured(0);setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;setPlaying(false);
    if(returnToStart&&current){clock.current=current.start;setTime(current.start);if(video.current)video.current.currentTime=current.start;}
  };

  const beginPractice=()=>{
    if(!reference||calibrationRef.current.active)return;
    const section=lesson.section_set.sections.find(item=>item.id===practiceSection);
    const start=section?section.start:0,end=section?section.end:reference.duration;
    if(end-start<0.2)return;
    const options:PracticeOptions={sectionId:practiceSection,start,end,repeats,countInBeats:countIn,speed};
    const state=startPractice(options);
    practiceStarted.current=performance.now();
    setPracticeOptions(options);optionsRef.current=options;practiceRef.current=state;setPractice(state);setCaptured(0);setFeedback([]);setFeedbackNotice('');runs.current=[];runClock.current=null;
    if(state.phase==='playing'){
      const measured={wallStartMs:practiceStarted.current,sourceStart:start,sourceEnd:end,speed,inputLatencyMs:latencyRef.current??0};
      runClock.current=measured;runs.current.push({run:0,attacks:[],clock:measured,complete:false});
    }
    setPlaying(false);video.current?.pause();clock.current=start;setTime(start);if(video.current)video.current.currentTime=start;
  };

  const handleAttack=useCallback(({pitch,timeStamp}:{pitch:number;timeStamp:number})=>{
    const calibrationState=calibrationRef.current;
    if(calibrationState.active){
      const expected=calibrationState.expected[calibrationState.expected.length-1];
      const offset=timeStamp-expected;
      if(Number.isFinite(offset)&&offset>=0&&offset<=300){
        // Consume at most one tap for this pulse; chords are not extra samples.
        calibrationState.expected.pop();
        calibrationState.samples.push(offset);
        setCalibration(value=>value?{...value,samples:calibrationState.samples.length}:value);
      }
      return;
    }
    const current=practiceRef.current,measured=runClock.current;
    if(document.hidden||current?.phase!=='playing'||!measured)return;
    if(!Number.isInteger(pitch)||pitch<0||pitch>127||!Number.isFinite(timeStamp))return;
    const sourceTime=attackSourceTime(timeStamp,measured);
    if(sourceTime==null)return;
    const run=runs.current.find(item=>item.run===current.run&&!item.complete);
    if(!run)return;
    if(run.attacks.length>=20000){stopPractice(false);setFeedback([invalidFeedback('Too much input to analyse this run.',current.run,optionsRef.current?.sectionId??'all')]);return;}
    run.attacks.push({id:`run-${current.run}-${run.attacks.length}`,pitch,sourceTime});
    setCaptured(value=>value+1);
  },[]);

  const startCalibration=()=>{
    stopPractice(false);cancelCalibration();setLatency(null);
    calibrationRef.current={active:true,expected:[],samples:[]};
    setCalibration({pulse:0,samples:0});setFeedbackNotice('');
    let pulse=0;
    calibrationTimer.current=window.setInterval(()=>{
      pulse+=1;
      calibrationRef.current.expected.push(performance.now());
      setCalibration(value=>value?{...value,pulse}:value);
      if(pulse>=8){
        if(calibrationTimer.current)window.clearInterval(calibrationTimer.current);
        calibrationTimer.current=null;
        calibrationFinish.current=window.setTimeout(finishCalibration,700);
      }
    },600);
  };

  const finishCalibration=()=>{
    if(!calibrationRef.current.active)return;
    calibrationFinish.current=null;
    const samples=calibrationRef.current.samples;
    try{const measured=calibrateLatency(samples);setLatency(measured);setFeedbackNotice(`Personal timing alignment estimated at ${measured} ms; hardware latency is not measured.`);}
    catch{setFeedbackNotice('Not enough taps to measure delay. Play one note with each pulse and try again.');}
    calibrationRef.current={active:false,expected:[],samples:[]};
    setCalibration(null);
  };

  const active = useMemo(() => reference ? activeEvents(reference, time) : [], [reference, time]);
  const activePitches = useMemo(() => new Set(active.map(event => event.pitch)), [active]);
  const geometry = useMemo(() => reference ? pianoGeometry(reference.events) : null, [reference]);
  const positions = useMemo(() => active.map(event => ({event, position: guitarPosition(event.pitch)}))
    .filter(item => item.position), [active]);
  const guitarSupported=reference? supportsGuitarDiagram(reference.instrument):false;
  const conflictingStrings=new Set(positions.map(item=>item.position!.string)).size!==new Set(positions.map(item=>item.event.pitch)).size;
  const sectionIndex=sectionsAt(lesson.section_set.sections,time);
  const span = reference ? currentSpan(reference, time) : null;
  const sections = lesson.section_set.sections;

  return <section className="music-home music-guide">
    <button className="back-link" onClick={onBack}>Back</button>
    <header className="music-home-head">
      <p className="eyebrow"><Music2 size={14} aria-hidden="true"/> {label(lesson).toUpperCase()} LESSON</p>
      <h1>{lesson.title}</h1>
      <p className="subtle">
        Reviewed reference with {reference ? reference.events.length : 0} notes
        {sections.length === 1 ? ' in 1 teaching section' : ` across ${sections.length} teaching sections`}.
        Play the instructor video with the guide; this version has no scoring.
      </p>
    </header>
    {error && <p className="inline-notice error-notice" role="alert">{error}<button onClick={()=>setRetry(value=>value+1)}>Retry reference</button></p>}
    {!reference && !error && <p role="status">Loading the reviewed reference…</p>}
    {reference && <>
      <div className="music-player">
        <div className="music-video">
          {source
            ? <video ref={video} src={source} controls={!practiceActive} playsInline preload="metadata"
                onTimeUpdate={event => { clock.current = event.currentTarget.currentTime; setTime(event.currentTarget.currentTime); }}
                onPlay={() => {if(practiceRef.current)stopPractice(false);setPlaying(true);}} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                onError={() => {setVideoFailed(true);setPlaying(false);}}/>
            : <div className="music-no-video">The original video is unavailable. The guide can still play on its own.</div>}
        </div>
        <div className="music-guide-panel">
          <div className="music-transport">
            <button className="primary" aria-label={playing ? 'Pause guide' : 'Play guide'} onClick={() => void toggle()}>
              {playing ? <Pause size={16} aria-hidden="true"/> : <Play size={16} aria-hidden="true"/>}
              {playing ? 'Pause' : 'Play'}
            </button>
            <input aria-label="Lesson position" type="range" min={0} max={reference.duration} step={0.01}
              value={Math.min(time, reference.duration)} onChange={event => seek(Number(event.target.value))}/>
            <span className="music-time">{timeLabel(time)} / {timeLabel(reference.duration)}</span>
          </div>
          <p className="music-now" role="status">
            {active.length ? active.map(event => pitchName(event.pitch)).join(' · ') : 'No note sounding'}
            {span && <span className="music-span"> · {span.start.toFixed(1)}–{span.end.toFixed(1)}s</span>}
          </p>
          {lesson.subject === 'piano' && geometry
            ? <div className="piano" role="img" aria-label={`Piano guide with ${geometry.whiteKeys.length} white keys`}
                style={{'--white-count': geometry.width} as CSSProperties}>
                {geometry.whiteKeys.map(key => <span key={key.pitch}
                  className={`piano-white${activePitches.has(key.pitch) ? ' is-active' : ''}`}
                  style={{left: `${key.whiteIndex * 100 / geometry.width}%`, width: `${100 / geometry.width}%`}}>
                  {key.pitch % 12 === 0 && <small>{pitchName(key.pitch)}</small>}
                </span>)}
                {geometry.blackKeys.map(key => <span key={key.pitch}
                  className={`piano-black${activePitches.has(key.pitch) ? ' is-active' : ''}`}
                  style={{left: `${(key.left-.31) * 100 / geometry.width}%`,
                    width: `${62 / geometry.width}%`}}/>)}
              </div>
            : <div className="fretboard" role="img" aria-label="Guitar guide, standard tuning">
                {GUITAR_STRING_LABELS.map((stringLabel, row) => <div className="fret-row" key={stringLabel}>
                  <span className="fret-label">{stringLabel}</span>
                  {Array.from({length: 13}, (_, fret) => {
                    const hit = guitarSupported&&!conflictingStrings&&positions.find(item => item.position!.string === row + 1 && item.position!.fret === fret);
                    return <span key={fret} className={`fret-cell${hit ? ' is-active' : ''}`}>
                      {hit ? pitchName(hit.event.pitch) : fret === 0 ? '0' : String(fret)}
                    </span>;
                  })}
                </div>)}
              </div>}
          {lesson.subject==='guitar'&&<p className="small muted">{!guitarSupported?'Fretboard positions are unavailable for this tuning or capo. The reviewed pitches and video remain available.':conflictingStrings?'This passage needs a reviewed fingering; no conflicting string positions are drawn.':'Markers show one possible position, not confirmed instructor fingering.'}</p>}
          <ol className="music-sections" aria-label="Teaching sections">
            {sections.map(section => <li key={section.id}>
              <button className="secondary" aria-current={sectionIndex===sections.indexOf(section) ? 'step' : undefined}
                aria-label={`Seek to section ${section.label}`} onClick={() => seek(section.start)}>
                {section.label}<small>{section.start.toFixed(1)}–{section.end.toFixed(1)}s</small>
              </button>
            </li>)}
          </ol>
          {practice===null?<div className="practice-setup" role="group" aria-label="Timed practice">
            <label>Practice section<select aria-label="Practice section" value={practiceSection} onChange={event=>setPracticeSection(event.target.value)}><option value="all">Whole lesson</option>{sections.map(section=><option key={section.id} value={section.id}>{section.label}</option>)}</select></label>
            <p className="small muted">Silent guide practice: use your instrument’s sound. Count-in is visual at 120 beats per minute.</p>
            <label>Count-in<select aria-label="Count-in" value={countIn} onChange={event=>setCountIn(Number(event.target.value))}><option value={0}>Off</option><option value={2}>2 beats</option><option value={4}>4 beats</option></select></label>
            <label>Repeats<select aria-label="Repeats" value={repeats} onChange={event=>setRepeats(Number(event.target.value))}>{[1,2,3,5].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
            <label>Speed<select aria-label="Practice speed" value={speed} onChange={event=>setSpeed(Number(event.target.value) as PracticeSpeed)}>{PRACTICE_SPEEDS.map(value=><option key={value} value={value}>{value}×</option>)}</select></label>
            <button className="primary" disabled={Boolean(calibration)} onClick={beginPractice}>Start practice</button>
          </div>:<section className="music-practice" aria-label="Timed practice" role="status">
            {practice.phase==='count-in'&&<div className="practice-count"><strong>{practice.beat}</strong><span>Get ready</span></div>}
            <p className="practice-status">{practiceLabel(practice,practiceOptions??{sectionId:'all',start:0,end:reference.duration,repeats,countInBeats:countIn,speed})}
              {practice.phase==='playing'&&practiceOptions?<span className="music-time"> · {practiceSourceTime(practice,practiceOptions).toFixed(1)}s</span>:null}</p>
            {practice.phase==='done'
              ? <><p><strong>Practice complete</strong> · {keyboardConnected?`${captured} MIDI ${captured===1?'attack':'attacks'} counted locally`:'No keyboard input was measured'}. This run is unscored.{eligibility.eligible?' Local feedback appears below.':' This lesson stays ungraded.'}</p><div className="inline-actions"><button className="secondary" onClick={beginPractice}>Practice again</button><button className="back-link" onClick={()=>stopPractice()}>Close practice</button></div></>
              : <button className="secondary" onClick={()=>stopPractice()}>Stop practice</button>}
          </section>}
        </div>
      </div>
      {midiSetupEnabled&&lesson.subject==='piano'&&lesson.assessment.assessment==='notes'&&<section className="music-home-panel input-delay" aria-label="Timing alignment">
        <h2>Timing alignment · approximate</h2>
        {latency!==null?<p role="status">Estimated personal alignment: {latency} ms. <button className="back-link" onClick={()=>setLatency(null)}>Measure again</button></p>:<button className="secondary" disabled={!keyboardConnected||Boolean(calibration)||practiceActive} onClick={startCalibration}>Estimate timing alignment</button>}
        {calibration?<div className="calibration-pulse" role="status"><strong>{calibration.pulse}</strong><span>Play one note with each pulse</span><small>{calibration.samples} taps measured</small></div>:<p className="small muted">Play one note with each of eight visual pulses. This estimates your alignment, including reaction time; it does not measure hardware latency.</p>}
        {feedbackNotice&&<p className="small muted" role="status">{feedbackNotice}</p>}
      </section>}
      {feedback.length>0&&<section className="music-feedback" aria-label="Practice feedback">
        <h2>Local feedback · unscored</h2>
        {feedback.map((run,index)=><article className="feedback-run" key={`${run.run}-${index}`}>
          <h3>Run {run.run+1}</h3>
          {run.status==='invalid'?<p role="alert">This run could not be analysed: {run.reason}</p>:<p>{run.matched} matched · {run.missing} missing · {run.extra} extra · {run.assessed} of {run.total} notes assessed ({Math.round(run.coverage*100)}% coverage){run.unassessed?` · ${run.unassessed} unassessed`:''}</p>}
          {run.status==='complete'&&<ul>{run.notes.map((note,noteIndex)=><li key={noteIndex} className={`feedback-note ${note.status}`}>{note.status==='matched'?`${note.name} ${note.timing}${note.errorSeconds!==null?` (${Math.round(note.errorSeconds*1000)} ms)`:''}`:note.status==='missing'?`Missing ${note.name}`:`Extra ${note.name}`}</li>)}</ul>}
        </article>)}
        {feedback.some(run=>!run.latencyMeasured)&&<p className="small muted">No timing alignment estimate was made; timing feedback is approximate.</p>}
        <p className="small muted">Timing remains approximate, including after visual alignment. Feedback is local and unscored. Nothing is saved or sent.</p>
      </section>}
      {midiSetupEnabled&&lesson.subject==='piano'&&<MidiKeyboardCheck key={lesson.revision_id} onAttack={handleAttack} onInputChange={id=>{setKeyboardConnected(Boolean(id));cancelCalibration();setLatency(null);if(practiceRef.current)stopPractice();}}/>}
      <div className="music-home-grid">
        <article className="music-home-panel">
          <h2>Reference</h2>
          <dl>
            <div><dt>Instrument</dt><dd>{label(lesson)}</dd></div>
            <div><dt>Duration</dt><dd>{timeLabel(reference.duration)}</dd></div>
            <div><dt>Notes</dt><dd>{reference.events.length}{reference.events.some(event => event.optional) ? ' · optional notes marked' : ''}</dd></div>
            <div><dt>Assessment</dt><dd>{lesson.assessment.assessment === 'none' ? 'None' : lesson.assessment.assessment}</dd></div>
            {lesson.instrument.capo ? <div><dt>Capo</dt><dd>{lesson.instrument.capo}</dd></div> : null}
            {lesson.instrument.tuning ? <div><dt>Tuning</dt><dd>{lesson.instrument.tuning}</dd></div> : null}
          </dl>
        </article>
        <article className="music-home-panel">
          <h2>How the guide works</h2>
          <p className="subtle">Notes light up at their reviewed start time and stay lit until their reviewed length ends.
            Notes without a held length flash briefly. Optional notes are drawn like other notes; the guide does not grade your playing.</p>
          <p className="small muted">{midiSetupEnabled&&lesson.subject==='piano'?'No camera or microphone is used. MIDI access is requested only when you connect a keyboard.':'No camera, microphone or MIDI access has been requested.'}</p>
        </article>
      </div>
    </>}
  </section>;
}

export default MusicLessonHome;

function sectionsAt(sections:MusicLessonManifest['section_set']['sections'],time:number):number{
 const index=sections.findIndex(section=>time>=section.start&&time<section.end);return index>=0?index:time>=sections[sections.length-1].end?sections.length-1:-1;
}
