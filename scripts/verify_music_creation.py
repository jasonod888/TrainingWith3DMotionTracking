"""Actual browser preparation + mocked multipart API; production music flags stay off."""
import json
import os
from pathlib import Path
import subprocess

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT/'test-results'
RESULTS.mkdir(exist_ok=True)
source = RESULTS/'music-creation-tone.mp4'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=green:s=320x240:r=24',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6',
                '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',str(source)],check=True)
subjects = [dict(id='movement_other',label='Full Body Movement',experience_family='body',instrument=None,movement=True),
            dict(id='piano',label='Piano',experience_family='music',instrument='piano',movement=False)]
limits = dict(max_bytes=250*1024*1024,max_seconds=300,max_active=2,part_size=5*1024*1024,
              processing=dict(provider='disabled',available=False,external_processing=False),subjects=subjects,
              capabilities=dict(conversion=False,music_piano=True,music_guitar=False))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    reports = []
    for mode in ('mp4','webm','import'):
        fallback = mode == 'webm'
        imported = mode == 'import'
        page = browser.new_page()
        errors, creations, parts, completions = [], [], {}, []
        page.on('pageerror', lambda error: errors.append(str(error)))
        if fallback:
            page.add_init_script("""
              const original=VideoEncoder.isConfigSupported.bind(VideoEncoder);
              VideoEncoder.isConfigSupported=config=>config.codec.startsWith('avc')
                ?Promise.resolve({supported:false,config}):original(config);
            """)
        if imported:
            page.add_init_script("""
              VideoEncoder.isConfigSupported=async config=>({supported:false,config});
              AudioEncoder.isConfigSupported=async config=>({supported:false,config});
            """)
        def api(route):
            path = route.request.url.split('/api/',1)[1].split('?')[0]
            if path == 'auth/session':
                route.fulfill(json={'account':dict(id='tester',email='test@example.test',platform_role='member',
                                                  status='active',mfa_enrolled=False),'csrf':'test'})
            elif path == 'demo': route.fulfill(status=404,json={'detail':'No demo'})
            elif path in ('lessons/summaries','shared-lessons/summaries'): route.fulfill(json=[])
            elif path == 'workflow/lessons': route.fulfill(json={'lessons':[]})
            elif path == 'capabilities': route.fulfill(json={'subject_filter':False})
            elif path == 'public/moves': route.fulfill(json={'moves':[]})
            elif path == 'conversions/limits': route.fulfill(json=limits)
            elif path == 'conversions' and route.request.method == 'POST':
                body = route.request.post_data_json
                creations.append(body)
                assert body['subject'] == body['instrument'] == 'piano'
                assert 'processing_provider' not in body
                assert body['preparation']['selection_start'] == (0 if imported else 1)
                assert abs(body['preparation']['selection_end']-(3.008 if imported else 4)) < .001
                assert body['preparation']['preparation_version'] == ('music-import-v1' if imported else 'music-clip-v1')
                route.fulfill(status=201,json={**body,'id':'music-upload','state':'uploading','part_size':5*1024*1024,'parts':{}})
            elif path == 'conversions': route.fulfill(json={'jobs':[],'worker_online':True})
            elif path.startswith('conversions/music-upload/parts/'):
                parts[int(path.rsplit('/',1)[1])] = route.request.post_data_buffer
                route.fulfill(json={'saved':True})
            elif path == 'conversions/music-upload/complete':
                completions.append(True)
                route.fulfill(json={'id':'music-upload','state':'queued'})
            else: route.fulfill(status=404,json={'detail':'Unexpected mock route'})
        page.route('**/api/**', api)
        page.goto(os.environ.get('PRACTICE_TEST_URL','http://127.0.0.1:5196')+'/?page=create')
        expect(page.get_by_label('Choose video',exact=True)).to_be_disabled()
        page.get_by_role('combobox',name='Lesson subject',exact=True).select_option('piano')
        page.get_by_label('Choose video',exact=True).set_input_files(str(source))
        expect(page.get_by_label('End time in seconds',exact=True)).to_have_value('6')
        page.get_by_label('Start time in seconds',exact=True).fill('1')
        page.get_by_label('End time in seconds',exact=True).fill('4')
        page.get_by_role('button',name='Create music lesson',exact=True).click()
        if imported:
            expect(page.get_by_role('alert')).to_contain_text('Export the selected part')
            assert not creations and not completions
            page.get_by_role('button',name='Choose another video',exact=True).click()
            page.get_by_label('Choose video',exact=True).set_input_files(str(RESULTS/'created-music.mp4'))
            expect(page.get_by_label('End time in seconds',exact=True)).to_have_value('3.01')
            page.get_by_role('checkbox',name='This file is already my exported clip (use the whole file)',exact=True).check()
            page.evaluate('window.scrollTo(0,0)')
            page.screenshot(path=str(RESULTS/'music-export-import.png'),full_page=True)
            page.get_by_role('button',name='Create music lesson',exact=True).click()
        expect(page.get_by_role('region',name='Practice feed',exact=True)).to_be_visible(timeout=60000)
        assert len(creations) == len(completions) == 1, (creations,completions)
        data = b''.join(parts[key] for key in sorted(parts))
        assert len(data) == creations[0]['bytes']
        if imported: assert data == (RESULTS/'created-music.mp4').read_bytes()
        output = RESULTS/('created-import.mp4' if imported else 'created-music.webm' if fallback else 'created-music.mp4')
        output.write_bytes(data)
        probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format',
                                                    '-of','json',str(output)]))
        assert {'video','audio'} <= {stream['codec_type'] for stream in probe['streams']}
        assert abs(float(probe['format']['duration'])-3) < .15
        assert creations[0]['filename'].endswith('.webm' if fallback else '.mp4')
        assert errors == [], errors
        reports.append(dict(path='verified-import' if imported else 'webm-fallback' if fallback else 'mp4-preferred',bytes=len(data),duration=probe['format']['duration']))
        page.close()
    browser.close()
print(json.dumps({'results':reports,'scope':'Real preparation and uploaded bytes; mocked API only'}))
