/** Read-only, service-free Phase 4 follow-up probes for bc7e98c. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseMusicDraftView} from '../../packages/lesson-schema/parse.ts';

async function main() {
  const require = createRequire(resolve('apps/web/package.json'));
  const React = require('react');
  const {JSDOM} = require('jsdom');
  const dom = new JSDOM('<html><body></body></html>', {url: 'http://localhost/workspace-harness.html?id=fixture', pretendToBeVisual: true});
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, location: dom.window.location,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}});
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true});
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', {get: () => 600, configurable: true});
  const paused = new WeakMap<object, boolean>();
  const proto = dom.window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'paused', {get() {return paused.get(this) ?? true;}, configurable: true});
  proto.pause = function() {paused.set(this, true); this.dispatchEvent(new dom.window.Event('pause'));};
  proto.play = function() {paused.set(this, false); this.dispatchEvent(new dom.window.Event('play')); return Promise.resolve();};
  const {render, fireEvent, cleanup, waitFor, act} = require('@testing-library/react');
  const {NotationAudio} = await import('../../apps/web/src/music/notation/notation-audio.ts');
  let stops = 0;
  NotationAudio.prototype.play = () => {};
  NotationAudio.prototype.stop = () => {stops++;};
  NotationAudio.prototype.dispose = () => {};
  const {PianoWorkspaceHarness} = await import('../../apps/web/src/music/workspace/PianoWorkspaceHarness.tsx');
  const fixture = JSON.parse(readFileSync('docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json', 'utf8'));
  Object.assign(fixture, {draft_id:'fixture', lesson_id:'fixture', title:'Reviewer audio fixture', status:'draft',
    source_video:{key:'lessons/fixture/video.mp4', mime:'video/mp4', bytes:3, sha256:'0'.repeat(64)}});
  assert.equal(parseMusicDraftView(fixture).ok, true, 'fixture must pass the real parser');
  let failures = 0;
  const check = (name: string, body: () => void) => {
    try {body(); console.log(`PASS: ${name}`);} catch(e) {failures++; console.log(`FAIL: ${name}: ${(e as Error).message}`);}
  };
  globalThis.fetch = async () => new Response(JSON.stringify(fixture), {headers:{'Content-Type':'application/json'}});
  let view = render(React.createElement(PianoWorkspaceHarness));
  await waitFor(() => assert.ok(view.queryByRole('button', {name:'Piano', exact:true})));
  fireEvent.pointerDown(view.container.querySelector('.ws-roll-note')!);
  fireEvent.click(view.getByRole('button', {name:'Audition', exact:true}));
  const before = stops;
  await act(async () => {await view.container.querySelector('video')!.play();});
  check('Original-only playback stops audition without a Piano preview', () => assert.ok(stops > before, `stop calls stayed at ${stops}`));
  cleanup();

  fixture.piano_preview = {key:'lessons/fixture/preview.wav', mime:'audio/wav', bytes:3, sha256:'0'.repeat(64)};
  fixture.preview_identity = '1'.repeat(64);
  assert.equal(parseMusicDraftView(fixture).ok, true);
  let previewFetches = 0;
  globalThis.fetch = async (input: any) => {
    if (String(input).includes('preview.wav')) {previewFetches++; return new Response(new Uint8Array([1,2,3]));}
    return new Response(JSON.stringify(fixture), {headers:{'Content-Type':'application/json'}});
  };
  view = render(React.createElement(PianoWorkspaceHarness));
  await waitFor(() => assert.ok(view.queryByRole('button', {name:'Piano', exact:true})));
  check('Piano remains unavailable for an unverified/mismatched asset', () => {
    assert.equal((view.getByRole('button', {name:'Piano', exact:true}) as HTMLButtonElement).disabled, true,
      `Piano enabled with ${previewFetches} verification fetches; audio src=${view.container.querySelector('audio')?.getAttribute('src')}`);
  });
  cleanup();
  console.log(`${failures} follow-up check(s) failed.`);
  process.exitCode = failures ? 1 : 0;
}
main().catch(e => {console.error(e); process.exitCode = 1;});
