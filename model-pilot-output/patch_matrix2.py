from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("""            negative = page.evaluate("async () => (await (await fetch('/api/lessons/l1/music-draft')).json()).playback")
            assert negative == {'sync_offset_seconds': -0.2, 'revision': 3}, negative
            page.evaluate("document.querySelector('video').currentTime = 0")""",
"""            negative = page.evaluate("async () => (await (await fetch('/api/lessons/l1/music-draft')).json()).playback")
            assert negative == {'sync_offset_seconds': -0.2, 'revision': 3}, negative
            page.get_by_role('button', name='Piano audio').click()
            page.wait_for_timeout(300)
            page.evaluate("document.querySelector('video').currentTime = 0")""")
p.write_text(t, encoding='utf-8')
print('patched')
