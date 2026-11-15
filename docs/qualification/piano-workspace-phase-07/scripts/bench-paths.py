"""Per-path production performance qualification at the real and 5,000 boundary."""
import importlib.util
import json
import os
import statistics
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
route_spec = importlib.util.spec_from_file_location('phase7_paths_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(route_spec)
route_spec.loader.exec_module(m)
bench_spec = importlib.util.spec_from_file_location('phase7_paths_bench', SCRIPTS / 'bench-interactive.py')
bench = importlib.util.module_from_spec(bench_spec)
bench_spec.loader.exec_module(bench)
BASE = os.environ.get('PERF_BASE', 'http://localhost:4173')
OUT = ROOT / 'docs/qualification/piano-workspace-phase-07/phase7-paths.json'
RESULT = {'base': BASE, 'runs': 3, 'samples_per_path': 20, 'paths': {}}


def p95(values):
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(-(-0.95 * len(ordered) // 1)) - 1))
    return round(ordered[index], 2)


def stats(values):
    return {'median': round(statistics.median(values), 2), 'p95': p95(values),
            'max': round(max(values), 2), 'samples': [round(v, 2) for v in values]}


def total(page):
    return int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))


def pitch(page, occurrence):
    return int(page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]').get_attribute('data-pitch'))


def onset(page, occurrence):
    label = page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]').get_attribute('aria-label') or ''
    return float(label.split(' at ')[1].split(' seconds')[0])


def facts(page):
    return page.locator('.ws-facts').inner_text()


def select(page, occurrence):
    node = page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]')
    box = node.bounding_box()
    node.dispatch_event('pointerdown', {'pointerId': 81, 'pointerType': 'mouse', 'button': 0,
                                        'clientX': box['x'] + 4, 'clientY': box['y'] + box['height'] / 2})
    node.dispatch_event('pointerup', {'pointerId': 81, 'pointerType': 'mouse'})


def reset_modes(page):
    if page.locator('[data-add="active"]').count():
        page.locator('[data-add="cancel"]').click()
    if page.locator('[data-replace="active"]').count():
        page.keyboard.press('Escape')
    page.wait_for_timeout(10)


def undo_all(page):
    button = page.get_by_role('button', name='Undo', exact=True)
    for _ in range(40):
        if not button.is_enabled():
            break
        button.click()
        page.wait_for_timeout(15)


def gesture(page, locator, dx, dy, pointer=90):
    box = locator.bounding_box()
    return page.evaluate("""async ([x, y, dx, dy, id]) => {
      const node = document.elementFromPoint(x, y);
      const fire = (kind, cx, cy) => node.dispatchEvent(new PointerEvent(kind, {
        pointerId: id, pointerType: 'mouse', button: 0, buttons: 1,
        clientX: cx, clientY: cy, bubbles: true, composed: true, cancelable: true}));
      const start = performance.now();
      fire('pointerdown', x, y); fire('pointermove', x + dx, y + dy);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      const preview = performance.now() - start;
      const commitStart = performance.now();
      fire('pointerup', x + dx, y + dy);
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {preview, commit: performance.now() - commitStart};
    }""", [box['x'] + 4, box['y'] + box['height'] / 2, dx, dy, pointer])


def click_measured(page, locator):
    return page.evaluate("""async (selector) => {
      const node = document.querySelector(selector);
      const start = performance.now();
      if (typeof node.click === 'function') node.click(); else node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {commit: performance.now() - start};
    }""", locator)


def click_locator(locator):
    return locator.evaluate("""async (node) => {
      const start = performance.now();
      if (typeof node.click === 'function') node.click(); else node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {commit: performance.now() - start};
    }""")


def click_at(page, locator):
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    return page.evaluate("""async ([x, y]) => {
      const node = document.elementFromPoint(x, y);
      const start = performance.now();
      node.dispatchEvent(new PointerEvent('pointerdown', {pointerId: 97, pointerType: 'mouse',
        button: 0, clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true}));
      node.dispatchEvent(new PointerEvent('pointerup', {pointerId: 97, pointerType: 'mouse',
        clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true}));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {commit: performance.now() - start};
    }""", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])


def pick_non_tied(page, enharmonic=False):
    return page.evaluate("""([enharmonic]) => {
      const names = {1: ['C#', 'Db'], 3: ['D#', 'Eb'], 6: ['F#', 'Gb'], 8: ['G#', 'Ab'], 10: ['A#', 'Bb']};
      const candidates = [];
      for (const node of document.querySelectorAll('.ws-roll-note')) {
        const id = node.getAttribute('data-occurrence');
        const pitch = Number(node.getAttribute('data-pitch'));
        const heads = document.querySelectorAll('.ws-score-notehead[data-occurrence="' + id + '"]');
        if (heads.length !== 1) continue;
        if (enharmonic && !names[pitch % 12]) continue;
        candidates.push({id, pitch, octave: Math.floor(pitch / 12) - 1, options: names[pitch % 12] || []});
      }
      return candidates.length ? candidates[candidates.length - 1] : null;
    }""", [enharmonic])


def make_paths(page, occurrence):
    """Return {name: (action, applied, restored, preview_bool)} closures."""
    base_pitch = pitch(page, occurrence)
    base_onset = onset(page, occurrence)
    base_total = total(page)

    def pitch_drag():
        timing = gesture(page, page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]'), 0, -8)
        return timing, pitch(page, occurrence) != base_pitch

    def time_drag():
        timing = gesture(page, page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]'), 8, 0)
        return timing, abs(onset(page, occurrence) - base_onset) > 1e-4

    def resize():
        select(page, occurrence)
        page.wait_for_timeout(10)
        timing = gesture(page, page.locator('[data-handle="resize"]').first, 8, 0)
        value = float(page.get_by_label('Recorded length (s)').input_value())
        return timing, value > 0

    def sheet_drag():
        head = page.locator(f'.ws-score-notehead[data-occurrence="{occurrence}"]').first
        timing = gesture(page, head, 0, -5)
        return timing, pitch(page, occurrence) != base_pitch

    def replace():
        select(page, occurrence)
        page.get_by_role('button', name='Replace pitch').click()
        page.wait_for_timeout(10)
        key = page.locator(f'.keyboard-white[data-pitch="{base_pitch + 2}"], '
                           f'.keyboard-black[data-pitch="{base_pitch + 2}"]').first
        timing = click_locator(key)
        return timing, pitch(page, occurrence) == base_pitch + 2

    def written():
        candidate = pick_non_tied(page)
        if not candidate:
            return {'commit': 0.01}, False
        select(page, candidate['id'])
        page.wait_for_timeout(10)
        before = facts(page)
        timing = None
        for label in ['Half', 'Whole', 'Quarter', 'Eighth']:
            button = page.get_by_role('button', name=label, exact=True)
            if not button.count() or not button.first.is_enabled():
                continue
            timing = click_locator(button.first)
            if page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'true':
                break
        return timing or {'commit': 0.01}, page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'true'

    def accidental():
        select(page, occurrence)
        page.wait_for_timeout(10)
        button = page.get_by_role('button', name='♯')
        timing = click_locator(button)
        return timing, pitch(page, occurrence) != base_pitch

    def respell():
        candidate = pick_non_tied(page, enharmonic=True)
        if not candidate:
            return {'commit': 0.01}, False
        select(page, candidate['id'])
        before = facts(page)
        spelling = next(name + str(candidate['octave']) for name in candidate['options']
                        if name not in before)
        field = page.locator('.ws-row[aria-label="Respell"] input')
        field.fill(spelling)
        timing = click_locator(page.get_by_role('button', name='Apply spelling'))
        return timing, page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'true'

    def add():
        page.locator('[data-add="toggle"]').click()
        page.wait_for_selector('.ws-roll-add-layer')
        box = page.locator('.ws-roll-add-layer').bounding_box()
        span = float(page.locator('[data-window-span]').get_attribute('data-window-span'))
        for seconds in (0.75, 1.25, 1.75, 5.25, 9.75):
            for fraction in (0.05, 0.2, 0.4, 0.7, 0.9):
                page.mouse.click(box['x'] + box['width'] * (seconds / span), box['y'] + box['height'] * fraction)
                page.wait_for_timeout(20)
                if page.locator('[data-ghost="true"]').count() and page.locator('[data-add="invalid"]').count() == 0:
                    timing = click_locator(page.locator('[data-add="commit"]'))
                    if total(page) == base_total + 1:
                        return timing, True
                    return timing, False
        return {'commit': 0.01}, False

    def delete():
        select(page, occurrence)
        page.wait_for_timeout(10)
        timing = page.evaluate("""async () => {
          const start = performance.now();
          window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true, cancelable: true}));
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          await new Promise(resolve => requestAnimationFrame(() => resolve()));
          return {commit: performance.now() - start};
        }""")
        return timing, total(page) == base_total - 1

    return {
        'roll_pitch': (pitch_drag, True),
        'roll_time': (time_drag, True),
        'roll_resize': (resize, True),
        'sheet_pitch': (sheet_drag, True),
        'keyboard_replace': (replace, False),
        'written_duration': (written, False),
        'accidental': (accidental, False),
        'respell': (respell, False),
        'add_note': (add, False),
        'delete_note': (delete, False),
    }


def open_case(browser, draft):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', m.World(draft).route)
    page = context.new_page()
    page.goto(f'{BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    return context, page


def run_fixture(browser, draft, label):
    # Validate the fixture identity on its own page.
    context, page = open_case(browser, draft)
    heading = page.locator('.ws-sub').inner_text()
    RESULT.setdefault('fixtures', {})[label] = heading
    expected_notes = len(draft['events'])
    if label != 'real_1338':
        assert f'{expected_notes} notes' in heading, heading
        assert '512 measures' in heading, heading
    context.close()

    samples = {}
    names = ['roll_pitch', 'roll_time', 'roll_resize', 'sheet_pitch', 'keyboard_replace',
             'written_duration', 'accidental', 'respell', 'add_note', 'delete_note']
    for path in names:
        # A fresh page per path avoids leaving modes, selections or history from a
        # previous path in the measurement.
        context, page = open_case(browser, draft)
        occurrence = page.locator('.ws-roll-note').first.get_attribute('data-occurrence')
        action, has_preview = make_paths(page, occurrence)[path]
        action()
        undo_all(page)
        reset_modes(page)
        rows = []
        for _ in range(20):
            before_total = total(page)
            before_pitch = pitch(page, occurrence)
            timing, applied = action()
            undo_all(page)
            dirty = page.locator('.ws-shell').get_attribute('data-workspace-dirty')
            restored = total(page) == before_total and dirty == 'false'
            reset_modes(page)
            rows.append({'preview': timing.get('preview'), 'commit': timing['commit'],
                         'applied': bool(applied), 'restored': bool(restored), 'has_preview': has_preview})
        samples[path] = {
            'preview': stats([r['preview'] for r in rows]) if has_preview else None,
            'commit': stats([r['commit'] for r in rows]),
            'applied': sum(1 for r in rows if r['applied']), 'restored': sum(1 for r in rows if r['restored']),
        }
        context.close()
    return samples


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        for run in range(1, 4):
            run_results = {}
            for label, draft in (('real_1338', m.LONG), ('limit_5000', bench.limit_draft(5000))):
                run_results[label] = run_fixture(browser, draft, label)
            RESULT[f'run{run}'] = run_results
        browser.close()

    failures = []
    for run in range(1, 4):
        for label in ('real_1338', 'limit_5000'):
            for path, data in RESULT[f'run{run}'][label].items():
                if data['applied'] != 20 or data['restored'] != 20:
                    failures.append(f'run{run} {path}/{label}: applied {data["applied"]} restored {data["restored"]}')
                if data['commit']['p95'] > 100:
                    failures.append(f'run{run} {path}/{label}: commit p95 {data["commit"]["p95"]}')
                if data['preview'] and data['preview']['p95'] > 16.7:
                    failures.append(f'run{run} {path}/{label}: preview p95 {data["preview"]["p95"]}')
    RESULT['failures'] = failures
    RESULT['status'] = 'PASS' if not failures else 'FAIL'
    OUT.write_text(json.dumps(RESULT, indent=2), encoding='utf-8')
    print(json.dumps({'status': RESULT['status'], 'failures': failures,
                      'headings': RESULT.get('fixtures')}, indent=2))
    raise SystemExit(0 if not failures else 1)


if __name__ == '__main__':
    main()
