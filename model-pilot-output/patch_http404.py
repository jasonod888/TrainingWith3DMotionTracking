from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("            page.on('console', lambda message: print('CONSOLE', message.text) if message.type == 'error' else None)\n", "            page.on('console', lambda message: print('CONSOLE', message.text) if message.type == 'error' else None)\n            page.on('response', lambda response: print('HTTP404', response.url) if response.status == 404 else None)\n")
p.write_text(t, encoding='utf-8')
print('patched')
