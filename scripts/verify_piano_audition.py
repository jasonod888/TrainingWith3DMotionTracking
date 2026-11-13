"""Browser regression: held-note audio, displayed keys and audio-clock transport agree.

Requires the local Vite server and the existing optional Playwright test environment.
It uses the real preview component/native Web Audio, not the user's private database.
"""
import json
from pathlib import Path
import re
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
output = ROOT / '.local/piano-audition-fix'
output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/audition-regression', lambda route: route.fulfill(
        content_type='text/html', body='''<!doctype html><div id="root"></div>
        <script type="module" src="/tests/fixtures/piano-audition-preview.tsx"></script>'''))
    page.goto('http://127.0.0.1:5173/audition-regression')
    active = page.locator('.draft-key-white.is-active, .draft-key-black.is-active')
    expect(page.get_by_role('button', name='Play proposed notes', exact=True)).to_be_visible()
    expect(active).to_have_count(0)
    page.get_by_role('button', name='Play proposed notes', exact=True).click()
    page.wait_for_function('window.__auditionTest?.context.currentTime > .3')
    page.evaluate('window.__auditionTest.context.suspend()')
    paused = page.locator('.draft-preview-status').inner_text()
    page.wait_for_timeout(300)
    assert page.locator('.draft-preview-status').inner_text() == paused
    page.evaluate('window.__auditionTest.context.resume()')
    page.wait_for_function('window.__auditionTest.context.currentTime > 5.5', timeout=10000)
    late = page.evaluate('''() => {
      const {context,analyser} = window.__auditionTest;
      const buffer = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buffer);
      return {time:context.currentTime,rms:Math.sqrt(buffer.reduce((s,x)=>s+x*x,0)/buffer.length)};
    }''')
    expect(active).to_have_count(1)
    status = page.locator('.draft-preview-status').inner_text()
    displayed = float(re.search(r'Auditioning ([\d.]+)', status).group(1))
    assert abs(displayed - (late['time'] - .05)) < .2, (status, late)
    assert late['rms'] > .001, late
    page.wait_for_function('window.__auditionTest.context.currentTime > 6.2', timeout=3000)
    expect(active).to_have_count(0)
    after_end = page.evaluate('''() => {
      const a=window.__auditionTest.analyser,b=new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(b);return Math.sqrt(b.reduce((s,x)=>s+x*x,0)/b.length);
    }''')
    assert after_end < .00001, after_end
    page.get_by_role('button', name='Stop audition', exact=True).click()
    expect(active).to_have_count(0)
    page.get_by_role('button', name='Play proposed notes', exact=True).click()
    page.wait_for_function('window.__auditionTest.context.state === "running"')
    page.get_by_role('button', name='Change proposal', exact=True).click()
    expect(page.get_by_role('button', name='Play proposed notes', exact=True)).to_be_visible()
    page.wait_for_function('window.__auditionTest.context.state === "closed"')

    rendered = page.evaluate('''async () => {
      const {auditionRange} = await import('/src/music/note-audition.ts');
      async function render(events,start,end) {
        const rate=48000, offline=new OfflineAudioContext(1,Math.ceil((end-start+.5)*rate),rate);
        const facade={currentTime:0,destination:offline.destination,
          resume:()=>Promise.resolve(),close:()=>Promise.resolve()};
        for(const key of ['createGain','createDynamicsCompressor','createOscillator',
                          'createBiquadFilter','createPeriodicWave']) facade[key]=offline[key].bind(offline);
        window.AudioContext=function(){return facade;};
        const stop=auditionRange(events,start,end);
        const buffer=await offline.startRendering(),samples=buffer.getChannelData(0);
        const rms=t=>{let sum=0,n=0;for(let i=Math.floor((t+.05)*rate);i<Math.floor((t+.15)*rate);i++){
          sum+=samples[i]*samples[i];n++;}return Math.sqrt(sum/n);};
        const values={early:rms(.1),late:rms(Math.max(.1,end-start-.6)),after:rms(end-start+.1),
          peak:samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0)};
        stop();return values;
      }
      const note={id:'long',pitch:60,onset:0,duration:6,velocity:.6};
      return {long:await render([note],0,6),short:await render([{...note,duration:.25}],0,.25),
        cropped:await render([note],3,4),
        chord:await render([60,64,67].map(pitch=>({...note,id:String(pitch),pitch,duration:3})),0,3),
        soft:await render([{...note,velocity:.15}],0,6),
        loud:await render([{...note,velocity:.9}],0,6)};
    }''')
    assert rendered['long']['late'] / rendered['long']['early'] > .15, rendered
    assert rendered['cropped']['early'] > .001, rendered
    assert rendered['chord']['late'] > .001, rendered
    assert rendered['loud']['late'] > rendered['soft']['late'] * 2, rendered
    for value in rendered.values():
        assert value['after'] < 1e-5 and value['peak'] < 1, value
    assert not errors, errors
    browser.close()
receipt = {'live_at_5_5_seconds': late, 'after_note_end_rms': after_end,
           'audio_clock_pause': 'passed', 'proposal_change_stops_audio': 'passed',
           'native_offline_renders': rendered}
(output / 'browser-verification.json').write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt, indent=2))
