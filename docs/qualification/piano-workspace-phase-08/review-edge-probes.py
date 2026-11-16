"""Existing P8-R1/R3 scope: in-flight drag, supported keys, piano-range ledgers."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('phase8_edges',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
results=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000})
    context.route('**/api/**',m.World(m.LONG).route)
    page=context.new_page();m.open_route(page)
    render_results=page.evaluate('''async () => {
      const reactModule=await import('/node_modules/.vite/deps/react.js');
      const React=reactModule.default??reactModule;
      const clientModule=await import('/node_modules/.vite/deps/react-dom_client.js');
      const createRoot=clientModule.createRoot??clientModule.default?.createRoot;
      const music=await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
      const {FormattedScore}=await import('/src/music/workspace/FormattedScore.tsx');
      const host=document.createElement('div');host.style.cssText='position:absolute;left:-5000px;top:0';
      document.body.append(host);const root=createRoot(host);
      const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const keys=['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#',
        'Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m'];
      const keyRows=[];
      for(const key of keys){
        const doc=music.buildNotation([{id:'key-note',pitch:66,onset:0,duration:0.5,velocity:0.6,
          confidence:null,optional:false,string:null,fret:null}],{duration:2,bpm:120,key_signature:key});
        root.render(React.createElement(FormattedScore,{document:doc,title:key}));await settle();
        const systems=host.querySelectorAll('[data-formatted-system]').length;
        const expected=Math.abs(music.keySignature(key).fifths)*2*systems;
        const actual=host.querySelectorAll('.formatted-key').length;
        keyRows.push({key,expected,actual,passed:actual===expected});
      }
      const ledgerRows=[];
      for(const [id,pitch] of [['A0',21],['C8',108]]){
        const doc=music.buildNotation([{id,pitch,onset:0,duration:0.5,velocity:0.6,
          confidence:null,optional:false,string:null,fret:null}],{duration:2,bpm:120});
        root.render(React.createElement(FormattedScore,{document:doc,title:id}));await settle();
        const group=host.querySelector('[data-pitch="'+pitch+'"]');
        const expected=id==='A0'?6:9;
        const actual=group.querySelectorAll('.formatted-ledger').length;
        ledgerRows.push({note:id,expected,actual,passed:actual===expected});
      }
      root.unmount();host.remove();
      return {keyRows,ledgerRows};
    }''')
    results.append({'name':'all-supported-key-signatures','passed':all(r['passed'] for r in render_results['keyRows']),
                    'tested':len(render_results['keyRows']),'failures':[r for r in render_results['keyRows'] if not r['passed']]})
    results.append({'name':'full-piano-range-ledger-count','passed':all(r['passed'] for r in render_results['ledgerRows']),
                    'notes':render_results['ledgerRows']})
    note=page.locator('.ws-roll-note').first
    before=page.evaluate('()=>window.__pianoWorkspaceSnapshot()')
    box=note.bounding_box()
    page.mouse.move(box['x']+4,box['y']+box['height']/2)
    page.mouse.down();page.mouse.move(box['x']+4,box['y']+box['height']/2-8)
    page.wait_for_timeout(80)
    preview=note.get_attribute('data-preview-pitch')
    # Use a genuine keyboard activation while the pointer transaction is still open.
    page.get_by_role('button',name='Formatted score',exact=True).focus()
    page.keyboard.press('Space')
    page.wait_for_selector('[data-formatted-page="1"]')
    page.mouse.up();page.wait_for_timeout(120)
    after=page.evaluate('()=>window.__pianoWorkspaceSnapshot()')
    results.append({'name':'preview-cancels-in-flight-pointer-transaction','passed':after['document']==before['document'] and after['past']==before['past'],
                    'preview_pitch':preview,'before_pitch':before['document']['performance'][0]['pitch'],
                    'after_pitch':after['document']['performance'][0]['pitch'],
                    'before_history':before['past'],'after_history':after['past']})
    context.close();browser.close()
Path(__file__).with_name('review-edge-probes-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
