import {test, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/preference.html',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window as unknown as Window & typeof globalThis,document:dom.window.document,
  HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const {render, fireEvent, cleanup}=await import('@testing-library/react');
const {useFeedbackPreference}=await import('../src/feedback-preference.ts');
after(()=>{cleanup();dom.window.close();});
beforeEach(()=>{window.localStorage.clear();});

function Preference({lessonId,apiRef}:{lessonId:string;apiRef:{current:{value:boolean;set:(value:boolean)=>void}|null}}){
  const [value,set]=useFeedbackPreference(lessonId);
  apiRef.current={value,set};
  return <button type="button" aria-pressed={value} onClick={()=>set(!value)}>{value?'On':'Off'}</button>;
}

test('feedback defaults On and an explicit Off persists per lesson',()=>{
  const first:{current:{value:boolean;set:(value:boolean)=>void}|null}={current:null};
  const view=render(<Preference lessonId="piano-1" apiRef={first}/>);
  assert.equal(first.current!.value,true);
  fireEvent.click(view.getByRole('button'));
  assert.equal(first.current!.value,false);
  assert.equal(window.localStorage.getItem('form.feedback.enabled.piano-1'),'false');
  view.unmount();
  const again:{current:{value:boolean;set:(value:boolean)=>void}|null}={current:null};
  const remount=render(<Preference lessonId="piano-1" apiRef={again}/>);
  assert.equal(again.current!.value,false);
  remount.unmount();
});

test('a different lesson still defaults On and explicit On is preserved',()=>{
  window.localStorage.setItem('form.feedback.enabled.body-1','false');
  const body:{current:{value:boolean;set:(value:boolean)=>void}|null}={current:null};
  const view=render(<Preference lessonId="body-1" apiRef={body}/>);
  assert.equal(body.current!.value,false);
  fireEvent.click(view.getByRole('button'));
  assert.equal(window.localStorage.getItem('form.feedback.enabled.body-1'),'true');
  view.unmount();
  const other:{current:{value:boolean;set:(value:boolean)=>void}|null}={current:null};
  const second=render(<Preference lessonId="guitar-1" apiRef={other}/>);
  assert.equal(other.current!.value,true);
  second.unmount();
});
