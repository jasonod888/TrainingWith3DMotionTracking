"""Interactive performance evidence: real 1,338-note draft and a 20,000-note limit fixture."""
import importlib.util
import json
import os
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec = importlib.util.spec_from_file_location('phase7_perf', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OUT = ROOT / 'docs/qualification/piano-workspace-phase-07/phase7-performance.json'
CAPTURES = ROOT / 'docs/qualification/piano-workspace-phase-07/captures'
RESULT = {'scope': 'production build (vite preview), mocked API, local fixtures', 'runs': 3,
          'samples_per_run': 20, 'base': os.environ.get('PERF_BASE', m.BASE)}


def limit_draft(count=20_000):
    # Supported-boundary fixture: 5,000 notes in ten-note chords every 2 s, so a
    # written half note fits before the next attack in the same voice and several
    # pitch classes have a single-accidental enharmonic spelling.
    if count == 5000:
        pitches = [60, 61, 63, 64, 66, 67, 68, 70, 71, 74]
        groups = count // len(pitches)
        events = []
        for group in range(groups):
            onset = 0.5 + group * 0.5
            for index, pitch in enumerate(pitches):
                events.append({'id': f'big-{group * len(pitches) + index}', 'onset': onset,
                               'duration': 0.2, 'pitch': pitch,
                               'velocity': 0.6 if group % 7 else 0.0,
                               'confidence': 0.8 if group % 11 == 0 else None,
                               'optional': group % 13 == 0, 'string': None, 'fret': None})
        return {**m.LONG, 'title': f'{count} event limit fixture', 'duration': 2108,
                'events': events,
                'spans': [{'start': 0, 'end': 300, 'kind': 'playing'},
                          {'start': 300, 'end': 360, 'kind': 'explanation'},
                          {'start': 360, 'end': 2108, 'kind': 'playing'}]}
    # Larger exploratory fixture (not a qualification boundary).
    events = []
    pitches = [60, 64, 67, 71, 74]
    groups = max(1, count // len(pitches))
    for group in range(groups):
        onset = 0.5 + group * 0.25
        for index, pitch in enumerate(pitches):
            event_id = f'big-{group * len(pitches) + index}'
            events.append({'id': event_id, 'onset': onset,
                           'duration': 3.0 if group % 50 == 0 and index == 0 else 0.2,
                           'pitch': pitch, 'velocity': 0.6 if group % 7 else 0.0,
                           'confidence': 0.8 if group % 11 == 0 else None,
                           'optional': group % 13 == 0, 'string': None, 'fret': None})
    return {**m.LONG, 'title': f'{count} event limit fixture', 'duration': 2108,
            'events': events,
            'spans': [{'start': 0, 'end': 300, 'kind': 'playing'},
                      {'start': 300, 'end': 360, 'kind': 'explanation'},
                      {'start': 360, 'end': 2108, 'kind': 'playing'}]}


def measure(page):
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    heading = page.locator('.ws-sub').inner_text()
    assert 'notes' in heading, heading
    metrics = page.evaluate("""() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {domMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd),
              notes: document.querySelectorAll('.ws-roll-note').length,
              heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
              recoveryBytes: (localStorage.getItem('piano-workspace-recovery-v1') || '').length,
              heading: document.querySelector('.ws-sub')?.textContent ?? ''};
    }""")
    node = page.locator('.ws-roll-note').first
    node.scroll_into_view_if_needed()
    box = node.bounding_box()
    target = [box['x'] + 4, box['y'] + box['height'] / 2]
    # Warm-up: eight gestures discarded before measurement.
    for index in range(8):
        page.evaluate("""async ([x, y, id]) => {
          const node = document.querySelector('.ws-roll-note');
          const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
            pointerId: id, pointerType: 'mouse', button: 0, buttons: 1,
            clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
          fire('pointerdown', 0); fire('pointermove', -6);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          fire('pointerup', -6);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
        }""", [target[0], target[1], 90 + index])
    # Remove the warm-up gestures from history before taking the baseline so the
    # later undo verification returns exactly to this state.
    warmup_undo = page.get_by_role('button', name='Undo', exact=True)
    for _ in range(60):
        if not warmup_undo.is_enabled():
            break
        warmup_undo.click()
    pitch_before = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    samples = []
    for index in range(20):
        samples.append(page.evaluate("""async ([x, y, id]) => {
          const node = document.querySelector('.ws-roll-note');
          const before = node.getAttribute('data-pitch');
          const fire = (kind, dy) => node.dispatchEvent(new PointerEvent(kind, {
            pointerId: id, pointerType: 'mouse', button: 0, buttons: 1,
            clientX: x, clientY: y + dy, bubbles: true, composed: true, cancelable: true}));
          const start = performance.now();
          fire('pointerdown', 0); fire('pointermove', -8);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          const preview = performance.now() - start;
          const commitStart = performance.now();
          fire('pointerup', -8);
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          const commit = performance.now() - commitStart;
          return {preview, commit, before, after: node.getAttribute('data-pitch')};
        }""", [target[0], target[1], 41 + index]))
    applied = sum(1 for item in samples if item['before'] != item['after'])

    def stat(key):
        values = sorted(item[key] for item in samples)
        index = max(0, min(len(values) - 1, int(-(-0.95 * len(values) // 1)) - 1))
        return {'median': round(statistics.median(values), 2), 'p95': round(values[index], 2),
                'max': round(values[-1], 2), 'samples': [round(value, 2) for value in values]}

    # Undo must actually restore the pre-gesture pitch, then redo must reapply.
    undo = page.get_by_role('button', name='Undo', exact=True)
    for _ in range(60):
        if not undo.is_enabled():
            break
        undo.click()
    pitch_after_undo = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    undo_disabled = not undo.is_enabled()
    page.get_by_role('button', name='Redo', exact=True).click()
    pitch_after_redo = int(page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
    metrics['pointer'] = {key: stat(key) for key in ('preview', 'commit')}
    metrics['pointer_samples'] = samples
    metrics['applied_samples'] = applied
    metrics['undo_restored'] = pitch_after_undo == pitch_before
    metrics['undo_disabled'] = undo_disabled
    metrics['redo_reapplied'] = pitch_after_redo != pitch_before
    metrics['pitch_before'] = pitch_before
    metrics['pitch_after_undo'] = pitch_after_undo
    metrics['pitch_after_redo'] = pitch_after_redo
    return metrics


def run_case(browser, world, label):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', world.route)
    page = context.new_page()
    page.goto(f"{os.environ.get('PERF_BASE', m.BASE)}/?page=music-review&id={m.LESSON}",
              wait_until='domcontentloaded')
    metrics = measure(page)
    page.screenshot(path=str(CAPTURES / f'performance-{label}.png'))
    context.close()
    return metrics


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        fixtures = [('real_1338', m.LONG)] + [(f'limit_{count}', limit_draft(count))
                                              for count in (5_000, 10_000, 20_000)]
        for name, draft in fixtures:
            for run in range(1, 4):
                RESULT[f'{name}_run{run}'] = run_case(browser, m.World(draft), f'{name}-{run}')
        browser.close()
    OUT.write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps(RESULT, indent=2))


if __name__ == '__main__':
    main()
