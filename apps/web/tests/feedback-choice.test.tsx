import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/feedback.html',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window as unknown as Window & typeof globalThis,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
if(!dom.window.matchMedia)dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
const {render, fireEvent, cleanup}=await import('@testing-library/react');
const {FeedbackChoice, setFeedbackChoice}=await import('../src/music/workspace/FeedbackChoice.tsx');
const {assessmentPolicyForSubject}=await import('../src/music/music-feedback.ts');
after(()=>{cleanup();dom.window.close();});

const legacyWatch={rubric_version:'music-watch-v1',assessment:'none' as const,input_modes:['none'] as ('midi'|'microphone'|'none')[],dimensions:[] as ('pitch'|'timing'|'release'|'coverage')[]};

test('legacy watch-only music is not projected to notes and cannot be overridden',()=>{
  const view=render(<FeedbackChoice subject="piano" assessment={legacyWatch} referenceReviewed inputSelected={false}
    inputMode="midi" microphoneAvailable={false} enabled lessonEnabled={false} active={false} onEnabledChange={()=>{}}/>);
  assert.ok(view.getByText('Feedback'));
  assert.equal(view.container.querySelector('[data-feedback-status]')?.getAttribute('data-feedback-status'),'lesson-off');
  assert.match(view.container.textContent??'',/Feedback not enabled for this lesson/i);
  assert.equal((view.getByRole('button',{name:'On'}) as HTMLButtonElement).disabled,true);
  assert.equal((view.getByRole('button',{name:'Off'}) as HTMLButtonElement).disabled,true);
  view.unmount();
});

test('an eligible reviewed piano lesson toggles Off and On explicitly',()=>{
  const values:boolean[]=[];
  const view=render(<FeedbackChoice subject="piano" assessment={assessmentPolicyForSubject('piano')} referenceReviewed inputSelected
    inputMode="midi" microphoneAvailable={false} enabled={false} lessonEnabled active={false} onEnabledChange={value=>values.push(value)}/>);
  assert.equal(view.getByRole('button',{name:'Off'}).getAttribute('aria-pressed'),'true');
  assert.match(view.container.textContent??'',/Off/);
  fireEvent.click(view.getByRole('button',{name:'On'}));
  assert.deepEqual(values,[true]);
  view.rerender(<FeedbackChoice subject="piano" assessment={assessmentPolicyForSubject('piano')} referenceReviewed inputSelected
    inputMode="midi" microphoneAvailable={false} enabled lessonEnabled active onEnabledChange={value=>values.push(value)}/>);
  assert.match(view.container.textContent??'',/On · feedback run active/i);
  fireEvent.click(view.getByRole('button',{name:'Off'}));
  assert.deepEqual(values,[true,false]);
  view.unmount();
});

test('Off cancels an active run; On records the preference even while setup is incomplete',()=>{
  const calls:{cancelled:number;enabled:boolean[]}={cancelled:0,enabled:[]};
  setFeedbackChoice(false,{eligible:true,cancel:()=>{calls.cancelled+=1;},setEnabled:value=>calls.enabled.push(value),creatorEnabled:true});
  assert.equal(calls.cancelled,1);
  assert.deepEqual(calls.enabled,[false]);
  setFeedbackChoice(true,{eligible:false,cancel:()=>{calls.cancelled+=1;},setEnabled:value=>calls.enabled.push(value),creatorEnabled:true});
  assert.equal(calls.cancelled,1);
  assert.deepEqual(calls.enabled,[false,true]);
});

test('a creator Off guard leaves the learner preference untouched',()=>{
  const calls:boolean[]=[];
  setFeedbackChoice(true,{eligible:true,cancel:()=>{},setEnabled:value=>calls.push(value),creatorEnabled:false});
  assert.deepEqual(calls,[]);
});

test('guitar has a reviewed note-feedback path and no watch-only rejection',()=>{
  const view=render(<FeedbackChoice subject="guitar" assessment={assessmentPolicyForSubject('guitar')} referenceReviewed inputSelected
    inputMode="midi" microphoneAvailable={false} enabled lessonEnabled active={false} onEnabledChange={()=>{}}/>);
  assert.equal((view.getByRole('button',{name:'On'}) as HTMLButtonElement).disabled,false);
  assert.doesNotMatch(view.container.textContent??'',/piano lessons only/i);
  assert.match(view.container.textContent??'',/On · ready/i);
  view.unmount();
});

test('unavailable microphone stays an availability reason, not a silent Off',()=>{
  const view=render(<FeedbackChoice subject="piano" assessment={assessmentPolicyForSubject('piano')} referenceReviewed
    inputSelected={false} inputMode="microphone" microphoneAvailable={false} enabled lessonEnabled active={false} onEnabledChange={()=>{}}/>);
  assert.equal(view.getByRole('button',{name:'On'}).getAttribute('aria-pressed'),'true');
  assert.match(view.container.textContent??'',/Enable microphone access/i);
  view.unmount();
});
