from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("""            page.evaluate("document.querySelector('video').currentTime = 2.0")
            page.wait_for_timeout(700)
            mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(mapped - 1.88) < 0.12, mapped
""", """            page.evaluate("document.querySelector('video').pause()")
            page.evaluate("document.querySelector('video').currentTime = 2.0")
            page.dispatch_event('video', 'seeked')
            page.wait_for_timeout(500)
            mapped = page.evaluate("document.querySelector('audio').currentTime")
            assert abs(mapped - 1.88) < 0.05, mapped
""")
p.write_text(t, encoding='utf-8')
print('patched')
