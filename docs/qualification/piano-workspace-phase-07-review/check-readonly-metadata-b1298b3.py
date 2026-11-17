"""Approval-enabled read-only must cover authored metadata, not only reducer commands."""
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[3]
source = root / 'docs/qualification/piano-workspace-phase-07/scripts/bench-paths.py'
spec = importlib.util.spec_from_file_location('readonly_review', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
draft = m.bench.limit_draft(5000)
draft['events'] = list(draft['events']) + [dict(draft['events'][0], id='review-over-limit', onset=1000.0)]
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context = browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
    context.add_init_script('window.__PIANO_INTERACTIVE_LIMIT_APPROVED__=true')
    context.route('**/api/**',m.m.World(draft).route)
    page = context.new_page()
    m.m.open_route(page)
    assert page.locator('[data-read-only="true"]').count()==1
    field = page.get_by_label('Sync offset in seconds')
    before = field.input_value()
    dirty_before = page.locator('.ws-shell').get_attribute('data-workspace-dirty')
    enabled = field.is_enabled()
    if enabled:
        field.fill('0.5')
        field.press('Tab')
    page.wait_for_timeout(150)
    after = field.input_value()
    dirty_after = page.locator('.ws-shell').get_attribute('data-workspace-dirty')
    page.locator('[data-lesson-settings] summary').click()
    policy = page.locator('[data-assessment-policy]')
    before_policy = policy.input_value()
    if policy.is_enabled():
        policy.select_option('none' if before_policy=='notes' else 'notes')
    after_policy = policy.input_value()
    with page.expect_download() as info:
        page.get_by_role('button',name='Download reference').click()
    exported = json.loads(Path(info.value.path()).read_text(encoding='utf-8'))
    result={'read_only':True,'offset_enabled':enabled,'offset_before':before,'offset_after':after,
            'dirty_before':dirty_before,'dirty_after':dirty_after,
            'assessment_before':before_policy,'assessment_after':after_policy,
            'exported_offset':exported['authored']['offsetSeconds'],
            'exported_assessment':exported['authored']['assessment'],
            'passed':before==after and before_policy==after_policy and dirty_before==dirty_after}
    print(json.dumps(result,indent=2))
    Path(__file__).with_name('readonly-metadata-b1298b3-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    context.close();browser.close()
raise SystemExit(0 if result['passed'] else 1)
