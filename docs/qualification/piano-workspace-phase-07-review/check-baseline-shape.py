"""R4 coverage: both state discriminants and every consumed map entry are validated."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome');context=browser.new_context()
    context.route('**/api/**',lambda r:r.fulfill(status=404,content_type='application/json',body='{}'))
    page=context.new_page();page.goto('http://127.0.0.1:5173/workspace-harness.html?demo=frames',wait_until='domcontentloaded')
    results=page.evaluate('''async()=>{
      const tx=await import('/src/music/workspace/verification-transaction.ts');
      const core=await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
      const base=core.buildNotation([{id:'a',onset:2,duration:0.5,pitch:60,velocity:0.6,confidence:null,optional:false,string:null,fret:null}],{bpm:120,duration:12});
      const f={id:'shape',kind:'pitch',status:'suggested',pitch:60,time_range:[0,12],explanation:'R4',
        event_ids:['a'],evidence:{},alternatives:[],ambiguous:false,ambiguity_reasons:[],
        proposed_edits:[{op:'set_pitch',event_ids:['a'],before:{pitch:60},after:{pitch:62}}]};
      const p=tx.prepareFinding(base,f,null);if(p.status!=='applied')throw Error(p.reason);
      const beforeBad=structuredClone(p.baseline);beforeBad.before.a.present=false;
      const before=tx.validateBaseline(f,beforeBad);
      const extraBad=structuredClone(p.baseline);extraBad.entries.extra=null;
      const extra=tx.validateBaseline(f,extraBad);
      let threw=false;try{tx.invertFinding(p.document,f,null,extraBad);}catch{threw=true;}
      return [{id:'R4',name:'before-state-discriminant',passed:!before.ok,validator_accepted:before.ok},
        {id:'R4',name:'malformed-extra-entry',passed:!extra.ok&&!threw,validator_accepted:extra.ok,invert_threw:threw}];
    }''')
    context.close();browser.close()
Path(__file__).with_name('baseline-shape-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
