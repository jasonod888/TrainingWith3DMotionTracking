from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            page.goto(f'{BASE}/?page=preview&id=l1', wait_until='domcontentloaded')\n            page.get_by_text('Kong test').first.wait_for(timeout=30000)",
"            page.goto(f'{BASE}/?page=preview&id=l1', wait_until='domcontentloaded')\n            page.wait_for_timeout(1500)\n            probe = page.evaluate(\"async () => {const r = await fetch('/api/lessons/l1'); return {status: r.status, text: (await r.text()).slice(0, 300)};}\")\n            print('LESSON PROBE', probe)")
p.write_text(t, encoding='utf-8')
print('patched')
