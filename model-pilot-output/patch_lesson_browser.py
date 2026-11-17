from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace('        \'lessons/l1/draft-reference.json\': b\'{"events":[]}\',',
"""        'lessons/l1/draft-reference.json': json.dumps({
            'reference_version': 1, 'subject': 'piano',
            'instrument': {'instrument': 'piano'}, 'duration': DURATION,
            'events': [
                {'id': 'e1', 'onset': 0.5, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7},
                {'id': 'e2', 'onset': 1.5, 'duration': 0.6, 'pitch': 64, 'velocity': 0.6},
                {'id': 'e3', 'onset': 3.0, 'duration': 0.5, 'pitch': 67, 'velocity': 0.5}],
            'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}]}).encode(),""")
t = t.replace("        session.add(Lesson(id='l1', owner_id='acct-1', title='Kong test', subject='piano',\n                           experience_family='music', instrument='piano', version=1))",
"        session.add(Lesson(id='l1', owner_id='acct-1', title='Kong test', subject='piano',\n                           experience_family='music', instrument='piano', version=1,\n                           published_revision_id='r1'))")
t = t.replace("""            page.get_by_role('button', name='Original audio').click()
            page.wait_for_timeout(300)
            original = page.evaluate(\"\"\"() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, paused:a.paused};}\"\"\")
            assert original['muted'] is False and original['paused'] is True, original
            page.screenshot(path=str(OUT / 'review.png'), full_page=True)
            print(json.dumps({'status': 'ok', 'piano_time': round(state['pianoTime'], 3),
                              'mapped': round(mapped, 3), 'saved': saved}))
            browser.close()""",
"""            page.get_by_role('button', name='Original audio').click()
            page.wait_for_timeout(300)
            original = page.evaluate(\"\"\"() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, paused:a.paused};}\"\"\")
            assert original['muted'] is False and original['paused'] is True, original
            page.screenshot(path=str(OUT / 'review.png'), full_page=True)

            # Finalized lesson page uses the manifest playback offset (0.12 s).
            page.goto(f'{BASE}/?page=preview&id=l1', wait_until='domcontentloaded')
            page.get_by_text('Kong test').first.wait_for(timeout=30000)
            page.get_by_role('button', name='Piano', exact=True).wait_for(timeout=30000)
            page.get_by_role('button', name='Piano', exact=True).click()
            page.evaluate("document.querySelector('video').play()")
            page.wait_for_timeout(1200)
            lesson_state = page.evaluate(\"\"\"() => {const v=document.querySelector('video'),a=document.querySelector('audio');
                return {muted:v.muted, pianoTime:a.currentTime, paused:a.paused, duration:a.duration};}\"\"\")
            assert lesson_state['muted'] is True and lesson_state['pianoTime'] > 0.2, lesson_state
            page.evaluate("document.querySelector('video').pause()")
            page.evaluate("document.querySelector('video').currentTime = 2.0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(500)
            lesson_mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(lesson_mapped - 1.88) < 0.05, lesson_mapped
            assert page.locator('.piano-note-roll').count() == 1
            page.screenshot(path=str(OUT / 'lesson.png'), full_page=True)

            print(json.dumps({'status': 'ok', 'piano_time': round(state['pianoTime'], 3),
                              'mapped': round(mapped, 3), 'saved': saved,
                              'lesson_mapped': round(lesson_mapped, 3),
                              'lesson_piano': round(lesson_state['pianoTime'], 3)}))
            browser.close()""")
p.write_text(t, encoding='utf-8')
print('patched')
