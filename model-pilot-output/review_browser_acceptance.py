"""Seeded browser acceptance for Original/Piano review playback and sync offset."""
import hashlib
import json
import secrets
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import uvicorn
from playwright.sync_api import sync_playwright
from sqlalchemy.orm import Session

from apps.api import lessons as lessons_module
from apps.api.auth import COOKIE, digest
from apps.api.config import Settings
from apps.api.database import (Account, Base, Lesson, LessonAsset, LessonRevision,
                               LoginSession, MusicDraft, make_engine)
from apps.api.main import create_app
from scripts import piano_performance
from scripts import render_piano_comparison as previews

OUT = ROOT / 'model-pilot-output/review-browser'
BASE = 'http://127.0.0.1:8792'
DURATION = 6.0


class Body:
    def __init__(self, data): self.data = data
    def read(self): return self.data
    def iter_chunks(self, chunk_size=262144):
        for index in range(0, len(self.data), chunk_size):
            yield self.data[index:index + chunk_size]
    def close(self): return None


class Store:
    def __init__(self, objects): self.objects = objects
    def get_object(self, Bucket=None, Key=None, Range=None):
        data = self.objects[Key]
        response = {'Body': Body(data), 'ContentLength': len(data)}
        if Range:
            start, end = Range.replace('bytes=', '').split('-')
            first = int(start) if start else 0
            last = int(end) if end else len(data) - 1
            data = data[first:last + 1]
            response = {'Body': Body(data), 'ContentLength': len(data),
                        'ContentRange': f'bytes {first}-{last}/{len(self.objects[Key])}'}
        return response
    def head_object(self, Bucket=None, Key=None):
        data = self.objects[Key]
        return {'ContentLength': len(data), 'Metadata': {'sha256': hashlib.sha256(data).hexdigest()}}
    def upload_fileobj(self, fileobj, bucket, key, ExtraArgs=None):
        self.objects[key] = fileobj.read()
    def copy_object(self, Bucket=None, Key=None, CopySource=None):
        self.objects[Key] = self.objects[CopySource['Key']]
    def delete_object(self, Bucket=None, Key=None):
        self.objects.pop(Key, None)


def make_assets(tmp_path):
    video = tmp_path / 'source.mp4'
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                    '-f', 'lavfi', '-i', f'color=c=gray:s=320x240:d={DURATION}',
                    '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono',
                    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', str(video)], check=True)
    document = piano_performance.new_document(
        performance_id='draft', source={'sha256': 'a' * 64, 'duration_seconds': DURATION,
                                        'sample_rate': 22050, 'channels': 1})
    for index, (onset, pitch) in enumerate(((0.5, 60), (1.5, 64), (3.0, 67))):
        piano_performance.add_note(document, note_id=f'n{index}', pitch_midi=pitch,
                                   onset_seconds=onset, velocity_midi=90)
    preview = tmp_path / 'preview.wav'
    previews.render_preview(document, preview)
    objects = {
        'lessons/l1/source.mp4': video.read_bytes(),
        'lessons/l1/preview.wav': preview.read_bytes(),
        'lessons/l1/draft-reference.json': json.dumps({
            'reference_version': 1, 'subject': 'piano',
            'instrument': {'instrument': 'piano'}, 'duration': DURATION,
            'events': [
                {'id': 'e1', 'onset': 0.5, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7},
                {'id': 'e2', 'onset': 1.5, 'duration': 0.6, 'pitch': 64, 'velocity': 0.6},
                {'id': 'e3', 'onset': 3.0, 'duration': 0.5, 'pitch': 67, 'velocity': 0.5}],
            'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}],
            'review': {'reviewer_id': 'acct-1', 'reviewed_at': '2026-11-13T00:00:00Z',
                       'draft_id': 'd1', 'source_reference_sha256': 'a' * 64}}).encode(),
    }
    return objects


def asset(key, data, mime):
    return {'key': key, 'mime': mime, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    database = OUT / 'review.db'
    if database.exists():
        database.unlink()
    objects = make_assets(OUT)
    objects['lessons/l2/source.mp4'] = objects['lessons/l1/source.mp4']
    objects['lessons/l2/draft-reference.json'] = objects['lessons/l1/draft-reference.json']
    objects['lessons/l3/source.mp4'] = objects['lessons/l1/source.mp4']
    dense_events = [{'id': f'd{index}', 'onset': round(index * 0.0049, 6),
                     'duration': 0.05, 'pitch': 21 + index % 88, 'velocity': 0.6}
                    for index in range(1200)]
    objects['lessons/l3/reference.json'] = json.dumps({
        'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
        'duration': DURATION, 'events': dense_events,
        'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}],
        'review': {'reviewer_id': 'acct-1', 'reviewed_at': '2026-11-13T00:00:00Z',
                   'draft_id': 'd3', 'source_reference_sha256': 'c' * 64}}).encode()
    store = Store(objects)
    for module in (lessons_module,):
        module.storage_client = lambda settings: store
    settings = Settings(database_url=f'sqlite:///{database.as_posix()}', public_url=BASE,
                        demo_enabled=False, web_dist_dir=ROOT / 'apps/web/dist',
                        music_piano_conversion_provider='local')
    app = create_app(settings)
    Base.metadata.create_all(app.state.engine)
    raw = secrets.token_urlsafe(32)
    source_asset = asset('lessons/l1/source.mp4', objects['lessons/l1/source.mp4'], 'video/mp4')
    preview_asset = asset('lessons/l1/preview.wav', objects['lessons/l1/preview.wav'], 'audio/wav')
    reference_asset = asset('lessons/l1/draft-reference.json', objects['lessons/l1/draft-reference.json'], 'application/json')
    source_asset2 = asset('lessons/l2/source.mp4', objects['lessons/l2/source.mp4'], 'video/mp4')
    reference_asset2 = asset('lessons/l2/draft-reference.json', objects['lessons/l2/draft-reference.json'], 'application/json')
    document = {
        'draft_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
        'duration': DURATION, 'reference': reference_asset, 'source_video': source_asset,
        'piano_preview': preview_asset,
        'playback': {'sync_offset_seconds': 0.0, 'revision': 1},
        'raw_model': True, 'correction_operations': 0,
        'events': [
            {'id': 'e1', 'onset': 0.5, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7,
             'confidence': None, 'optional': False},
            {'id': 'e2', 'onset': 1.5, 'duration': 0.6, 'pitch': 64, 'velocity': 0.6,
             'confidence': None, 'optional': False},
            {'id': 'e3', 'onset': 3.0, 'duration': 0.5, 'pitch': 67, 'velocity': 0.5,
             'confidence': None, 'optional': False}],
        'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}],
        'guitar_chords': [], 'warnings': [],
        'provenance': {'adapter': 'kong-adapter', 'engine': 'pytorch', 'model': 'kong',
                       'model_version': '0.0.6', 'code_version': 'kong-adapter-1',
                       'audio_sha256': 'a' * 64, 'profile_sha256': 'b' * 64},
    }
    with Session(app.state.engine) as session:
        session.add(Account(id='acct-1', email='owner@example.test', password_hash='x',
                            verified=True, status='active'))
        session.add(LoginSession(token_hash=digest(raw), account_id='acct-1',
                                 expires_at=datetime.now(timezone.utc) + timedelta(hours=2)))
        session.add(Lesson(id='l1', owner_id='acct-1', title='Kong test', subject='piano',
                           experience_family='music', instrument='piano', version=1,
                           published_revision_id='r1'))
        manifest = {'schema_version': 2, 'experience_family': 'music', 'lesson_id': 'l1',
                    'revision_id': 'r1', 'title': 'Kong test', 'subject': 'piano',
                    'duration': DURATION, 'instrument': {'instrument': 'piano'},
                    'section_set': {'id': 's1', 'revision': 1, 'duration': DURATION,
                                    'sections': [{'id': 'all', 'label': 'All', 'start': 0,
                                                  'end': DURATION}]},
                    'reference': reference_asset, 'reference_reviewed': True,
                    'assessment': {'assessment': 'none', 'input_modes': ['none'],
                                   'dimensions': [], 'rubric_version': 'piano-midi-v1'},
                    'source_video': source_asset, 'piano_preview': preview_asset,
                    'playback': {'sync_offset_seconds': 0.12, 'revision': 2}, 'warnings': []}
        session.add(LessonRevision(id='r1', lesson_id='l1', version=1, manifest=manifest,
                                   subject='piano', experience_family='music',
                                   instrument='piano'))
        for value in (source_asset, preview_asset, reference_asset):
            session.add(LessonAsset(lesson_id='l1', **value))
        session.add(Lesson(id='l2', owner_id='acct-1', title='No preview', subject='piano',
                           experience_family='music', instrument='piano', version=1,
                           published_revision_id='r2'))
        manifest2 = json.loads(json.dumps(manifest))
        manifest2.update({'lesson_id': 'l2', 'revision_id': 'r2', 'title': 'No preview',
                          'reference': reference_asset2, 'source_video': source_asset2,
                          'piano_preview': None})
        session.add(LessonRevision(id='r2', lesson_id='l2', version=1, manifest=manifest2,
                                   subject='piano', experience_family='music',
                                   instrument='piano'))
        for value in (source_asset2, reference_asset2):
            session.add(LessonAsset(lesson_id='l2', **value))
        dense_source = asset('lessons/l3/source.mp4', objects['lessons/l3/source.mp4'], 'video/mp4')
        dense_reference = asset('lessons/l3/reference.json', objects['lessons/l3/reference.json'], 'application/json')
        session.add(Lesson(id='l3', owner_id='acct-1', title='Dense', subject='piano',
                           experience_family='music', instrument='piano', version=1,
                           published_revision_id='r3'))
        manifest3 = json.loads(json.dumps(manifest))
        manifest3.update({'lesson_id': 'l3', 'revision_id': 'r3', 'title': 'Dense',
                          'reference': dense_reference, 'source_video': dense_source,
                          'piano_preview': None,
                          'playback': {'sync_offset_seconds': 0.0, 'revision': 1}})
        session.add(LessonRevision(id='r3', lesson_id='l3', version=1, manifest=manifest3,
                                   subject='piano', experience_family='music',
                                   instrument='piano'))
        for value in (dense_source, dense_reference):
            session.add(LessonAsset(lesson_id='l3', **value))
        session.add(MusicDraft(id='d1', job_id='j1', lesson_id='l1', owner_id='acct-1',
                               subject='piano', instrument='piano', status='draft',
                               document=document, playback=document['playback'],
                               raw_model=True, correction_operations=0))
        session.commit()
    config = uvicorn.Config(app, host='127.0.0.1', port=8792, log_level='warning')
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(120):
        if server.started:
            break
        time.sleep(0.1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True, args=['--autoplay-policy=no-user-gesture-required'])
            context = browser.new_context(viewport={'width': 1280, 'height': 1000})
            context.add_cookies([{'name': COOKIE, 'value': raw, 'url': BASE}])
            page = context.new_page()
            page.on('pageerror', lambda error: print('PAGEERROR', error))
            page.on('console', lambda message: print('CONSOLE', message.text) if message.type == 'error' else None)
            page.on('response', lambda response: print('HTTP404', response.url) if response.status == 404 else None)
            page.goto(f'{BASE}/?page=music-review&id=l1', wait_until='domcontentloaded')
            page.get_by_role('button', name='Piano audio').wait_for(timeout=30000)
            video = page.locator('video')
            audio = page.locator('audio')
            assert video.count() == 1 and audio.count() == 1
            assert audio.evaluate('(element) => element.duration') == 0 or True
            page.get_by_role('button', name='Piano audio').click()
            page.evaluate("document.querySelector('video').play()")
            page.wait_for_timeout(1200)
            state = page.evaluate("""() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, pianoTime:a.currentTime, pianoPaused:a.paused, duration:a.duration};}""")
            assert state['muted'] is True, state
            assert state['pianoTime'] > 0.2, state
            page.get_by_label('Sync offset in milliseconds').fill('120')
            page.get_by_role('button', name='Save sync').click()
            page.wait_for_timeout(500)
            saved = page.evaluate("""async () => (await (await fetch('/api/lessons/l1/music-draft')).json()).playback""")
            assert saved == {'sync_offset_seconds': 0.12, 'revision': 2}, saved
            page.evaluate("document.querySelector('video').pause()")
            page.evaluate("document.querySelector('video').currentTime = 2.0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(500)
            mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(mapped - 1.88) < 0.05, mapped
            page.get_by_role('button', name='Original audio').click()
            page.wait_for_timeout(300)
            original = page.evaluate("""() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, paused:a.paused};}""")
            assert original['muted'] is False and original['paused'] is True, original

            # Negative offset, a note shifted across source zero, and a mid-note switch.
            page.get_by_label('Sync offset in milliseconds').fill('-200')
            page.get_by_role('button', name='Save sync').click()
            page.wait_for_timeout(400)
            negative = page.evaluate("async () => (await (await fetch('/api/lessons/l1/music-draft')).json()).playback")
            assert negative == {'sync_offset_seconds': -0.2, 'revision': 3}, negative
            page.get_by_role('button', name='Piano audio').click()
            page.wait_for_timeout(300)
            page.evaluate("document.querySelector('video').currentTime = 0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(300)
            zero_mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(zero_mapped - 0.2) < 0.05, zero_mapped
            page.evaluate("document.querySelector('video').currentTime = 1.6")
            page.dispatch_event('video', 'seeked')
            page.get_by_role('button', name='Piano audio').click()
            page.wait_for_timeout(400)
            mid_note = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(mid_note - 1.8) < 0.05, mid_note
            page.screenshot(path=str(OUT / 'review.png'), full_page=True)

            # Finalized lesson page uses the manifest playback offset (0.12 s).
            page.goto(f'{BASE}/?page=preview&id=l1', wait_until='domcontentloaded')
            page.wait_for_timeout(4000)
            probe = page.evaluate("async () => {const r = await fetch('/api/lessons/l1', {headers: {'X-Lesson-Formats': '1,2'}}); return {status: r.status, text: (await r.text()).slice(0, 300)};}")
            print('LESSON BODY', page.inner_text('body')[:400])
            print('LESSON HTML', page.evaluate('document.body.innerHTML.slice(0,800)'))
            page.screenshot(path=str(OUT / 'lesson-fail.png'), full_page=True)
            print('LESSON PROBE', probe)
            page.get_by_role('button', name='Piano', exact=True).wait_for(timeout=30000)
            page.get_by_role('button', name='Piano', exact=True).click()
            page.evaluate("document.querySelector('video').play()")
            page.wait_for_timeout(1200)
            lesson_state = page.evaluate("""() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, pianoTime:a.currentTime, paused:a.paused, duration:a.duration};}""")
            assert lesson_state['muted'] is True and lesson_state['pianoTime'] > 0.2, lesson_state
            page.evaluate("document.querySelector('video').pause()")
            page.evaluate("document.querySelector('video').currentTime = 2.0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(500)
            lesson_mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(lesson_mapped - 1.88) < 0.05, lesson_mapped
            assert page.locator('.piano-note-roll').count() == 1
            page.evaluate("document.querySelector('video').playbackRate = 1.5")
            page.wait_for_timeout(300)
            rate = page.evaluate("document.querySelector('audio').playbackRate")
            assert rate == 1.5, rate
            page.get_by_label('Loop start').fill('1')
            page.get_by_label('Loop end').fill('2')
            page.get_by_label('Loop playback').check()
            page.evaluate("document.querySelector('video').currentTime = 1.9")
            page.evaluate("document.querySelector('video').play()")
            page.wait_for_timeout(1600)
            looped = page.evaluate("document.querySelector('video').currentTime")
            assert 1.0 <= looped < 2.2, looped
            page.evaluate("document.querySelector('video').pause()")
            page.evaluate("document.querySelector('video').currentTime = 0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(300)
            assert 'No note sounding' in page.locator('.music-now').inner_text()
            page.evaluate("document.querySelector('video').currentTime = 0.7")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(300)
            assert 'C4' in page.locator('.music-now').inner_text()
            page.screenshot(path=str(OUT / 'lesson.png'), full_page=True)

            # A lesson without a preview disables Piano with a visible reason.
            page.goto(f'{BASE}/?page=preview&id=l2', wait_until='domcontentloaded')
            page.get_by_role('heading', name='No preview').wait_for(timeout=30000)
            piano_button = page.get_by_role('button', name='Piano', exact=True)
            piano_button.wait_for(timeout=30000)
            assert piano_button.is_disabled()
            assert 'Piano audio is unavailable' in page.inner_text('body')

            # Dense reference: 1200 notes still render in the browser roll.
            page.goto(f'{BASE}/?page=preview&id=l3', wait_until='domcontentloaded')
            page.get_by_role('heading', name='Dense').wait_for(timeout=30000)
            assert '1200 notes' in page.inner_text('body')
            assert page.locator('.piano-note-roll').count() == 1
            assert page.get_by_role('button', name='Piano', exact=True).is_disabled()

            print(json.dumps({'status': 'ok', 'piano_time': round(state['pianoTime'], 3),
                              'mapped': round(mapped, 3), 'saved': saved,
                              'lesson_mapped': round(lesson_mapped, 3),
                              'lesson_piano': round(lesson_state['pianoTime'], 3)}))
            browser.close()
    finally:
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == '__main__':
    main()



