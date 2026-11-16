"""Render compact key/range fixtures visibly and capture them for inspection."""
import importlib.util
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
CAPTURES = Path(__file__).resolve().parents[1] / 'captures'
CAPTURES.mkdir(exist_ok=True)
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase8_fixture_route', source)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1100, 'height': 900})
    context.route('**/api/**', m.World(m.LONG).route)
    page = context.new_page(); m.open_route(page)
    def render(key, pitches, name):
        page.evaluate('''async ([key, pitches]) => {
          const reactModule = await import('/node_modules/.vite/deps/react.js');
          const React = reactModule.default ?? reactModule;
          const clientModule = await import('/node_modules/.vite/deps/react-dom_client.js');
          const createRoot = clientModule.createRoot ?? clientModule.default?.createRoot;
          const music = await import('/@fs/D:/3d_trainer/developement/packages/music-notation/index.ts');
          const {FormattedScore} = await import('/src/music/workspace/FormattedScore.tsx');
          document.querySelector('#phase8-fixture')?.remove();
          const host = document.createElement('div');
          host.id = 'phase8-fixture';
          host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#eef1f4;padding:8px';
          document.body.append(host);
          const root = createRoot(host);
          const notes = pitches.map((pitch, index) => ({id: 'f-' + index, pitch, onset: index * 1.5,
            duration: 0.5, velocity: 0.6, confidence: null, optional: false, string: null, fret: null}));
          const doc = music.buildNotation(notes, {duration: 4, bpm: 120, key_signature: key});
          root.render(React.createElement(FormattedScore, {document: doc, title: key + ' · ' + pitches.join(', ')}));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }''', [key, pitches])
        page.locator('#phase8-fixture').screenshot(path=str(CAPTURES / name))
    render('Bbm', [70], 'fixture-bbm.png')
    render('C', [21], 'fixture-a0.png')
    render('C', [108], 'fixture-c8.png')
    context.close(); browser.close()
print('captured fixture-bbm.png, fixture-a0.png, fixture-c8.png')
