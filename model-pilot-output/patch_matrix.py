from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("""            assert original['muted'] is False and original['paused'] is True, original
            page.screenshot(path=str(OUT / 'review.png'), full_page=True)""",
"""            assert original['muted'] is False and original['paused'] is True, original

            # Negative offset, a note shifted across source zero, and a mid-note switch.
            page.get_by_label('Sync offset in milliseconds').fill('-200')
            page.get_by_role('button', name='Save sync').click()
            page.wait_for_timeout(400)
            negative = page.evaluate("async () => (await (await fetch('/api/lessons/l1/music-draft')).json()).playback")
            assert negative == {'sync_offset_seconds': -0.2, 'revision': 3}, negative
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
            page.screenshot(path=str(OUT / 'review.png'), full_page=True)""")
t = t.replace("""            assert page.locator('.piano-note-roll').count() == 1
            page.screenshot(path=str(OUT / 'lesson.png'), full_page=True)""",
"""            assert page.locator('.piano-note-roll').count() == 1
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
            page.screenshot(path=str(OUT / 'lesson.png'), full_page=True)""")
p.write_text(t, encoding='utf-8')
print('patched')
