from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    objects['lessons/l2/draft-reference.json'] = objects['lessons/l1/draft-reference.json']",
"""    objects['lessons/l2/draft-reference.json'] = objects['lessons/l1/draft-reference.json']
    objects['lessons/l3/source.mp4'] = objects['lessons/l1/source.mp4']
    dense_events = [{'id': f'd{index}', 'onset': round(index * 0.005, 6),
                     'duration': 0.05, 'pitch': 21 + index % 88, 'velocity': 0.6}
                    for index in range(1200)]
    objects['lessons/l3/reference.json'] = json.dumps({
        'reference_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
        'duration': DURATION, 'events': dense_events,
        'spans': [{'start': 0, 'end': DURATION, 'kind': 'playing'}],
        'review': {'reviewer_id': 'acct-1', 'reviewed_at': '2026-11-13T00:00:00Z',
                   'draft_id': 'd3', 'source_reference_sha256': 'c' * 64}}).encode()""")
t = t.replace("        session.add(MusicDraft(id='d1', job_id='j1', lesson_id='l1', owner_id='acct-1',",
"""        dense_source = asset('lessons/l3/source.mp4', objects['lessons/l3/source.mp4'], 'video/mp4')
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
        session.add(MusicDraft(id='d1', job_id='j1', lesson_id='l1', owner_id='acct-1',""")
t = t.replace("""            assert 'Piano audio is unavailable' in page.inner_text('body')

            print(json.dumps""",
"""            assert 'Piano audio is unavailable' in page.inner_text('body')

            # Dense reference: 1200 notes still render in the browser roll.
            page.goto(f'{BASE}/?page=preview&id=l3', wait_until='domcontentloaded')
            page.get_by_role('heading', name='Dense').wait_for(timeout=30000)
            assert '1200 notes' in page.inner_text('body')
            assert page.locator('.piano-note-roll').count() == 1
            assert page.get_by_role('button', name='Piano', exact=True).is_disabled()

            print(json.dumps""")
p.write_text(t, encoding='utf-8')
print('dense added')
