from pathlib import Path
p = Path('docs/qualification/kong-default-implementation.md')
t = p.read_text(encoding='utf-8')
t = t.replace("""1. Browser acceptance: leading silence, +-120 ms offsets, note crossing zero, mid-note
   switching, loop/speed, dense input, preview failure and permissions. Unit/integration
   tests cover the backend, parser and pure clock mapping (`piano-playback`), but not a
   real browser session.""", """1. Browser acceptance for the finalized lesson page and the remaining matrix: leading
   silence, negative offsets with a note crossing zero, mid-note switching, loop, speed,
   dense input, preview failure and permissions. Review-page acceptance and deterministic
   clock mapping are covered.""")
p.write_text(t, encoding='utf-8')
print('ok')
