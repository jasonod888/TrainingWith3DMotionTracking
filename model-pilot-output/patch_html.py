from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            print('LESSON BODY', page.inner_text('body')[:400])", "            print('LESSON BODY', page.inner_text('body')[:400])\n            print('LESSON HTML', page.evaluate('document.body.innerHTML.slice(0,800)'))\n            page.screenshot(path=str(OUT / 'lesson-fail.png'), full_page=True)")
p.write_text(t, encoding='utf-8')
print('patched')
