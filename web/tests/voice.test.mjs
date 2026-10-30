import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand,VoiceCommands} from '../dist/voice.js';
class Recognition{
  static instances=[];
  constructor(){Recognition.instances.push(this);}
  start(){this.onstart?.();}
  abort(){this.aborted=true;this.onend?.();}
  result(text,final=true){const r=[{transcript:text,confidence:.95}];r.isFinal=final;this.onresult({resultIndex:0,results:[r]});}
}
function setup(){
  const commands=[],states=[],errors=[],scheduled=[];let now=1000;
  const voice=new VoiceCommands({Recognition,onCommand:c=>commands.push(c),onState:s=>states.push(s),onError:e=>errors.push(e),now:()=>now,schedule:fn=>{scheduled.push(fn);return scheduled.length;},cancel:()=>{}});
  return {voice,commands,states,errors,scheduled,advance:n=>now+=n};
}
test('only the four explicit spoken commands are accepted',()=>{
  assert.equal(parseCommand('Next!'),'next');assert.equal(parseCommand(' again. '),'again');
  assert.equal(parseCommand('my next move'),null);assert.equal(parseCommand('background'),null);
});
test('voice never starts until enabled, ignores interim results and debounces echoes',()=>{
  const t=setup();assert.equal(t.voice.enabled,false);t.voice.start();const r=t.voice.recognition;
  r.result('next',false);assert.deepEqual(t.commands,[]);r.result('next');r.result('next');assert.deepEqual(t.commands,['next']);
  t.advance(1000);r.result('next');r.result('pause');assert.deepEqual(t.commands,['next','next','pause']);t.voice.stop();r.result('again');assert.equal(t.commands.length,3);
});
test('permission denial turns off recognition and never restarts the microphone',()=>{
  const t=setup();t.voice.start();const r=t.voice.recognition;r.onerror({error:'not-allowed'});
  assert.equal(t.voice.enabled,false);assert.equal(r.aborted,true);assert.ok(t.errors[0].includes('permission'));assert.equal(t.scheduled.length,0);
});
test('stopping voice cancels pending reconnection and ignores late recognition results',()=>{
  const t=setup();t.voice.start();const r=t.voice.recognition;r.onend();assert.equal(t.scheduled.length,1);t.voice.stop();t.scheduled[0]();r.result('next');assert.equal(t.voice.recognition,null);assert.deepEqual(t.commands,[]);
});
test('unsupported browsers fail clearly without affecting button controls',()=>{
  const errors=[];const v=new VoiceCommands({Recognition:null,onCommand:()=>{},onState:()=>{},onError:e=>errors.push(e)});v.start();assert.equal(v.enabled,false);assert.ok(errors[0].includes('buttons'));
});
