"""Bounded pending-decision races with an async Playwright route (no threads)."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[4]
helper = ROOT / 'docs/qualification/piano-workspace-phase-07-review/check-verification.py'
prefix = helper.read_text(encoding='utf-8').split('\nwith sync_playwright() as pw:')[0]
# Execute the shared fixtures with the helper's own __file__ so its ROOT resolves.
namespace = {'__file__': str(helper)}
exec(compile(prefix, str(helper), 'exec'), namespace)
m = namespace['m']
VerifyWorld = namespace['VerifyWorld']

BASE = 'http://127.0.0.1:5173'
results = []


class AsyncWorld(VerifyWorld):
    conflict = False


async def handler_factory(world):
    async def handler(route, request):
        path = request.url.split('/api', 1)[-1].split('?')[0]

        async def body(payload, status=200):
            await route.fulfill(status=status, content_type='application/json', body=json.dumps(payload))

        if path == '/auth/session':
            return await body({'account': {'id': 'account-1', 'email': 'owner@test',
                                           'platform_role': 'member', 'status': 'active',
                                           'mfa_enrolled': False}, 'csrf': 'x'})
        if path == '/capabilities':
            return await body({'subject_filter': False, 'music_midi_setup': False, 'music_history': True,
                               'music_piano_library_ui': True, 'music_guitar_library_ui': True})
        if path == '/workflow/lessons':
            return await body({'lessons': []})
        if path in ('/lessons/summaries', '/shared-lessons/summaries'):
            return await body([])
        if 'music-analysis/verification' in request.url:
            return await body(world.state())
        if 'music-draft/verification-decision' in request.url:
            if world.conflict:
                return await body({'detail': 'Verification changed on another device.'}, status=409)
            world.decision = json.loads(request.post_data)['decision']
            payload = world.state()
            await asyncio.sleep(0.7)
            return await body(payload)
        if path == f'/lessons/{m.LESSON}/music-draft':
            fixture = world.draft
            return await body({**fixture, 'draft_id': 'draft-1', 'status': 'draft',
                               'reference': {**fixture['reference'], 'sha256': 'b' * 64}})
        return await body({}, status=404)
    return handler


async def open_world(browser, conflict=False):
    context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
    world = AsyncWorld()
    world.conflict = conflict
    await context.route('**/api/**', await handler_factory(world))
    page = await context.new_page()
    await page.goto(f'{BASE}/?page=music-review&id={m.LESSON}', wait_until='domcontentloaded')
    await page.wait_for_selector('[data-roll-toggle]', timeout=45000)
    if await page.locator('[data-roll-toggle]').get_attribute('aria-expanded') == 'false':
        await page.locator('[data-roll-toggle]').click()
    await page.wait_for_selector('.ws-roll-note', timeout=45000)
    await page.locator('[data-lesson-settings] summary').click()
    await page.wait_for_selector('[data-finding]')
    return context, page, world


def pitch(page):
    return page.locator('.ws-roll-note[data-occurrence="fx-01"]')


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel='chrome')

        context, page, world = await open_world(browser)
        await page.locator('[data-verification-accept]').click()
        await page.wait_for_timeout(120)
        await pitch(page).click()
        await page.get_by_role('button', name='+ semitone', exact=True).click()
        manual = int(await pitch(page).get_attribute('data-pitch'))
        await page.wait_for_timeout(1300)
        after = int(await pitch(page).get_attribute('data-pitch'))
        results.append({'name': 'A2 related edit during pending decision is preserved',
                        'passed': after == manual and manual == 61, 'manual': manual, 'after': after})
        await context.close()

        context, page, world = await open_world(browser)
        other = page.locator('.ws-roll-note').nth(1)
        other_id = await other.get_attribute('data-occurrence')
        await page.locator('[data-verification-accept]').click()
        await page.wait_for_timeout(120)
        await other.click()
        await page.get_by_role('button', name='+ semitone', exact=True).click()
        unrelated = int(await page.locator(f'.ws-roll-note[data-occurrence="{other_id}"]').get_attribute('data-pitch'))
        await page.wait_for_timeout(1300)
        target = int(await pitch(page).get_attribute('data-pitch'))
        unrelated_after = int(await page.locator(f'.ws-roll-note[data-occurrence="{other_id}"]').get_attribute('data-pitch'))
        results.append({'name': 'A3 unrelated edit during pending decision is preserved and target applies',
                        'passed': unrelated_after == unrelated and target == 62,
                        'unrelated': unrelated, 'unrelated_after': unrelated_after, 'target': target})
        await context.close()

        context, page, world = await open_world(browser, conflict=True)
        before = int(await pitch(page).get_attribute('data-pitch'))
        await page.locator('[data-verification-accept]').click()
        await page.wait_for_timeout(700)
        retained = int(await pitch(page).get_attribute('data-pitch')) == before
        reported = await page.get_by_text('another device').count() > 0
        results.append({'name': 'A4 conflict keeps the document and reports the conflict',
                        'passed': retained and reported, 'before': before,
                        'after': int(await pitch(page).get_attribute('data-pitch'))})
        await context.close()
        await browser.close()

    Path(__file__).with_name('async-race-results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if all(item['passed'] for item in results) else 1)


asyncio.run(main())
