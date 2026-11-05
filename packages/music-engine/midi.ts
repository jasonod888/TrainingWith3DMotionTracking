/** MIDI input state only. No browser permissions, clocks, scores, audio or persistence. */
export type MidiSnapshot={pressed:number[];sounding:number[];attacks:number;pedal:boolean};
export class MidiNotes{
 private held=new Set<string>();private sustained=new Set<string>();private pedals=new Set<number>();private attacks=0;
 reset():MidiSnapshot{this.held.clear();this.sustained.clear();this.pedals.clear();this.attacks=0;return this.snapshot();}
 snapshot():MidiSnapshot{
  const pitches=(keys:Set<string>)=>[...new Set([...keys].map(key=>Number(key.split(':')[1])))].sort((a,b)=>a-b);
  return {pressed:pitches(this.held),sounding:pitches(new Set([...this.held,...this.sustained])),attacks:this.attacks,pedal:this.pedals.size>0};
 }
 receive(bytes:ArrayLike<number>):MidiSnapshot{
  if(bytes.length!==3)return this.snapshot();
  const [status,a,b]=Array.from(bytes);
  if(bytes.length!==3||![status,a,b].every(Number.isInteger)||status<128||status>239||a<0||a>127||b<0||b>127)return this.snapshot();
  const channel=status&15,type=status&240,key=`${channel}:${a}`;
  if(type===144&&b>0){this.held.add(key);this.sustained.delete(key);this.attacks++;}
  else if(type===128||type===144&&b===0){
   if(this.held.delete(key)&&this.pedals.has(channel))this.sustained.add(key);
  }else if(type===176&&a===64){
   if(b>=64)this.pedals.add(channel);
   else{this.pedals.delete(channel);for(const note of this.sustained)if(note.startsWith(channel+':'))this.sustained.delete(note);}
  }else if(type===176&&(a===120||a===123)){
   for(const notes of [this.held,this.sustained])for(const note of notes)if(note.startsWith(channel+':'))notes.delete(note);
   this.pedals.delete(channel);
  }
  return this.snapshot();
 }
}
