from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace('â€”', '\u2014').replace('Â±', '\u00b1').replace('mutinies', 'mutes')
p.write_text(t, encoding='utf-8')
print('fixed')
