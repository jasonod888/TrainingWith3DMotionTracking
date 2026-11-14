"""Controlled verification decisions through the real normal-route workspace UI."""
import copy
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('phase7_verify_source',source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
fixture=json.loads((ROOT/'docs/qualification/piano-workspace-phase-01/fixtures/phase1-draft-fixture.json').read_text())
fixture.update(lesson_id=m.LESSON,title='Verification fixture')
results=[]

def finding(merge=False):
    events={e['id']:e for e in fixture['events']}
    ids=['fx-08','fx-09'] if merge else ['fx-01']
    return {'id':'merge-1' if merge else 'pitch-1','kind':'duplicate' if merge else 'pitch',
        'status':'suggested','pitch':60,'time_range':[0,3], 'explanation':'Controlled valid correction',
        'event_ids':ids,'evidence':{},'alternatives':[],'ambiguous':False,'ambiguity_reasons':[],
        'proposed_edits':[{'op':'merge' if merge else 'set_pitch','event_ids':ids,
            'before':[events[i] for i in ids] if merge else {'pitch':60},
            'after':{'pitch':60,'onset':2,'duration':0.5} if merge else {'pitch':62}}]}

class VerifyWorld(m.World):
    def __init__(self,merge=False):
        super().__init__(fixture);self.finding=finding(merge);self.decision=None
    def state(self):
        events=copy.deepcopy(fixture['events']);f=self.finding
        if self.decision=='accepted':
            if f['id']=='merge-1':
                merged={**events[7],'id':'vf-merge-1-m'}
                events=[e for e in events if e['id'] not in ('fx-08','fx-09')]+[merged]
            else: events[0]['pitch']=62
        decisions=[] if self.decision is None else [{'finding_id':f['id'],'decision':self.decision,
            'decided_at':'2026-11-14T12:00:00Z','report_sha256':'c'*64,'edits':f['proposed_edits'] if self.decision=='accepted' else []}]
        return {'schema_version':1,'available':True,'draft_id':'draft-1','lesson_id':m.LESSON,
            'proposal_sha256':'b'*64,'report_proposal_sha256':'b'*64,'report_sha256':'c'*64,
            'stale':False,'report_error':None,'invalid_working':None,'decisions':decisions,'events':events,
            'conflicts':[],'state_token':('d' if self.decision else 'e')*64,
            'report':{'schema_version':1,'verifier_version':'controlled-fixture','mode':'piano','status':'complete',
                'source':{'proposal_sha256':'b'*64,'audio_sha256':None},'findings':[f],'summary':{}}}
    def route(self,route,request):
        if '/music-analysis/verification?' in request.url:return self.json(route,self.state())
        if '/music-draft/verification-decision' in request.url:
            self.decision=json.loads(request.post_data)['decision'];return self.json(route,self.state())
        return super().route(route,request)

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    def open_world(merge=False):
        context=browser.new_context(viewport={'width':1440,'height':1000})
        world=VerifyWorld(merge);context.route('**/api/**',world.route)
        page=context.new_page();m.open_route(page)
        page.locator('[data-lesson-settings] summary').click()
        page.wait_for_selector('[data-finding]')
        return context,page,world
    def pitch(page):return int(page.locator('.ws-roll-note[data-occurrence="fx-01"]').get_attribute('data-pitch'))
    context,page,world=open_world()
    page.locator('.ws-roll-note[data-occurrence="fx-01"]').click()
    page.get_by_role('button',name='+ semitone',exact=True).click()
    before=pitch(page)
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(200)
    results.append({'name':'finding-does-not-overwrite-manual-pitch','passed':pitch(page)==before,
                    'local_before':before,'local_after':pitch(page),'proposal_before':60,'proposal_after':62})
    context.close()

    context,page,world=open_world()
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(200)
    accepted=pitch(page)
    page.locator('[data-verification-reject]').click();page.wait_for_timeout(200)
    results.append({'name':'reject-after-accept-reconciles-working-document','passed':pitch(page)==60,
                    'accepted_pitch':accepted,'rejected_pitch':pitch(page),'server_pitch':world.state()['events'][0]['pitch']})
    context.close()

    context,page,world=open_world(True)
    before=int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    page.locator('[data-verification-accept]').click();page.wait_for_timeout(200)
    after=int(page.locator('.ws-roll-svg').get_attribute('data-total-notes'))
    results.append({'name':'merge-is-atomic-and-retains-merged-note','passed':after==before-1,
                    'before':before,'after':after,'expected':before-1,'server_count':len(world.state()['events'])})
    context.close();browser.close()
Path(__file__).with_name('verification-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print(json.dumps(results,indent=2))
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
