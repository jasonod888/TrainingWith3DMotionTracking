"""Run submitted Phase 6 browser checks without overwriting submitted evidence."""
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
source = ROOT / 'docs/qualification/piano-workspace-phase-06/scripts/check-editing.py'
spec = importlib.util.spec_from_file_location('submitted_phase6', source)
module = importlib.util.module_from_spec(spec)
# Use installed Chrome; this environment has no Playwright-managed Chromium bundle.
code = source.read_text(encoding='utf-8').replace('pw.chromium.launch()', "pw.chromium.launch(channel='chrome')")
exec(compile(code, str(source), 'exec'), module.__dict__)
module.OUT = Path(__file__).parent / 'captures'
module.OUT.mkdir(parents=True, exist_ok=True)
module.run()
module.RESULT['failures'] = module.FAILURES
(Path(__file__).parent / 'browser.json').write_text(json.dumps(module.RESULT, indent=2), encoding='utf-8')
print(json.dumps(module.RESULT, indent=2))
raise SystemExit(1 if module.FAILURES else 0)
