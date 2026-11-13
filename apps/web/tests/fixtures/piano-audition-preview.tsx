/** Browser-only regression fixture, not linked or bundled into the product. */
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DraftNotePreview} from '../../src/music/DraftNotePreview';

const NativeContext = window.AudioContext;
class ObservedContext extends NativeContext {
  constructor() {
    super();
    const analyser = this.createAnalyser(); analyser.fftSize = 2048;
    (window as any).__auditionTest = {context:this,analyser};
    const create = this.createGain.bind(this);
    let first = true;
    this.createGain = () => {
      const gain = create();
      if (first) {first = false; gain.connect(analyser);}
      return gain;
    };
  }
}
window.AudioContext = ObservedContext;
function Fixture() {
  const [events,setEvents] = useState([{id:'held-C4',onset:0,duration:6,pitch:60,velocity:.6}]);
  return <><button onClick={()=>setEvents(events.map(note=>({...note,duration:.3})))}>Change proposal</button>
    <DraftNotePreview events={events} duration={7}/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
