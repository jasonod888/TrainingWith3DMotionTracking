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
OUT = Path(os.environ.get('PERF_OUT', str(ROOT / 'docs/qualification/piano-workspace-phase-07/phase7-paths.json')))
RESULT = {'base': BASE, 'runs': 3, 'samples_per_path': 20, 'paths': {}}
EXPECTED = {}


def p95(values):
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(-(-0.95 * len(ordered) // 1)) - 1))
    return round(ordered[index], 2)


def stats(values):
    return {'median': round(statistics.median(values), 2), 'p95': p95(values),
            'max': round(max(values), 2), 'samples': [round(v, 2) for v in values]}


def snapshot(page):
    return page.evaluate('() => window.__pianoWorkspaceSnapshot()')


def snapshot_meta(page):
    return page.evaluate("""() => {
      const state = window.__pianoWorkspaceSnapshot();
      return {past: state.past, future: state.future, dirty: state.dirty};
    }""")


def snapshot_hash(page):
    return page.evaluate("""() => {
      const text = JSON.stringify(window.__pianoWorkspaceSnapshot().document);
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return `${text.length}:${hash >>> 0}`;
    }""")


def canonical(state):
    return json.dumps(state['document'], sort_keys=True, separators=(',', ':'))


def perf_note(document, occurrence):
    for note in document['performance']:
        if note['id'] == occurrence:
            return note
    return None


def locate(document, occurrence):
    for event in document['events']:
        for note in event['notes']:
            if occurrence in note['performance_ids']:
                return event, note
    return None, None


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
      if (!node) throw new Error('gesture target is not under the pointer');
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
    }""", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, dx, dy, pointer])


def click_measured(page, locator):
    return page.evaluate("""async (selector) => {
      const node = document.querySelector(selector);
      const start = performance.now();
      if (typeof node.click === 'function') node.click(); else node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {commit: performance.now() - start};
    }""", locator)


def click_locator(locator):
    return locator.evaluate("""async (node) => {
      const start = performance.now();
      if (typeof node.click === 'function') node.click(); else node.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return {commit: performance.now() - start};
    }""")


def click_button_timed(locator):
    return locator.evaluate("""async (node) => {
      const start = performance.now();
      node.click();
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
      return {commit: performance.now() - start};
    }""", [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2])


def pick_non_tied(page, enharmonic=False, limit=1):
    return page.evaluate("""([enharmonic, limit]) => {
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
      const tail = candidates.slice(-limit);
      return limit === 1 ? (tail[0] ?? null) : tail.reverse();
    }""", [enharmonic, limit])


def pick_safe(page, delta):
    return page.evaluate("""([delta]) => {
      const notes = [...document.querySelectorAll('.ws-roll-note')];
      const pitches = new Set(notes.map(node => Number(node.getAttribute('data-pitch'))));
      for (const node of notes) {
        const pitch = Number(node.getAttribute('data-pitch'));
        if (pitch + delta >= 0 && pitch + delta <= 127 && !pitches.has(pitch + delta)) {
          return {id: node.getAttribute('data-occurrence'), pitch};
        }
      }
      return null;
    }""", [delta])


def make_paths(page, occurrence, duration):
    """Return {name: (action, applied, restored, preview_bool)} closures."""
    base_pitch = pitch(page, occurrence)
    base_onset = onset(page, occurrence)
    base_total = total(page)

    def pitch_drag():
        EXPECTED['roll_pitch'] = {'occurrence': occurrence, 'pitch': base_pitch}
        timing = gesture(page, page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]'), 0, -8)
        return timing, pitch(page, occurrence) != base_pitch

    def time_drag():
        EXPECTED['roll_time'] = {'occurrence': occurrence, 'onset': base_onset}
        timing = gesture(page, page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]'), 8, 0)
        return timing, abs(onset(page, occurrence) - base_onset) > 1e-4

    def resize():
        target = page.locator('.ws-roll-note').first.get_attribute('data-occurrence')
        EXPECTED['roll_resize'] = {'occurrence': target}
        select(page, target)
        page.wait_for_timeout(10)
        before = snapshot(page)
        timing = gesture(page, page.locator('[data-handle="resize"]').first, 30, 0)
        after = snapshot(page)
        old = perf_note(before['document'], target)
        new = perf_note(after['document'], target)
        if not old or not new:
            return timing, False
        event_before, _ = locate(before['document'], target)
        event_after, _ = locate(after['document'], target)
        applied = (new['duration'] is not None and old['duration'] is not None
                   and abs(new['duration'] - old['duration']) > 1e-6
                   and abs(new['onset'] - old['onset']) < 1e-9
                   and event_before['duration'] == event_after['duration'])
        return timing, applied

    def sheet_drag():
        candidate = page.evaluate("""() => {
          const notes = [...document.querySelectorAll('.ws-roll-note')];
          const pitches = new Set(notes.map(node => Number(node.getAttribute('data-pitch'))));
          for (const node of notes) {
            const id = node.getAttribute('data-occurrence');
            const pitch = Number(node.getAttribute('data-pitch'));
            if (pitch % 12 !== 3) continue;
            if (pitch + 2 > 127 || pitches.has(pitch + 2)) continue;
            const heads = document.querySelectorAll('.ws-score-notehead[data-occurrence="' + id + '"]');
            if (heads.length !== 1) continue;
            const rect = heads[0].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
                && rect.right > 0 && rect.left < innerWidth) return {id, pitch};
          }
          const fallback = [...document.querySelectorAll('.ws-score-notehead[data-occurrence]')]
            .find(head => { const rect = head.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight; });
          return fallback ? {id: fallback.getAttribute('data-occurrence'),
            pitch: Number(document.querySelector('.ws-roll-note[data-occurrence="' + fallback.getAttribute('data-occurrence') + '"]')?.getAttribute('data-pitch') ?? 0)} : null;
        }""")
        if not candidate:
            return {'commit': 0.01}, False
        EXPECTED['sheet_pitch'] = {'occurrence': candidate['id'], 'pitch': candidate['pitch']}
        target = candidate['id']
        select(page, target)
        page.wait_for_timeout(30)
        head = page.locator(f'.ws-score-notehead[data-occurrence="{target}"]').first
        timing = gesture(page, head, 0, -10)
        return timing, pitch(page, target) != candidate['pitch']

    def replace():
        candidate = pick_safe(page, 2)
        if not candidate:
            return {'commit': 0.01}, False
        target = candidate['id']
        before = candidate['pitch']
        EXPECTED['keyboard_replace'] = {'occurrence': target, 'pitch': before}
        select(page, target)
        page.get_by_role('button', name='Replace pitch').click()
        page.wait_for_timeout(10)
        key = page.locator(f'.keyboard-white[data-pitch="{before + 2}"], '
                           f'.keyboard-black[data-pitch="{before + 2}"]').first
        timing = click_locator(key)
        return timing, pitch(page, target) == before + 2

    def written():
        before = snapshot(page)
        candidates = pick_non_tied(page, limit=20)
        if not candidates:
            return {'commit': 0.01}, False
        for choice in candidates:
            select(page, choice['id'])
            page.wait_for_timeout(10)
            for label in ['Half', 'Whole', 'Quarter', 'Eighth']:
                button = page.get_by_role('button', name=label, exact=True)
                if not button.count() or not button.first.is_enabled():
                    continue
                ticks = {'Half': 960, 'Whole': 1920, 'Quarter': 480, 'Eighth': 240}[label]
                expected = {'occurrence': choice['id'], 'ticks': ticks}
                timing = click_locator(button.first)
                if page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'true':
                    after = snapshot(page)
                    if verify_edit('written_duration', before, after, expected):
                        EXPECTED['written_duration'] = expected
                        return timing, True
                    undo = page.get_by_role('button', name='Undo', exact=True)
                    if undo.is_enabled():
                        undo.click()
                        page.wait_for_timeout(60)
        return {'commit': 0.01}, False

    def accidental():
        target = page.locator('.ws-roll-note[data-pitch="64"]').first
        occurrence = target.get_attribute('data-occurrence')
        before = pitch(page, occurrence)
        EXPECTED['accidental'] = {'occurrence': occurrence, 'pitch': before}
        select(page, occurrence)
        page.wait_for_timeout(10)
        button = page.get_by_role('button', name='♯')
        timing = click_locator(button)
        return timing, pitch(page, occurrence) == before + 1

    def respell():
        candidate = pick_non_tied(page, enharmonic=True)
        if not candidate:
            return {'commit': 0.01}, False
        select(page, candidate['id'])
        before = facts(page)
        options = [name + str(candidate['octave']) for name in candidate['options']]
        spelling = next((option for option in options if option not in before), options[0])
        field = page.locator('.ws-row[aria-label="Respell"] input')
        field.fill(spelling)
        timing = click_locator(page.get_by_role('button', name='Apply spelling'))
        applied = page.locator('.ws-shell').get_attribute('data-workspace-dirty') == 'true'
        if applied:
            EXPECTED['respell'] = {'occurrence': candidate['id'], 'spelling': spelling}
        return timing, applied

    def add():
        EXPECTED['add_note'] = {'total': base_total}
        page.locator('[data-add="toggle"]').click()
        page.wait_for_selector('.ws-roll-add-layer')
        box = page.locator('.ws-roll-add-layer').bounding_box()
        pps = box['width'] / duration
        for seconds in (0.75, 1.25, 1.75, 5.25, 9.75):
            for fraction in (0.05, 0.2, 0.4, 0.7, 0.9):
                page.mouse.click(box['x'] + seconds * pps, box['y'] + box['height'] * fraction)
                page.wait_for_timeout(20)
                if page.locator('[data-ghost="true"]').count() and page.locator('[data-add="invalid"]').count() == 0:
                    panel = page.locator('[data-add="active"]').inner_text()
                    match = __import__('re').search(r'New (\S+) at ([0-9.]+) s.*written (\d+) ticks', panel)
                    if match:
                        EXPECTED['add_note'] = {'total': base_total, 'pitch': pitch_name_to_midi(match.group(1)),
                                                'onset': float(match.group(2)), 'ticks': int(match.group(3))}
                    timing = click_locator(page.locator('[data-add="commit"]'))
                    if total(page) == base_total + 1:
                        return timing, True
        return {'commit': 0.01}, False

    def delete():
        target = page.locator('.ws-roll-note').first.get_attribute('data-occurrence')
        EXPECTED['delete_note'] = {'occurrence': target}
        select(page, target)
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


def pitch_name_to_midi(name):
    letters = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
    letter = letters[name[0]]
    rest = name[1:]
    alter = 0
    while rest and rest[0] in '#b':
        alter += 1 if rest[0] == '#' else -1
        rest = rest[1:]
    octave = int(rest)
    return 12 * (octave + 1) + letter + alter


def performance_map_equal(left, right):
    return left.get('performance_map') == right.get('performance_map')


def verify_edit(path, before, after, expected):
    """Canonical edit verifier: exact target result and one history entry."""
    if after['past'] != before['past'] + 1:
        return False
    left, right = before['document'], after['document']
    if canonical(before) == canonical(after):
        return False
    occurrence = expected.get('occurrence')
    if path in ('roll_pitch', 'sheet_pitch', 'keyboard_replace', 'accidental'):
        old = perf_note(left, occurrence)
        new = perf_note(right, occurrence)
        if not old or not new:
            return False
        if path == 'roll_pitch' and new['pitch'] != old['pitch'] + 1:
            return False
        if path == 'sheet_pitch' and new['pitch'] == old['pitch']:
            return False
        if path == 'keyboard_replace' and new['pitch'] != expected['pitch'] + 2:
            return False
        if path == 'accidental' and new['pitch'] != expected['pitch'] + 1:
            return False
        preserved = ('onset', 'duration', 'velocity', 'confidence', 'optional', 'string', 'fret')
        if any(old[key] != new[key] for key in preserved):
            return False
        if old.get('performance_ids') != new.get('performance_ids'):
            return False
        event, note = locate(right, occurrence)
        if not event or not note or note['pitch'] != new['pitch']:
            return False
        others_before = {n['id']: n for n in left['performance'] if n['id'] != occurrence}
        others_after = {n['id']: n for n in right['performance'] if n['id'] != occurrence}
        return others_before == others_after and performance_map_equal(left, right)
    if path == 'roll_time':
        old = perf_note(left, occurrence)
        new = perf_note(right, occurrence)
        preserved = ('pitch', 'duration', 'velocity', 'confidence', 'optional', 'string', 'fret')
        return (old and new and abs(new['onset'] - old['onset']) > 1e-6
                and all(old[key] == new[key] for key in preserved)
                and {n['id']: n for n in left['performance'] if n['id'] != occurrence}
                == {n['id']: n for n in right['performance'] if n['id'] != occurrence}
                and left['events'] == right['events'] and left['segments'] == right['segments']
                and left['ties'] == right['ties'] and left['measures'] == right['measures']
                and performance_map_equal(left, right))
    if path == 'roll_resize':
        old = perf_note(left, occurrence)
        new = perf_note(right, occurrence)
        eb, _ = locate(left, occurrence)
        ea, _ = locate(right, occurrence)
        preserved = ('pitch', 'onset', 'velocity', 'confidence', 'optional', 'string', 'fret')
        return (old and new and old['duration'] is not None and new['duration'] is not None
                and abs(new['duration'] - old['duration']) > 1e-6
                and all(old[key] == new[key] for key in preserved)
                and eb['duration'] == ea['duration']
                and {n['id']: n for n in left['performance'] if n['id'] != occurrence}
                == {n['id']: n for n in right['performance'] if n['id'] != occurrence}
                and left['events'] == right['events'] and left['segments'] == right['segments']
                and left['ties'] == right['ties'] and left['measures'] == right['measures']
                and performance_map_equal(left, right))
    if path == 'written_duration':
        event, _ = locate(left, expected['occurrence'])
        new_event, _ = locate(right, expected['occurrence'])
        if not (event and new_event and new_event['duration'] == expected['ticks']
                and left['performance'] == right['performance']):
            return False
        affected = {pid for note in event['notes'] for pid in note.get('performance_ids', [])}
        def touches(value):
            return any(pid in affected for note in value['notes']
                       for pid in note.get('performance_ids', []))
        others_before = [e for e in left['events'] if not touches(e)]
        others_after = [e for e in right['events'] if not touches(e)]
        return others_before == others_after
    if path == 'respell':
        event, note = locate(left, expected['occurrence'])
        new_event, new_note = locate(right, expected['occurrence'])
        if not (note and new_note and new_note['spelling'] == expected['spelling']
                and new_note['pitch'] == note['pitch']
                and left['performance'] == right['performance']):
            return False
        affected = {pid for note in event['notes'] for pid in note.get('performance_ids', [])}
        def touches(value):
            return any(pid in affected for note in value['notes']
                       for pid in note.get('performance_ids', []))
        others_before = [e for e in left['events'] if not touches(e)]
        others_after = [e for e in right['events'] if not touches(e)]
        return others_before == others_after
    if path == 'add_note':
        before_ids = {n['id'] for n in left['performance']}
        after_ids = {n['id'] for n in right['performance']}
        if len(after_ids) != len(before_ids) + 1 or not before_ids < after_ids:
            return False
        added = (after_ids - before_ids).pop()
        note = perf_note(right, added)
        if not note or not note['id'] or added not in right['performance_map']:
            return False
        if any(n['id'] not in after_ids for n in left['performance']):
            return False
        if note['pitch'] != expected.get('pitch'):
            return False
        if abs(note['onset'] - expected.get('onset', -1)) > 1e-3:
            return False
        if not note.get('duration') or note['duration'] <= 0:
            return False
        event, _ = locate(right, added)
        if not event or event['duration'] != expected.get('ticks'):
            return False
        return True
    if path == 'delete_note':
        target = expected['occurrence']
        before_ids = {n['id'] for n in left['performance']}
        after_ids = {n['id'] for n in right['performance']}
        return (target in before_ids and target not in after_ids
                and after_ids == before_ids - {target}
                and target not in right['performance_map']
                and {n['id']: n for n in left['performance'] if n['id'] != target}
                == {n['id']: n for n in right['performance']})
    return False


def open_case(browser, draft):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', m.World(draft).route)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto(f'{BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
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
        print(f'[{label}] {path}', flush=True)
        # A fresh page per path avoids leaving modes, selections or history from a
        # previous path in the measurement.
        context, page = open_case(browser, draft)
        occurrence = (page.locator('.ws-roll-note[data-pitch="68"]').first.get_attribute('data-occurrence')
                  if page.locator('.ws-roll-note[data-pitch="68"]').count()
                  else page.locator('.ws-roll-note').first.get_attribute('data-occurrence'))
        action, has_preview = make_paths(page, occurrence, draft['duration'])[path]
        action()
        undo_all(page)
        reset_modes(page)
        rows = []
        for sample_index in range(20):
            if sample_index % 5 == 0:
                print(f'[{label}] {path} sample {sample_index}', flush=True)
            before = snapshot(page)
            before_hash = snapshot_hash(page)
            timing, _closure_applied = action()
            after = snapshot(page)
            after_hash = snapshot_hash(page)
            applied = verify_edit(path, before, after, EXPECTED.get(path, {}))
            undo_button = page.get_by_role('button', name='Undo', exact=True)
            redo_button = page.get_by_role('button', name='Redo', exact=True)
            undo_timing = click_button_timed(undo_button) if undo_button.is_enabled() else {'commit': 0.0}
            page.wait_for_timeout(40)
            undone_hash = snapshot_hash(page)
            undone = snapshot_meta(page)
            restored = (undone_hash == before_hash and undone['past'] == before['past'])
            redo_timing = click_button_timed(redo_button) if redo_button.is_enabled() else {'commit': 0.0}
            page.wait_for_timeout(40)
            redone_hash = snapshot_hash(page)
            redone = snapshot_meta(page)
            reapplied = (redone_hash == after_hash and redone['past'] == after['past'])
            if undo_button.is_enabled():
                undo_button.click()
                page.wait_for_timeout(50)
            reset_modes(page)
            rows.append({'preview': timing.get('preview'), 'commit': timing['commit'],
                         'undo': undo_timing['commit'], 'redo': redo_timing['commit'],
                         'applied': bool(applied), 'restored': bool(restored), 'reapplied': bool(reapplied),
                         'has_preview': has_preview})
        samples[path] = {
            'preview': stats([r['preview'] for r in rows]) if has_preview else None,
            'commit': stats([r['commit'] for r in rows]),
            'undo': stats([r['undo'] for r in rows]), 'redo': stats([r['redo'] for r in rows]),
            'applied': sum(1 for r in rows if r['applied']), 'restored': sum(1 for r in rows if r['restored']),
            'reapplied': sum(1 for r in rows if r['reapplied']),
        }
        context.close()
    return samples


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='chrome')
        runs = int(os.environ.get('PERF_RUNS', '3'))
        fixtures = [('real_1338', m.LONG), ('limit_5000', bench.limit_draft(5000))]
        only = os.environ.get('PERF_FIXTURE')
        if only:
            fixtures = [item for item in fixtures if item[0] == only]
        for run in range(1, runs + 1):
            run_results = {}
            for label, draft in fixtures:
                run_results[label] = run_fixture(browser, draft, label)
            RESULT[f'run{run}'] = run_results
        browser.close()

    failures = []
    for run in range(1, runs + 1):
        for label, _draft in fixtures:
            for path, data in RESULT[f'run{run}'][label].items():
                if data['applied'] != 20 or data['restored'] != 20 or data['reapplied'] != 20:
                    failures.append(f'run{run} {path}/{label}: applied {data["applied"]} restored {data["restored"]} reapplied {data["reapplied"]}')
                if data['commit']['p95'] > 100:
                    failures.append(f'run{run} {path}/{label}: commit p95 {data["commit"]["p95"]}')
                if data['undo']['p95'] > 100:
                    failures.append(f'run{run} {path}/{label}: undo p95 {data["undo"]["p95"]}')
                if data['redo']['p95'] > 100:
                    failures.append(f'run{run} {path}/{label}: redo p95 {data["redo"]["p95"]}')
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
