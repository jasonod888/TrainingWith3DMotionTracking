"""Phase 8: formatted score from the same document, mode switch preservation, MusicXML."""
import importlib.util
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SCRIPTS = ROOT / 'docs/qualification/piano-workspace-phase-07/scripts'
CAPTURES = ROOT / 'docs/qualification/piano-workspace-phase-08/captures'
CAPTURES.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('phase8_route', SCRIPTS / 'check-normal-route.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)



class SaveWorld(m.World):
    """World that models a successful private save so the saved-only route can reopen it."""

    def route(self, route, request):
        path = request.url.split('/api', 1)[-1].split('?')[0]
        if '/music-draft/review' in path:
            body = json.loads(request.post_data or '{}')
            notation = body.get('notation')
            reference = {'reference_version': 1, 'duration': notation['duration'],
                         'title': body.get('title', 'Saved'), 'events': body['events'],
                         'spans': body['spans'], 'notation': notation,
                         'alignment': body.get('alignment')}
            self.reference = reference
            self.reference_text = json.dumps(reference)
            reference_sha = __import__('hashlib').sha256(self.reference_text.encode('utf-8')).hexdigest()
            self.manifest = {'schema_version': 2, 'experience_family': 'music',
                             'lesson_id': m.LESSON, 'revision_id': 'rev-saved-1',
                             'title': body.get('title', 'Saved'), 'subject': 'piano',
                             'duration': reference['duration'], 'instrument': m.LONG['instrument'],
                             'section_set': {'id': 'sections-saved-1', 'revision': 1,
                                             'sections': [{'id': 'whole', 'label': 'Whole lesson',
                                                           'start': 0, 'end': reference['duration']}]},
                             'reference': {'key': f'lessons/{m.LESSON}/ref.json', 'mime': 'application/json',
                                           'bytes': len(self.reference_text.encode('utf-8')),
                                           'sha256': reference_sha},
                             'reference_reviewed': True,
                             'assessment': {'assessment': 'notes', 'input_modes': ['midi'],
                                            'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'},
                             'source_video': None, 'piano_preview': None, 'preview_identity': None,
                             'warnings': []}
            self.summaries = [{**item, 'revision_id': 'rev-saved-1'} for item in self.summaries]
            return self.json(route, {'revision_id': 'rev-saved-1'})
        return super().route(route, request)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    world = SaveWorld(m.LONG)
    context.route('**/api/**', world.route)
    page = context.new_page(); page.set_default_timeout(20000)
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    page.wait_for_selector('[data-roll-toggle]')
    if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        page.locator('[data-roll-toggle]').click()
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    occurrence = page.locator('.ws-roll-note[data-pitch="64"]').first.get_attribute('data-occurrence')
    node = page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]')
    box = node.bounding_box(); node.dispatch_event(
        'pointerdown', {'pointerId': 41, 'pointerType': 'mouse', 'button': 0,
                        'clientX': box['x'] + 4, 'clientY': box['y'] + box['height'] / 2})
    node.dispatch_event('pointerup', {'pointerId': 41, 'pointerType': 'mouse'})
    page.get_by_role('button', name='+ semitone', exact=True).click()
    page.get_by_role('button', name='Quarter', exact=True).click()
    respell = page.locator('.ws-row[aria-label="Respell"] input')
    respell.fill('E#4')
    page.get_by_role('button', name='Apply spelling').click()
    page.wait_for_timeout(250)
    after_edits = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    selection_before = after_edits['selection']
    window_before = {
        'start': page.locator('.ws-roll-svg').get_attribute('data-roll-window-start'),
        'span': page.locator('.ws-roll-svg').get_attribute('data-roll-window-span'),
    }
    canonical_before = json.dumps(after_edits['document'], sort_keys=True)
    target_event = next(event for event in after_edits['document']['events']
                        if any(occurrence in note['performance_ids'] for note in event['notes']))
    target_note = next(note for note in target_event['notes'] if occurrence in note['performance_ids'])
    measure_index = max(measure['index'] for measure in after_edits['document']['measures']
                        if measure['start'] <= target_event['start'])
    xml_measure = measure_index + 1
    xml_staff = '1' if target_event['staff'] == 'treble' else '2'
    xml_voice = str(target_event['voice'])
    page.locator('[data-formatted-toggle]').click()
    page.wait_for_selector('[data-formatted-page="1"]')
    after_switch = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    assert json.dumps(after_switch['document'], sort_keys=True) == canonical_before
    pages = page.locator('[data-formatted-page]').count()
    systems = page.locator('[data-formatted-system]').count()
    selected = page.locator('.ws-formatted g.is-selected').count()
    assert pages >= 1 and systems >= 1
    assert selected >= 1, 'corrected occurrence should remain selected in formatted view'
    corrected = page.locator('.ws-formatted g.is-selected [data-pitch="65"]')
    assert corrected.count() >= 1, 'corrected pitch should appear in formatted view'
    assert corrected.first.get_attribute('data-spelling') == 'E#4'
    assert corrected.first.get_attribute('data-formatted-value') == 'quarter'
    broken_ties = page.locator('.formatted-tie.is-broken').count()
    assert broken_ties >= 1, 'expected at least one tie continued across a system/page break'
    page.screenshot(path=str(CAPTURES / 'formatted-real-page1.png'), full_page=False)
    page.locator('[data-formatted-page="2"]').scroll_into_view_if_needed()
    page.screenshot(path=str(CAPTURES / 'formatted-real-page2.png'), full_page=False)
    # MusicXML export carries the corrected pitch, spelling and written duration.
    with page.expect_download() as download_info:
        page.get_by_role('button', name='MusicXML').click()
    xml = Path(download_info.value.path()).read_text(encoding='utf-8')
    root = ET.fromstring(xml)
    matched = []
    for measure in root.findall('.//part/measure'):
        if measure.get('number') != str(xml_measure):
            continue
        for note in measure.findall('note'):
            staff = note.findtext('staff') or '1'
            voice = note.findtext('voice') or '1'
            step = note.findtext('pitch/step')
            alter = note.findtext('pitch/alter') or '0'
            octave = note.findtext('pitch/octave')
            if (staff == xml_staff and voice == xml_voice and step == 'E'
                    and alter == '1' and octave == '4'):
                matched.append(note)
    assert len(matched) == 1, (xml_measure, xml_staff, xml_voice, len(matched))
    assert matched[0].findtext('type') == 'quarter'
    assert matched[0].findall('tie') == [], 'edited note should not gain a spurious tie'
    # Return to correction restores selection and viewport, with no document change.
    page.get_by_role('button', name='Return to correction').click()
    page.wait_for_selector('.ws-roll-note', timeout=60000)
    after_return = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
    assert json.dumps(after_return['document'], sort_keys=True) == canonical_before
    assert after_return['selection'] == selection_before
    window_after = {
        'start': page.locator('.ws-roll-svg').get_attribute('data-roll-window-start'),
        'span': page.locator('.ws-roll-svg').get_attribute('data-roll-window-span'),
    }
    assert window_after == window_before, (window_before, window_after)
    target = page.locator(f'.ws-roll-note[data-occurrence="{occurrence}"]')
    assert target.get_attribute('data-pitch') == '65'
    # Saved private reference carries the same corrected authored state.
    page.get_by_label('Confirm reviewed').check()
    page.get_by_role('button', name='Save privately').click()
    page.wait_for_selector('text=Saved privately', timeout=30000)
    saved_notation = world.reference['notation']
    saved_event = next(note for event in saved_notation['events'] for note in event['notes']
                       if occurrence in note['performance_ids'])
    assert saved_event['pitch'] == 65
    assert saved_event['spelling'] == 'E#4'
    assert any(event['duration'] == 480 and any(occurrence in note['performance_ids'] for note in event['notes'])
               for event in saved_notation['events'])
    assert json.loads(world.reference_text)['notation']['events'] == saved_notation['events']
    page.goto(f'{m.BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    try:
        page.wait_for_selector('text=Opened saved revision', timeout=30000)
        page.wait_for_selector('[data-roll-toggle]')
        if page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
            page.locator('[data-roll-toggle]').click()
        page.wait_for_selector('.ws-roll-note', timeout=60000)
        reopened = page.evaluate('() => window.__pianoWorkspaceSnapshot()')
        reopened_event = next(note for event in reopened['document']['events'] for note in event['notes']
                              if occurrence in note['performance_ids'])
        assert reopened_event['pitch'] == 65
        assert reopened_event['spelling'] == 'E#4'
        assert any(event['duration'] == 480 and any(occurrence in note['performance_ids'] for note in event['notes'])
                   for event in reopened['document']['events'])
        reopened_saved = True
    except Exception as error:
        print('REOPEN_FAILED', repr(error), page.locator('body').inner_text()[:600])
        raise
    page.locator('[data-formatted-toggle]').click()
    page.wait_for_selector('[data-formatted-page="1"]')
    assert page.locator('.ws-formatted [data-pitch="65"][data-spelling="E#4"]').count() >= 1
    result = {'occurrence': occurrence, 'pages': pages, 'systems': systems,
              'selected_in_formatted': selected, 'musicxml': True,
              'selection_restored': True, 'window_before': window_before,
              'window_after': window_after, 'document_unchanged': True,
              'saved_reference_agrees': True, 'saved_reopened': True, 'broken_ties': broken_ties}
    (ROOT / 'docs/qualification/piano-workspace-phase-08/phase8-formatted.json').write_text(
        json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))
    context.close(); browser.close()
