"""Phase 8 mode lifecycle: repeated switches preserve view, selection, media and clock."""
import hashlib
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_lifecycle_route', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
results = {}


def scroll_state(page):
    return page.evaluate('''() => ({
      rollTop:document.querySelector('.ws-roll-viewport')?.scrollTop,
      rollLeft:document.querySelector('.ws-roll-viewport')?.scrollLeft,
      scoreLeft:document.querySelector('.ws-score-viewport')?.scrollLeft,
      start:document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-start'),
      span:document.querySelector('.ws-roll-svg')?.getAttribute('data-roll-window-span')})''')


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    world = m.World(m.LONG)
    world.video_bytes = (ROOT / 'docs/qualification/piano-workspace-phase-08/fixtures/clip30.mp4').read_bytes()
    world.draft = {**world.draft, 'source_video': {
        'key': f'lessons/{m.LESSON}/video/clip.mp4', 'mime': 'video/mp4',
        'bytes': len(world.video_bytes), 'sha256': hashlib.sha256(world.video_bytes).hexdigest()}}
    context.route('**/api/**', world.route)
    page = context.new_page(); m.open_route(page)
    page.wait_for_function('document.querySelector("video")?.readyState>=2')
    # Dirty document and non-default viewport/zoom.
    page.locator('.ws-roll-note').first.click()
    page.get_by_role('button', name='+ semitone', exact=True).click()
    page.locator('.ws-roll-viewport').evaluate('(e)=>{e.scrollTop=25;e.scrollLeft=80;e.dispatchEvent(new Event("scroll"));}')
    page.locator('.ws-score-viewport').evaluate('(e)=>{e.scrollLeft=137;e.dispatchEvent(new Event("scroll"));}')
    page.get_by_role('button', name='Zoom in').click()
    page.wait_for_timeout(250)
    before_doc = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    before_scroll = scroll_state(page)
    before_selection = before_doc['selection']
    # Paused media at non-default time/rate.
    page.locator('select').filter(has_text='0.75').select_option('0.75')
    page.locator('video').evaluate('(v)=>{v.pause();v.currentTime=1.5;window.__lifeVideo=v;}')
    page.wait_for_timeout(200)
    before_video = page.locator('video').evaluate('(v)=>({time:v.currentTime,rate:v.playbackRate,paused:v.paused})')
    for _ in range(3):
        page.get_by_role('button', name='Formatted score', exact=True).click()
        page.wait_for_selector('[data-formatted-page="1"]')
        page.get_by_role('button', name='Return to correction', exact=True).click()
        page.wait_for_selector('.ws-roll-svg')
        page.wait_for_timeout(150)
    after_doc = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    after_scroll = scroll_state(page)
    after_video = page.locator('video').evaluate('(v)=>({same:v===window.__lifeVideo,time:v.currentTime,rate:v.playbackRate,paused:v.paused})')
    results['repeated_switch_preserves'] = {
        'document': after_doc['document'] == before_doc['document'],
        'selection': after_doc['selection'] == before_selection,
        'history': after_doc['past'] == before_doc['past'],
        'scroll': after_scroll == before_scroll,
        'video_same_element': after_video['same'],
        'video_time': abs(after_video['time'] - before_video['time']) < 0.05,
        'video_rate': abs(after_video['rate'] - before_video['rate']) < 1e-6,
        'before_scroll': before_scroll, 'after_scroll': after_scroll,
        'before_video': before_video, 'after_video': after_video,
    }
    # Playback after return drives the shared clock.
    page.get_by_role('button', name='Play', exact=True).click()
    page.wait_for_timeout(400)
    native = page.locator('video').evaluate('(v)=>({time:v.currentTime,paused:v.paused})')
    clock_text = page.locator('.ws-time').inner_text()
    clock = float(clock_text.split(' s')[0])
    results['returned_transport'] = {'native': native, 'clock': clock,
                                     'passed': not native['paused'] and abs(clock - native['time']) < 0.6}
    # Entering preview while playing pauses at the same position and return stays paused.
    page.get_by_role('button', name='Pause', exact=True).click()  # pause
    page.get_by_role('button', name='Play', exact=True).click()  # play
    page.wait_for_timeout(250)
    page.get_by_role('button', name='Formatted score', exact=True).click()
    page.wait_for_selector('[data-formatted-page="1"]')
    paused_on_entry = page.locator('video').evaluate('(v)=>({paused:v.paused,time:v.currentTime})')
    page.get_by_role('button', name='Return to correction', exact=True).click()
    page.wait_for_selector('video')
    returned_media = page.locator('video').evaluate('(v)=>({paused:v.paused,time:v.currentTime,rate:v.playbackRate})')
    results['playing_entry_policy'] = {'on_entry': paused_on_entry, 'on_return': returned_media,
                                       'passed': paused_on_entry['paused'] and returned_media['paused']
                                       and abs(returned_media['time'] - paused_on_entry['time']) < 0.05}
    context.close(); browser.close()

ok = (results['repeated_switch_preserves']['document']
      and results['repeated_switch_preserves']['selection']
      and results['repeated_switch_preserves']['history']
      and results['repeated_switch_preserves']['scroll']
      and results['repeated_switch_preserves']['video_same_element']
      and results['repeated_switch_preserves']['video_time']
      and results['repeated_switch_preserves']['video_rate']
      and results['returned_transport']['passed'] and results['playing_entry_policy']['passed'])
Path(__file__).with_name('mode-lifecycle-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
raise SystemExit(0 if ok else 1)
