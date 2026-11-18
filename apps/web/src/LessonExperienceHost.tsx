import {Suspense, lazy} from 'react';
import type {ComponentProps} from 'react';
import type {LessonDocument, MusicLessonManifest} from '../../../packages/lesson-schema/index';
import {LessonWorkspace} from './LessonWorkspace';

/**
 * The only dispatch boundary in the app.
 *
 * It sits before `LessonWorkspace`, so a music lesson never constructs a body
 * `Playback`, never starts the progress saver and never mounts the body practice
 * controller. Body components keep receiving their unchanged body-shaped contract;
 * they never narrow a union.
 */
const MusicLessonHome = lazy(() => import('./music/MusicLessonHome'));
const PianoWorkspaceHarness = lazy(() => import('./music/workspace/PianoWorkspaceHarness')
  .then(module => ({default: module.PianoWorkspaceHarness})));

type BodyProps = Omit<ComponentProps<typeof LessonWorkspace>, 'lesson'>;
type LibraryGuideProps={pianoLibrary?:boolean;guitarLibrary?:boolean};

function MusicFallback({onBack}: {onBack: () => void}) {
  return <section className="music-home" aria-busy="true">
    <button className="back-link" onClick={onBack}>Back</button>
    <p className="subtle" role="status">Opening your music lesson…</p>
  </section>;
}

function UnsupportedScreen({onBack}: {onBack: () => void}) {
  return <section className="music-home">
    <button className="back-link" onClick={onBack}>Back</button>
    <h1>This lesson can’t open here.</h1>
    <p className="subtle">Open it from your library, or refresh to update the app.</p>
  </section>;
}

export function LessonExperienceHost({document,pianoLibrary=false,guitarLibrary=false, ...body}: {document: LessonDocument} & BodyProps & LibraryGuideProps) {
  if (document.kind === 'music') {
    if (document.value.subject === 'piano') {
      return <Suspense fallback={<MusicFallback onBack={body.onBack}/>}>
        <PianoWorkspaceHarness lessonId={document.value.lesson_id} lessonTitle={document.value.title} embedded mode="practice" onBack={body.onBack}/>
      </Suspense>;
    }
    return <Suspense fallback={<MusicFallback onBack={body.onBack}/>}>
      <MusicLessonHome lesson={document.value} onBack={body.onBack} pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary}/>
    </Suspense>;
  }
  if (document.kind === 'summary') return <UnsupportedScreen onBack={body.onBack}/>;
  return <LessonWorkspace {...body} lesson={document.value}/>;
}

/** Preview and practice destinations that a music lesson can occupy. */
export function MusicLessonScreen({lesson, onBack,midiSetupEnabled=false,musicHistoryEnabled=false,pianoLibrary=false,guitarLibrary=false}: {lesson: MusicLessonManifest; onBack: () => void;midiSetupEnabled?:boolean;musicHistoryEnabled?:boolean;pianoLibrary?:boolean;guitarLibrary?:boolean}) {
  return <Suspense fallback={<MusicFallback onBack={onBack}/>}>
    <MusicLessonHome pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary} lesson={lesson} onBack={onBack} midiSetupEnabled={midiSetupEnabled} musicHistoryEnabled={musicHistoryEnabled}/>
  </Suspense>;
}
