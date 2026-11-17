from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace('   tests cover the backend and parser, but not a real browser session.',
 '   tests cover the backend, parser and pure clock mapping (`piano-playback`), but not a\n   real browser session.')
t = t.replace('2. Media drift resynchronization thresholds/hysteresis and measured platform behavior.',
 '2. Media drift resynchronization currently uses a 40 ms threshold without hysteresis;\n   measured platform behavior is not recorded.')
p.write_text(t, encoding='utf-8')
print('ok')
