import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Playback} from '../../packages/learning-engine/playback';
import {PracticeSession} from '../../packages/learning-engine/practice-session';
const make=()=>new PracticeSession(new Playback([{id:'a',label:'A',start:0,end:2},{id:'b',label:'B',start:2,end:4}],4));
test('countdown never advances lesson and pause cancels queued start',()=>{const s=make();s.action('play');s.tick(2);assert.equal(s.player.state.time,0);s.pause();s.tick(10);assert.equal(s.phase,'paused');assert.equal(s.player.state.playing,false);});
test('range repeats exactly, rests and stops after requested count',()=>{const s=make();s.countdownSeconds=0;s.restSeconds=1;s.setRange(.5,1.5);s.loop=true;s.repetitions=2;const attempts:unknown[]=[];s.onAttempt=a=>attempts.push(a);s.action('resume');s.tick(2);assert.equal(s.phase,'rest');assert.equal(s.player.state.time,.5);s.tick(1);s.tick(2);assert.equal(s.phase,'paused');assert.equal(s.player.state.time,1.5);assert.equal(attempts.length,2);});
test('calibration and navigation cancel countdown; resume is idempotent',()=>{const s=make();s.countdownSeconds=0;s.action('resume');s.tick(.5);s.action('resume');assert.equal(s.player.state.time,.5);s.player.calibrating(true);s.tick(.1);assert.equal(s.phase,'paused');s.action('next');assert.equal(s.player.state.index,0);});
test('selecting a section clears a temporary range and never edits boundaries',()=>{const s=make();s.setRange(.2,.7);s.select(1);assert.equal(s.range,null);assert.equal(s.player.state.time,2);assert.equal(s.player.sections[0].end,2);assert.throws(()=>s.setRange(3,2));});
test('repeated remote start cannot restart a countdown and range scrubbing stays bounded',()=>{const s=make();s.action('resume');s.tick(1);s.action('resume');assert.equal(s.remaining,2);s.setRange(.5,1.5);s.seek(3);assert.equal(s.player.state.time,1.5);});

test('only the first practice start counts in; next, back, replay and resume are immediate',()=>{
 const s=make();let starts=0;s.onAttemptStart=()=>starts++;
 s.action('play');assert.equal(s.phase,'countdown');s.tick(3);
 assert.equal(starts,1);
 s.tick(2);assert.equal(s.phase,'paused');
 s.action('next');assert.equal(s.player.state.index,1);
 assert.equal(s.phase,'playing');assert.equal(s.remaining,0);
 s.tick(.25);assert.equal(s.player.state.time,2.25);
 for(const action of ['back','again','next'] as const){
  s.action(action);assert.equal(s.phase,'playing',action);assert.equal(s.remaining,0,action);
 }
 s.pause('settings');s.action('resume');assert.equal(s.phase,'playing');
 s.select(0);s.action('play');assert.equal(s.phase,'playing');
 assert.equal(s.countdownSeconds,3,'the preparation preference is unchanged');
});

test('navigation skips a pending count-in and explicit new-start countdowns remain available',()=>{
 const s=make();s.select(0);s.start();s.tick(1);s.action('next');
 assert.equal(s.phase,'playing');assert.equal(s.player.state.time,2);
 s.pause();s.start(5);assert.equal(s.phase,'countdown');assert.equal(s.remaining,5);
 s.tick(5);s.pause();s.start();assert.equal(s.phase,'playing');
});

test('record countdown cancellation clears intent for every interruption',()=>{
 for(const interrupt of ['cancel','settings','seek','section','background','exit']){
  const s=make();let recordNext=true,recordings=0;
  s.onPause=()=>{recordNext=false;};s.onAttemptStart=()=>{if(recordNext){recordings++;recordNext=false;}};
  s.action('play');s.tick(1);
  if(interrupt==='seek')s.seek(.2);else if(interrupt==='section')s.select(0);else s.pause(interrupt);
  s.action('play');s.tick(3);
  assert.equal(recordings,0,interrupt);
 }
});

test('a one-start countdown override applies without changing the preference', () => {
 const s = make();
 s.countdownSeconds = 3;
 s.start(5);
 assert.equal(s.phase, 'countdown');
 assert.equal(s.remaining, 5);
 assert.equal(s.countdownSeconds, 3, 'the persisted preference must not change');
 s.pause();
 s.start();
 assert.equal(s.remaining, 3, 'ordinary starts keep the configured count-in');
 s.pause();
 s.start(0);
 assert.equal(s.phase, 'playing', 'an explicit zero override starts immediately');
});

test('a duplicate start request cannot restart an owned countdown or attempt', () => {
 const s = make();
 s.countdownSeconds = 5;
 s.start(5);
 s.tick(2);
 assert.equal(s.remaining, 3);
 s.start(5);
 s.start();
 assert.equal(s.remaining, 3, 'a repeated start must not restart the countdown');
 s.tick(3);
 assert.equal(s.phase, 'playing');
 let starts = 0;
 s.onAttemptStart = () => { starts += 1; };
 s.start();
 assert.equal(s.phase, 'playing');
 assert.equal(starts, 0, 'a start while playing creates no attempt');
 s.action('play');
 assert.equal(s.phase, 'paused');
 s.start(0);
 assert.equal(starts, 1);
});
