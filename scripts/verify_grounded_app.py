"""Local integration QA with a disposable owner session; never prints the token."""
import argparse
from datetime import timedelta
from pathlib import Path
import secrets
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'.venv-saas/Lib/site-packages'))
from sqlalchemy.orm import Session
from apps.api.auth import COOKIE,digest,now
from apps.api.config import Settings
from apps.api.database import Lesson,LoginSession,make_engine
from playwright.sync_api import sync_playwright,expect


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--lesson',required=True)
    a=p.parse_args();engine=make_engine(Settings().sqlalchemy_url)
    token=secrets.token_urlsafe(48);key=digest(token)
    with Session(engine) as session:
        lesson=session.get(Lesson,a.lesson)
        session.add(LoginSession(token_hash=key,account_id=lesson.owner_id,expires_at=now()+timedelta(minutes=10)))
        session.commit()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            context=browser.new_context(viewport={'width':1440,'height':1050})
            context.add_cookies([{'name':COOKIE,'value':token,'url':'http://127.0.0.1:8001','httpOnly':True,'sameSite':'Lax'}])
            page=context.new_page();errors=[];requested=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('response',lambda response:requested.append((response.url,response.status)))
            result=context.request.get(f'http://127.0.0.1:8001/api/lessons/{a.lesson}')
            assert result.status==200,result.status
            manifest=result.json();assert manifest['root_motion']=='floor-guided'
            for avatar in ('male','female'):
                asset=manifest['presentation'][avatar]
                assert context.request.get(f"http://127.0.0.1:8001/api/lessons/{a.lesson}/assets/{Path(asset['key']).name}").status==200
                page.goto(f'http://127.0.0.1:8001/avatar-lab.html?project={a.lesson}&avatar={avatar}&movement=1&follow=0&t=12.33')
                expect(page.locator('#stage-overlay')).to_be_hidden(timeout=60000)
                expect(page.locator('#project-info')).to_contain_text('Corrected source movement')
                expect(page.locator('#project-info')).to_contain_text('Mixamo body')
                page.locator('#time').fill('12.33');page.locator('#time').dispatch_event('input')
                page.screenshot(path=str(ROOT/f'.local/main-grounding-refresh/{avatar}-app-lab.png'),full_page=True)
            requested.clear()
            with page.expect_response(lambda response:'grounded-' in response.url and 'avatar-male.glb' in response.url and response.status==200,timeout=60000):
                page.goto(f'http://127.0.0.1:8001/?page=check&id={a.lesson}&instructor=male')
            page.wait_for_selector('canvas',timeout=60000)
            expect(page.get_by_text('Loading your reference...',exact=True)).to_be_hidden(timeout=60000)
            assert not page.get_by_role('alert').count(),page.get_by_role('alert').all_text_contents()
            assert any('grounded-' in url and 'avatar-male.glb' in url and status==200 for url,status in requested)
            page.screenshot(path=str(ROOT/'.local/main-grounding-refresh/main-app.png'),full_page=True)
            assert not errors,errors
            browser.close()
            print('Main app and Avatar Lab: revision assets, both corrected Mixamo bodies and source metadata verified.')
    finally:
        with Session(engine) as session:
            row=session.get(LoginSession,key)
            if row:session.delete(row);session.commit()
        engine.dispose()


if __name__=='__main__':main()
