from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("probe = page.evaluate(\"async () => {const r = await fetch('/api/lessons/l1'); return {status: r.status, text: (await r.text()).slice(0, 300)};}\")",
"probe = page.evaluate(\"async () => {const r = await fetch('/api/lessons/l1', {headers: {'X-Lesson-Formats': '1,2'}}); return {status: r.status, text: (await r.text()).slice(0, 300)};}\")\n            print('LESSON BODY', page.inner_text('body')[:400])")
p.write_text(t, encoding='utf-8')
print('patched')
