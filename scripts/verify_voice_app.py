"""Live QA with synthetic microphone input and a disposable local owner session."""
from pathlib import Path
from datetime import timedelta
import secrets
import sys
import re

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'.venv-saas/Lib/site-packages'))
from apps.api.config import Settings
from apps.api.database import Lesson,LoginSession,PracticeProgress,make_engine
from apps.api.auth import COOKIE,digest,now
from sqlalchemy.orm import Session
from playwright.sync_api import sync_playwright,expect

if __name__=='__main__':
    lesson_id='5223066d0aef4d39aa81b6b3011e085f';engine=make_engine(Settings().sqlalchemy_url)
    token=secrets.token_urlsafe(48);key=digest(token)
    with Session(engine) as session:
        lesson=session.get(Lesson,lesson_id)
        owner_id=lesson.owner_id
        progress=session.get(PracticeProgress,(owner_id,lesson_id))
        saved_progress={column.name:getattr(progress,column.name) for column in PracticeProgress.__table__.columns} if progress else None
        session.add(LoginSession(token_hash=key,account_id=lesson.owner_id,expires_at=now()+timedelta(minutes=10)));session.commit()
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
                f'--use-file-for-fake-audio-capture={ROOT/".local/voice-qa/microphone.wav"}'])
            context=browser.new_context(viewport={'width':1450,'height':1100},permissions=['microphone'])
            context.add_cookies([{'name':COOKIE,'value':token,'url':'http://127.0.0.1:8001','httpOnly':True,'sameSite':'Lax'}])
            context.add_init_script('''window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;
                window.testVoiceStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);window.testVoiceStreams.push(stream);return stream;};''')
            page=context.new_page();errors=[];recognized=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            def response(r):
                if '/voice/recognize' in r.url:
                    recognized.append(r.json());print('Recognized:',recognized[-1],flush=True)
            page.on('response',response)
            page.goto(f'http://127.0.0.1:8001/?page=practice&id={lesson_id}')
            page.get_by_role('button',name=re.compile('Speed$')).click(timeout=60000)
            page.get_by_role('button',name='1×',exact=True).click()
            page.get_by_role('button',name='More',exact=True).click(timeout=60000)
            page.get_by_role('button',name='Sound & voice',exact=True).click()
            page.get_by_label('Allow voice service').check()
            page.get_by_role('button',name='Enable voice',exact=True).click()
            expect(page.get_by_role('dialog',name='Sound & voice')).to_be_hidden(timeout=30000)
            expect(page.get_by_text('Voice listening',exact=False)).to_be_visible(timeout=30000)
            page.wait_for_timeout(14000)
            assert any(r.get('text')=='pause' for r in recognized),recognized
            assert any(r.get('text')=='play' for r in recognized),recognized
            speed_label=page.locator('button[aria-label$="Speed"]').get_attribute('aria-label')
            assert speed_label.startswith('0.75'),speed_label
            assert not errors,errors
            page.screenshot(path=str(ROOT/'.local/voice-qa/practice-voice.png'),full_page=True)
            page.get_by_role('button',name='More',exact=True).click()
            page.get_by_role('button',name='Sound & voice',exact=True).click()
            page.get_by_role('button',name='Voice listening · turn off',exact=True).click()
            assert not page.get_by_text('Voice listening',exact=True).count()
            assert page.evaluate('testVoiceStreams.length>0&&testVoiceStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
            browser.close();print('Live microphone capture, local recognition, panel close, commands and stop passed.')
    finally:
        with Session(engine) as session:
            progress=session.get(PracticeProgress,(owner_id,lesson_id))
            if progress:session.delete(progress);session.flush()
            if saved_progress:session.add(PracticeProgress(**saved_progress))
            row=session.get(LoginSession,key)
            if row:session.delete(row)
            session.commit()
        engine.dispose()
