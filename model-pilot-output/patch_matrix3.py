from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    objects = make_assets(OUT)\n    store = Store(objects)",
"""    objects = make_assets(OUT)
    objects['lessons/l2/source.mp4'] = objects['lessons/l1/source.mp4']
    objects['lessons/l2/draft-reference.json'] = objects['lessons/l1/draft-reference.json']
    store = Store(objects)""")
t = t.replace("    reference_asset = asset('lessons/l1/draft-reference.json', objects['lessons/l1/draft-reference.json'], 'application/json')",
"""    reference_asset = asset('lessons/l1/draft-reference.json', objects['lessons/l1/draft-reference.json'], 'application/json')
    source_asset2 = asset('lessons/l2/source.mp4', objects['lessons/l2/source.mp4'], 'video/mp4')
    reference_asset2 = asset('lessons/l2/draft-reference.json', objects['lessons/l2/draft-reference.json'], 'application/json')""")
t = t.replace("        session.add(MusicDraft(id='d1', job_id='j1', lesson_id='l1', owner_id='acct-1',",
"""        session.add(Lesson(id='l2', owner_id='acct-1', title='No preview', subject='piano',
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
        session.add(MusicDraft(id='d1', job_id='j1', lesson_id='l1', owner_id='acct-1',""")
t = t.replace("""            page.screenshot(path=str(OUT / 'lesson.png'), full_page=True)

            print(json.dumps""",
"""            page.evaluate("document.querySelector('video').pause()")
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
            page.get_by_text('No preview').first.wait_for(timeout=30000)
            piano_button = page.get_by_role('button', name='Piano', exact=True)
            piano_button.wait_for(timeout=30000)
            assert piano_button.is_disabled()
            assert 'Piano audio is unavailable' in page.inner_text('body')

            print(json.dumps""")
p.write_text(t, encoding='utf-8')
print('patched')
