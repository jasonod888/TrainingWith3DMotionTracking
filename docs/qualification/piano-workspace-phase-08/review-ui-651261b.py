"""Reviewer geometry checks against an isolated 651261b Vite instance on 5181."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.goto('http://127.0.0.1:5181/workspace-harness.html?demo=frames')
    page.wait_for_selector('.ws-score-notehead')
    result = page.evaluate('''async () => {
      const {layoutMeasures,xForTick,tickAtX}=await import('/src/music/workspace/viewport.ts');
      const snapshot=window.__pianoWorkspaceSnapshot();
      const doc=snapshot.document;
      const boxes=layoutMeasures(doc).boxes;
      const cursor=document.querySelector('.ws-score-playhead');
      const start=Number(cursor.getAttribute('data-playhead-tick'));
      const actual=Number(cursor.getAttribute('x1'));
      const expected=xForTick(boxes,doc,start,116);
      const targetTick=doc.measures[0].start+doc.measures[0].duration/2;
      const targetX=xForTick(boxes,doc,targetTick,116);
      return {
        cursor:{tick:start,actual,expected,errorPx:actual-expected,passed:Math.abs(actual-expected)<1},
        ruler:{targetTick,targetX,decodedTick:tickAtX(boxes,doc,targetX),
          expectedTick:tickAtX(boxes,doc,targetX,116),
          passed:Math.abs(tickAtX(boxes,doc,targetX)-targetTick)<1}
      };
    }''')
    page.screenshot(path=str(Path(__file__).with_name('review-ui-651261b-cursor.png')))
    browser.close()

Path(__file__).with_name('review-ui-651261b-results.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
