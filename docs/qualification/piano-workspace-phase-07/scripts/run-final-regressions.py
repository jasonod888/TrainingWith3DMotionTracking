"""Run the final Phase 7 regression set and record commands/exit codes/output paths."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PY = ROOT / '.venv-saas/Scripts/python.exe'
LOGS = ROOT / 'docs/qualification/piano-workspace-phase-07/logs'
LOGS.mkdir(exist_ok=True)

scripts = [
    ('normal-route', 'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'),
    ('async-races', 'docs/qualification/piano-workspace-phase-07/scripts/check-async-races.py'),
    ('a7-refresh', 'docs/qualification/piano-workspace-phase-07/scripts/check-a7-refresh.py'),
    ('transaction-contract', 'docs/qualification/piano-workspace-phase-07-review/check-transaction-contract.py'),
    ('baseline-shape', 'docs/qualification/piano-workspace-phase-07-review/check-baseline-shape.py'),
    ('verification', 'docs/qualification/piano-workspace-phase-07-review/check-verification.py'),
    ('verification-transitions', 'docs/qualification/piano-workspace-phase-07-review/check-verification-transitions.py'),
    ('verification-recovery', 'docs/qualification/piano-workspace-phase-07-review/check-verification-recovery.py'),
    ('structural-roundtrip', 'docs/qualification/piano-workspace-phase-07-review/check-unchanged-structural-roundtrips.py'),
    ('written-reversal', 'docs/qualification/piano-workspace-phase-07-review/check-written-reversal.py'),
    ('legacy-reversal', 'docs/qualification/piano-workspace-phase-07-review/check-legacy-reversal.py'),
    ('empty-baseline', 'docs/qualification/piano-workspace-phase-07-review/check-empty-baseline.py'),
    ('settings', 'docs/qualification/piano-workspace-phase-07-review/check-settings.py'),
    ('loaded-clock', 'docs/qualification/piano-workspace-phase-07-review/check-loaded-clock.py'),
    ('clip-seek', 'docs/qualification/piano-workspace-phase-07-review/check-clip-seek.py'),
    ('integration', 'docs/qualification/piano-workspace-phase-07-review/check-integration.py'),
]
results = {}
for name, relative in scripts:
    log = LOGS / f'final-{name}.txt'
    with log.open('w', encoding='utf-8') as handle:
        completed = subprocess.run([sys.executable, str(ROOT / relative)], cwd=ROOT,
                                   stdout=handle, stderr=subprocess.STDOUT)
    results[name] = {'command': f'{PY.relative_to(ROOT)} {relative}', 'exit': completed.returncode,
                     'log': str(log.relative_to(ROOT))}
    print(name, completed.returncode)
(LOGS / 'final-regression.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
raise SystemExit(0 if all(item['exit'] == 0 for item in results.values()) else 1)
