import type {MusicLessonManifest} from '../../../../packages/lesson-schema/index';
import './music.css';

const label = (lesson: MusicLessonManifest) => lesson.subject === 'piano' ? 'Piano' : 'Guitar';

/**
 * The music destination for the first milestone.
 *
 * It renders an approved, already-validated music manifest and nothing else. In
 * particular it requests no camera, microphone or MIDI access: permission prompts
 * only ever follow an explicit input choice, which this build does not offer yet.
 */
export function MusicLessonHome({lesson, onBack}: {lesson: MusicLessonManifest; onBack: () => void}) {
  const sections = lesson.section_set.sections;
  return <section className="music-home">
    <button className="back-link" onClick={onBack}>Back</button>
    <header className="music-home-head">
      <p className="eyebrow">{label(lesson).toUpperCase()} LESSON</p>
      <h1>{lesson.title}</h1>
      <p className="subtle">
        A reviewed reference with {sections.length === 1 ? '1 teaching section' : `${sections.length} teaching sections`}.
        This preview shows lesson details and teaching sections. Instructor playback and the animated guide are not available yet.
      </p>
    </header>
    <div className="music-home-grid">
      <article className="music-home-panel">
        <h2>Reference</h2>
        <dl>
          <div><dt>Instrument</dt><dd>{label(lesson)}</dd></div>
          <div><dt>Duration</dt><dd>{Math.floor(lesson.duration / 60)}:{Math.floor(lesson.duration % 60).toString().padStart(2, '0')}</dd></div>
          <div><dt>Reference assessment</dt><dd>{lesson.assessment.assessment === 'none' ? 'None' : lesson.assessment.assessment}</dd></div>
          {lesson.instrument.capo ? <div><dt>Capo</dt><dd>{lesson.instrument.capo}</dd></div> : null}
        </dl>
      </article>
      <article className="music-home-panel">
        <h2>Sections</h2>
        <ol className="music-home-sections">
          {sections.map(section => <li key={section.id}><span>{section.label}</span><span>{section.start.toFixed(1)}–{section.end.toFixed(1)}s</span></li>)}
        </ol>
      </article>
    </div>
    <p className="inline-notice" role="status">
      {lesson.subject === 'piano'
        ? 'Live piano feedback is not enabled in this version. You can still browse this lesson and its sections.'
        : 'Live guitar feedback is not enabled in this version. You can still browse this lesson and its sections.'}
      {' '}No camera, microphone or MIDI access has been requested.
    </p>
  </section>;
}

export default MusicLessonHome;
