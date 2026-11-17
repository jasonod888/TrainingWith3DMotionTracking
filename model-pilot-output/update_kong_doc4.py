from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8').replace('acceptance, pedal representation and drift/rate hardening remain.',
 'acceptance, pedal representation and drift hysteresis remain.')
p.write_text(t, encoding='utf-8')
print('ok')
