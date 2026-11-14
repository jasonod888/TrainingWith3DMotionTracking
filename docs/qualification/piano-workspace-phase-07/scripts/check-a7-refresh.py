"""A7: edit during the post-save manifest refresh must not navigate away."""
import asyncio
import hashlib
import json
from pathlib import Path
from playwright.async_api import async_playwright

source = Path(__file__).with_name('check-normal-route.py')
import importlib.util
spec = importlib.util.spec_from_file_location('phase7_a7', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
BASE = m.BASE
LESSON = m.LESSON
LONG = m.LONG
results = []


class World:
    def __init__(self):
        self.reference_text = None
        self.reference_sha = None
        self.revision_saved = False
        self.refreshed = False
        self.manifest = None
        self.summary = {'summary_version': 1, 'lesson_id': LESSON, 'revision_id': 'rev-a7-1',
                        'title': 'A7 revision', 'subject': 'piano', 'subject_label': 'Piano',
                        'experience_family': 'music', 'instrument': 'piano',
                        'duration': LONG['duration'], 'section_count': 1, 'poster': None,
                        'capabilities': {'preview': True, 'practice': False, 'live_input': 'none'}}
        self.set_reference({'reference_version': 1, 'duration': LONG['duration'],
                            'title': 'A7 revision', 'events': LONG['events'], 'spans': LONG['spans'],
                            'notation': LONG.get('notation'), 'alignment': LONG.get('alignment')})
        self.manifest = self.build_manifest('rev-a7-1')

    def set_reference(self, reference):
        self.reference_text = json.dumps(reference)
        self.reference_sha = hashlib.sha256(self.reference_text.encode()).hexdigest()
        self.reference = reference

    def build_manifest(self, revision):
        return {'schema_version': 2, 'experience_family': 'music', 'lesson_id': LESSON,
                'revision_id': revision, 'title': 'A7 revision', 'subject': 'piano',
                'duration': LONG['duration'], 'instrument': LONG['instrument'],
                'section_set': {'id': 'sections-a7', 'revision': 1,
                                'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0,
                                              'end': LONG['duration']}]},
                'reference': {'key': f'lessons/{LESSON}/ref.json', 'mime': 'application/json',
                              'bytes': len(self.reference_text.encode()), 'sha256': self.reference_sha},
                'reference_reviewed': True,
                'assessment': {'assessment': 'notes', 'input_modes': ['midi'],
                               'dimensions': ['pitch', 'timing'], 'rubric_version': 'piano-midi-v1'},
                'source_video': None, 'piano_preview': None, 'preview_identity': None, 'warnings': []}


async def handler_factory(world):
    async def handler(route, request):
        path = request.url.split('/api', 1)[-1].split('?')[0]

        async def body(payload, status=200):
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(payload))

        if path == '/auth/session':
            return await body({'account': {'id': 'a1', 'email': 'owner@test', 'platform_role': 'member',
                                           'status': 'active', 'mfa_enrolled': False}, 'csrf': 'x'})
        if path == '/capabilities':
            return await body({'music_piano_library_ui': True, 'music_history': True})
        if path == '/workflow/lessons':
            return await body({'lessons': []})
        if path in ('/lessons/summaries', '/shared-lessons/summaries'):
            return await body([world.summary])
        if path.endswith('/assets/ref.json'):
            return await route.fulfill(status=200, content_type='application/json', body=world.reference_text)
        if path == f'/lessons/{LESSON}':
            if world.revision_saved and not world.refreshed:
                world.refreshed = True
                await asyncio.sleep(3.0)
            return await body(world.manifest)
        if '/music-revision' in path:
            capture = json.loads(request.post_data or '{}')
            reference = {'reference_version': 1, 'duration': capture['notation']['duration'],
                         'title': capture.get('title', 'A7 revision'), 'events': capture['events'],
                         'spans': capture['spans'], 'notation': capture['notation'],
                         'alignment': capture.get('alignment')}
            world.set_reference(reference)
            world.manifest = world.build_manifest('rev-a7-2')
            world.summary = {**world.summary, 'revision_id': 'rev-a7-2'}
            world.revision_saved = True
            world.refreshed = False
            return await body({'revision_id': 'rev-a7-2'})
        return await body({}, status=404)
    return handler


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel='chrome')
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        world = World()
        await context.route('**/api/**', await handler_factory(world))
        page = await context.new_page()
        page.on('pageerror', lambda error: results.append({'error': str(error)}))
        await page.goto(f'{BASE}/?page=moves', wait_until='domcontentloaded')
        await page.wait_for_selector('.feed-card', timeout=30000)
        await page.locator('.feed-card-menu summary').first.click()
        await page.get_by_role('button', name='Edit lesson').click()
        await page.wait_for_selector('.ws-shell', timeout=45000)
        await page.wait_for_selector('.ws-roll-note', timeout=45000)
        note = page.locator('.ws-roll-note').first
        before = int(await note.get_attribute('data-pitch'))
        await note.click()
        await page.get_by_role('button', name='+ semitone').click()
        await page.get_by_label('Confirm reviewed').check()
        await page.get_by_role('button', name='Save privately').click()
        # The POST resolves and the manifest refresh is held for 0.8 s. Edit now.
        await page.wait_for_selector('text=Saved privately', timeout=30000)
        note = page.locator('.ws-roll-note').first
        await note.click()
        await page.get_by_role('button', name='+ semitone').click()
        during = int(await page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
        await page.wait_for_timeout(3600)
        after = int(await page.locator('.ws-roll-note').first.get_attribute('data-pitch'))
        reports = await page.locator('.ws-report').all_inner_texts()
        text = await page.locator('.ws-shell').inner_text()
        results.append({'name': 'A7 newer edit during manifest refresh keeps the editor mounted',
                        'passed': during != before and after == during and 'music-edit' in page.url
                                  and 'newer edits' in await page.locator('body').inner_text(),
                        'before': before, 'during': during, 'after': after,
                        'url': page.url, 'notice': 'newer edits' in await page.locator('body').inner_text(), 'reports': reports})
        await context.close()
        await browser.close()

    Path(__file__).with_name('a7-refresh-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if all(item.get('passed') for item in results) else 1)


asyncio.run(main())
