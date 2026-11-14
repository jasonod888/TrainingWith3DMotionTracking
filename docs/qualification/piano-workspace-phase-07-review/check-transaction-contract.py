"""Consolidated matrix audit: invoke the actual pure module through local Vite."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    context=browser.new_context()
    context.route('**/api/**',lambda route:route.fulfill(status=404,content_type='application/json',body='{}'))
    page=context.new_page();page.goto('http://127.0.0.1:5173/workspace-harness.html?demo=frames',wait_until='domcontentloaded')
    results=page.evaluate('''async () => {
      const tx=await import('/src/music/workspace/verification-transaction.ts');
      const core=await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
      const events=[{id:'a',onset:2,duration:null,pitch:60,velocity:null,confidence:0.8,optional:true,string:null,fret:null,notation_duration:0.3},
                    {id:'b',onset:4,duration:0.5,pitch:67,velocity:0.6,confidence:null,optional:false,string:null,fret:null}];
      const base=core.buildNotation(events,{bpm:120,duration:12});
      const make=(id,op,before,after)=>({id,kind:'matrix',status:'suggested',pitch:60,time_range:[0,12],
          explanation:'matrix probe',event_ids:['a'],evidence:{},alternatives:[],ambiguous:false,ambiguity_reasons:[],
          proposed_edits:[{op,event_ids:['a'],before,after}]});
      const original=base.performance.find(n=>n.id==='a');
      const f=make('nullable-delete','delete_note',{...original},null);
      const prepared=tx.prepareFinding(base,f,null);
      if(prepared.status!=='applied')throw new Error(prepared.reason);
      const accepted=tx.stage(base,prepared.commands);if(!accepted.ok)throw new Error(accepted.reason);
      const inverse=tx.invertFinding(accepted.document,f,null,prepared.baseline);
      if(!inverse.commands)throw new Error(inverse.reason);
      const reversed=tx.stage(accepted.document,inverse.commands);if(!reversed.ok)throw new Error(reversed.reason);
      const restored=reversed.document.performance.find(n=>n.id==='a');
      const differences=Object.keys(original).filter(k=>original[k]!==restored[k]);
      const out=[{id:'S5-O4',name:'delete-inverse-preserves-nullable-performance-and-metadata',
          passed:differences.length===0,original,restored,differences}];
      const changed=core.applyCommand(base,{type:'set-occurrence-velocity',occurrenceId:'a',velocity:0.9});
      if(changed.status!=='applied')throw new Error('velocity fixture did not change');
      const staleDelete=tx.prepareFinding(changed.document,f,null);
      out.push({id:'S2-O4',name:'delete-before-snapshot-detects-later-velocity-edit',
          passed:staleDelete.status==='rejected',actual_status:staleDelete.status,
          original_velocity:original.velocity,manual_velocity:0.9});
      const pitchFinding=make('validator','set_pitch',{pitch:60},{pitch:62});
      const p=tx.prepareFinding(base,pitchFinding,null);if(p.status!=='applied')throw new Error(p.reason);
      for(const [name,patch] of [['invalid-spelling',{spelling:'not-a-note'}],
                                ['off-grid-ticks',{eventStart:1,eventDuration:1}],
                                ['non-finite-duration',{duration:Infinity}]]){
        const bad=structuredClone(p.baseline);Object.assign(bad.entries.a,patch);
        const checked=tx.validateBaseline(pitchFinding,bad);
        out.push({id:'R4',name,passed:!checked.ok,validator_accepted:checked.ok});
      }
      return out;
    }''')
    context.close();browser.close()
Path(__file__).with_name('transaction-contract-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
