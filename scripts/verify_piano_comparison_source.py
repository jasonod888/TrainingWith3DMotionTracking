"""Browser regressions: comparison must never silently pick a different recording."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

base='http://127.0.0.1:5173'
public={'id':'public-benchmark','label':'Public Chopin benchmark','lesson_id':None,
        'seconds':128.2,'has_reference':True}
own={'id':'uploaded-recording','label':'River flows full version','lesson_id':'new-lesson',
     'seconds':209.594,'has_reference':False}

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    results=[]
    for case in ['new-linked-lesson','existing-linked-lesson','registration-fails','no-linked-lesson']:
        context=browser.new_context()
        page=context.new_page();created=[];registrations=[]
        def api(route):
            path=route.request.url.split('/api')[-1]
            if path=='/piano-comparisons/sources' and route.request.method=='GET':
                rows=[public,own] if case=='existing-linked-lesson' else [public]
                route.fulfill(json={'sources':rows})
            elif path=='/piano-comparisons/sources':
                registrations.append(route.request.post_data_json)
                if case=='registration-fails':route.fulfill(status=409,json={'detail':'Retained source unavailable.'})
                else:route.fulfill(json=own)
            elif path=='/piano-comparisons':
                created.append(route.request.post_data_json)
                route.fulfill(status=409,json={'detail':'Test request captured; inference not started.'})
            else:route.fulfill(status=404,json={'detail':'Not found'})
        page.route('**/api/**',api)
        page.route('**/comparison-source-regression?*',lambda route:route.fulfill(
            content_type='text/html',body='<div id="root"></div><script type="module" src="/tests/fixtures/piano-comparison-source.tsx"></script>'))
        page.goto(base+'/comparison-source-regression?'+('lesson=new-lesson' if case!='no-linked-lesson' else 'empty=1'))
        select=page.get_by_role('combobox',name='Recording',exact=True)
        expect(select).to_be_enabled()
        start=page.get_by_role('button',name='Start comparison',exact=True)
        if case in ('new-linked-lesson','existing-linked-lesson'):
            expect(select).to_have_value(own['id'])
            expect(start).to_be_enabled()
            start.click()
            page.wait_for_function('document.querySelector("[role=alert]")!==null')
            assert created[0]['source_id']==own['id']
            assert len(registrations)==(1 if case=='new-linked-lesson' else 0)
        else:
            expect(select).to_have_value('')
            expect(start).to_be_disabled()
            assert not created
            if case=='registration-fails':expect(page.get_by_role('alert')).to_contain_text('Retained source unavailable')
            # An explicit user choice is allowed; silence must never choose this row.
            select.select_option(public['id'])
            expect(start).to_be_enabled()
        results.append({'case':case,'passed':True})
        context.close()
    browser.close()
out=Path('.local/piano-comparison-source-fix');out.mkdir(exist_ok=True)
(out/'browser-regressions.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
