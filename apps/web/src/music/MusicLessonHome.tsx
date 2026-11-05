import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Music2, Pause, Play} from 'lucide-react';
import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import {assetUrl} from '../api';
import {
  activeEvents, currentSpan, GUITAR_STRING_LABELS, guitarPosition, parseMusicReference,
  pianoGeometry, pitchName, type MusicReference,
} from './music-reference';
import './music.css';

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
export function MusicLessonHome({lesson, onBack}: {lesson: MusicLessonManifest; onBack: () => void}) {
  const [reference, setReference] = useState<MusicReference | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const clock = useRef(0);
  const source = lesson.source_video ? assetUrl(lesson.source_video.key) : '';

  useEffect(() => {
    let stopped = false;
    void fetch(assetUrl(lesson.reference.key), {headers: {'Accept': 'application/json'}})
      .then(response => {
        if (!response.ok) throw new Error('The reviewed reference could not be loaded.');
        return response.json();
      })
      .then(value => { if (!stopped) setReference(parseMusicReference(value)); })
      .catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : 'The reviewed reference could not be loaded.'); });
    return () => { stopped = true; };
  }, [lesson.reference.key]);

  useEffect(() => {
    if (source || !playing || !reference) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(reference.duration, clock.current + (now - last) / 1000);
      last = now;
      clock.current = next;
      setTime(next);
      if (next >= reference.duration) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source, reference]);

  const seek = (value: number) => {
    const next = Math.max(0, Math.min(reference?.duration ?? lesson.duration, value));
    clock.current = next;
    setTime(next);
    if (video.current) video.current.currentTime = next;
  };

  const toggle = async () => {
    setError('');
    if (!video.current) { setPlaying(value => !value); return; }
    if (video.current.paused) {
      try { await video.current.play(); } catch { setError('Playback could not start. Press play again.'); }
    } else {
      video.current.pause();
    }
  };

  const active = useMemo(() => reference ? activeEvents(reference, time) : [], [reference, time]);
  const activePitches = useMemo(() => new Set(active.map(event => event.pitch)), [active]);
  const geometry = useMemo(() => reference ? pianoGeometry(reference.events) : null, [reference]);
  const positions = useMemo(() => active.map(event => ({event, position: guitarPosition(event.pitch)}))
    .filter(item => item.position), [active]);
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
    {error && <p className="inline-notice error-notice" role="alert">{error}</p>}
    {!reference && !error && <p role="status">Loading the reviewed reference…</p>}
    {reference && <>
      <div className="music-player">
        <div className="music-video">
          {source
            ? <video ref={video} src={source} controls playsInline preload="metadata"
                onTimeUpdate={event => { clock.current = event.currentTarget.currentTime; setTime(event.currentTarget.currentTime); }}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
                onError={() => setError('The instructor video could not be played. The guide is still available.')}/>
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
                  style={{left: `calc(${key.left * 100 / geometry.width}% - ${Math.min(1.2, 70 / geometry.width)}%)`,
                    width: `${Math.min(2.4, 140 / geometry.width)}%`}}/>)}
              </div>
            : <div className="fretboard" role="img" aria-label="Guitar guide, standard tuning">
                {GUITAR_STRING_LABELS.map((stringLabel, row) => <div className="fret-row" key={stringLabel}>
                  <span className="fret-label">{stringLabel}</span>
                  {Array.from({length: 13}, (_, fret) => {
                    const hit = positions.find(item => item.position!.string === row + 1 && item.position!.fret === fret);
                    return <span key={fret} className={`fret-cell${hit ? ' is-active' : ''}`}>
                      {hit ? pitchName(hit.event.pitch) : fret === 0 ? '0' : String(fret)}
                    </span>;
                  })}
                </div>)}
              </div>}
          <ol className="music-sections" aria-label="Teaching sections">
            {sections.map(section => <li key={section.id}>
              <button className="secondary" aria-current={span && span.start === section.start ? 'step' : undefined}
                aria-label={`Play section ${section.label}`} onClick={() => seek(section.start)}>
                {section.label}<small>{section.start.toFixed(1)}–{section.end.toFixed(1)}s</small>
              </button>
            </li>)}
          </ol>
        </div>
      </div>
      <div className="music-home-grid">
        <article className="music-home-panel">
          <h2>Reference</h2>
          <dl>
            <div><dt>Instrument</dt><dd>{label(lesson)}</dd></div>
            <div><dt>Duration</dt><dd>{timeLabel(reference.duration)}</dd></div>
            <div><dt>Notes</dt><dd>{reference.events.length}{reference.events.some(event => event.optional) ? ' · optional notes marked' : ''}</dd></div>
            <div><dt>Assessment</dt><dd>{lesson.assessment.assessment === 'none' ? 'None' : lesson.assessment.assessment}</dd></div>
            {lesson.instrument.capo ? <div><dt>Capo</dt><dd>{lesson.instrument.capo}</dd></div> : null}
          </dl>
        </article>
        <article className="music-home-panel">
          <h2>How the guide works</h2>
          <p className="subtle">Notes light up at their reviewed start time and stay lit until their reviewed length ends.
            Optional notes are drawn like other notes; the guide does not grade your playing.</p>
          <p className="small muted">No camera, microphone or MIDI access has been requested.</p>
        </article>
      </div>
    </>}
  </section>;
}

export default MusicLessonHome;
