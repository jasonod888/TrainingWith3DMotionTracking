"""Negative control for required pitch-only occurrence isolation."""
import copy
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[3]
source = root / 'docs/qualification/piano-workspace-phase-07/scripts/bench-paths.py'
spec = importlib.util.spec_from_file_location('canonical_review', source)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    context, page = m.open_case(browser, m.m.LONG)
    candidate = m.pick_safe(page,1)
    assert candidate is not None
    occurrence = candidate['id']
    action, _ = m.make_paths(page,occurrence,m.m.LONG['duration'])['roll_pitch']
    before = m.snapshot(page)
    action()
    after = m.snapshot(page)
    expected = m.EXPECTED['roll_pitch']
    actual_valid = bool(m.verify_edit('roll_pitch',before,after,expected))
    assert actual_valid, 'Review setup failed to produce the intended genuine pitch edit.'
    corrupted = copy.deepcopy(after)
    target = m.perf_note(corrupted['document'], occurrence)
    target['onset'] += 0.01
    accepts_unintended_onset = bool(m.verify_edit('roll_pitch',before,corrupted,expected))
    result = {'occurrence':occurrence,'genuine_pitch_edit_accepted':actual_valid,
              'unintended_onset_shift_seconds':0.01,
              'verifier_accepts_corrupted_after_state':accepts_unintended_onset,
              'passed':not accepts_unintended_onset}
    print(json.dumps(result,indent=2))
    Path(__file__).with_name('canonical-verifier-b1298b3-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    context.close();browser.close()
raise SystemExit(0 if result['passed'] else 1)
