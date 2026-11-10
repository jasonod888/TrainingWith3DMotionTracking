import {memo,useMemo} from 'react';
import {ControlledPiano} from 'react-piano';
import 'react-piano/dist/styles.css';
import './instrument-guide.css';
const noop=()=>{};
export default memo(function PianoGuide({low,high,pitches,noteLabel}:{low:number;high:number;pitches:number[];noteLabel:(pitch:number)=>string}){
 const notes=useMemo(()=>pitches.filter(pitch=>pitch>=low&&pitch<=high),[pitches,low,high]);
 return <div className="library-guide-scroll" role="img" aria-label={`Piano guide, ${noteLabel(low)} to ${noteLabel(high)}`} data-renderer="piano-library" data-active-pitches={notes.join(',')}>
  <div className="library-piano" aria-hidden="true" style={{minWidth:Math.max(300,(high-low+1)*13)}}>
   <ControlledPiano noteRange={{first:low,last:high}} activeNotes={notes} playNote={noop} stopNote={noop}
    onPlayNoteInput={noop} onStopNoteInput={noop} keyboardShortcuts={[]} renderNoteLabel={({midiNumber})=>midiNumber%12===0?noteLabel(midiNumber):null}/>
  </div>
 </div>;
},(before,after)=>before.low===after.low&&before.high===after.high&&before.noteLabel===after.noteLabel&&before.pitches.join(',')===after.pitches.join(','));
