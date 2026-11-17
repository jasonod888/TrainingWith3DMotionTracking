from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            page = context.new_page()\n", "            page = context.new_page()\n            page.on('pageerror', lambda error: print('PAGEERROR', error))\n            page.on('console', lambda message: print('CONSOLE', message.text) if message.type == 'error' else None)\n")
t = t.replace("            page.wait_for_timeout(1500)\n            probe", "            page.wait_for_timeout(4000)\n            probe")
p.write_text(t, encoding='utf-8')
print('patched')
