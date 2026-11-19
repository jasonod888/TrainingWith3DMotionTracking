import {Suspense, lazy} from 'react';
import type {ComponentProps} from 'react';
import type {LessonDocument} from '../../../packages/lesson-schema/index';
import {LessonWorkspace} from './LessonWorkspace';
import {effectiveFeedbackEnabled} from './music/music-feedback';
import type {LessonContext} from './app/lesson-context';

/**
 * The only dispatch boundary in the app.
 *
 * It sits before `LessonWorkspace`, so a music lesson never constructs a body
 * `Playback`, never starts the progress saver and never mounts the body practice
 * controller. Body components keep receiving their unchanged body-shaped contract;
 * they never narrow a union.
 *
 * Music Practice is a separate lazy entry (`acts/music/PracticeEntry`) that imports
 * only `PianoPracticeWorkspace`. Opening practice therefore cannot pull the review
 * editor (`PianoWorkspaceHarness`) into the graph; the editor route loads it itself.
 */
const MusicLessonHome = lazy(() => import('./music/MusicLessonHome'));
const MusicPracticeEntry = lazy(() => import('./acts/music/PracticeEntry')
  .then(module => ({default: module.MusicPracticeEntry})));
const DrawingPracticeEntry = lazy(() => import('./acts/drawing/DrawingPracticeEntry')
  .then(module => ({default: module.DrawingPracticeEntry})));

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

export function LessonExperienceHost({document,context=null,pianoLibrary=false,guitarLibrary=false,challengeEnabled=false,challengeHistoryEnabled=false,audioAssessmentEnabled=false, ...body}: {document: LessonDocument;context?: LessonContext|null;challengeEnabled?:boolean;challengeHistoryEnabled?:boolean;audioAssessmentEnabled?:boolean} & BodyProps & LibraryGuideProps) {
  if (document.kind === 'music') {
    // Piano and guitar share one practice engine; the validated document subject
    // selects the instrument-specific surfaces inside it.
    if (document.value.subject === 'piano' || document.value.subject === 'guitar') {
      const legacyGate = challengeEnabled && effectiveFeedbackEnabled(document.value)
        && document.value.subject === 'piano'
        && document.value.assessment.assessment === 'notes'
        && (document.value.assessment.input_modes.includes('midi')
          || document.value.assessment.input_modes.includes('microphone'));
      // A loaded context already resolved deployment, creator and Act support.
      const canChallenge = context ? context.capabilities.canChallenge.available : legacyGate;
      return <Suspense fallback={<MusicFallback onBack={body.onBack}/>}>
        <MusicPracticeEntry context={context} lessonId={document.value.lesson_id}
          lessonTitle={document.value.title}
          challengeMode={body.initialMode==='compete'&&canChallenge}
          challengeAvailable={canChallenge}
          challengeHistoryEnabled={challengeHistoryEnabled}
          audioAssessmentEnabled={audioAssessmentEnabled}
          onBack={body.onBack} onModeChange={body.onModeChange}/>
      </Suspense>;
    }
    return <Suspense fallback={<MusicFallback onBack={body.onBack}/>}>
      <MusicLessonHome lesson={document.value} onBack={body.onBack} onModeChange={body.onModeChange} pianoLibrary={pianoLibrary} guitarLibrary={guitarLibrary}/>
    </Suspense>;
  }
  if (document.kind === 'drawing') {
    return <Suspense fallback={<section className="music-home" aria-busy="true">
      <button className="back-link" onClick={body.onBack}>Back</button>
      <p className="subtle" role="status">Opening your drawing lesson…</p>
    </section>}>
      <DrawingPracticeEntry context={context} document={document.value} onBack={body.onBack}/>
    </Suspense>;
  }
  if (document.kind === 'summary') return <UnsupportedScreen onBack={body.onBack}/>;
  return <LessonWorkspace {...body} context={context} accountId={context?.accountScope ?? null} lesson={document.value}/>;
}
