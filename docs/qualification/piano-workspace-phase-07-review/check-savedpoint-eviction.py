"""Existing B1 contract at the existing bounded-history eviction boundary."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    page = browser.new_page()
    page.goto('http://127.0.0.1:5173', wait_until='domcontentloaded')
    result = page.evaluate('''async () => {
      const notation = await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
      const ws = await import('/src/music/workspace/workspace-state.ts');
      const doc = notation.buildNotation([{id:'history-probe',pitch:60,onset:0.2,duration:0.2,
        velocity:0.5,confidence:null,optional:false,string:null,fret:null}], 4, {bpm:120});
      let state = ws.createWorkspaceState(doc);
      const edit = (state, value) => ws.workspaceReducer(state, {type:'command',
        command:{type:'set-occurrence-velocity',occurrenceId:'history-probe',velocity:value}});
      for(let i=0; i<ws.HISTORY_LIMIT; i++) state = edit(state, i%2 ? 0.7 : 0.6);
      const savedPath = ws.historyPath(state);
      const saved = JSON.stringify(state.document);
      const savedDepth = state.past.length;
      state = edit(state,0.8);
      state = ws.workspaceReducer(state,{type:'undo'});
      return {savedDepth,afterUndoDepth:state.past.length,savedPath,
        afterUndoPath:ws.historyPath(state),evicted:state.evicted,
        exactDocumentRestored:saved===JSON.stringify(state.document),
        passed:saved===JSON.stringify(state.document) && savedPath===ws.historyPath(state)};
    }''')
    print(json.dumps(result, indent=2))
    Path(__file__).with_name('savedpoint-eviction-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    browser.close()
raise SystemExit(0 if result['passed'] else 1)
