/** Test-only entry exercising the real source-selection component. */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PianoModelComparison} from '../../src/music/PianoModelComparison';

const lesson = new URLSearchParams(location.search).get('lesson');
createRoot(document.getElementById('root')!).render(
 <PianoModelComparison comparisonId={null} linkedLessonId={lesson}
  onStarted={id=>{(window as any).__startedComparison=id;}} onBack={()=>{}}/>
);
