"""Package 3: parent/child comparison runs with immutable attempts.

The parent freezes the source, interval and requested variants. Each child attempt runs in
its own directory and its own subprocess by default, so a timeout or crash cannot damage a
previous attempt or another model. A child is `ready` only when its receipt proves the
correction bypass; blocked and identity-unresolved rows are recorded, never shown as
successful results.

This module never imports the correction pipeline. That is deliberate and tested.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    from scripts import piano_model_registry as registry_module
except ImportError:  # pragma: no cover - direct script execution
    import piano_model_registry as registry_module

SCHEMA = 'piano-comparison-1'
CHILD_SCHEMA = 'piano-model-run-1'
MODE = 'raw-model-comparison-v1'
STATUSES = ('blocked_license', 'identity_unresolved', 'queued', 'running', 'ready',
            'partial', 'failed', 'cancelled')
DEFAULT_TIMEOUT_SECONDS = 900
DEFAULT_BASE = (Path(__file__).resolve().parents[1] / '.local' / 'repo-research'
                / 'comparisons')
ROOT = Path(__file__).resolve().parents[1]


def _venv_python(env: str, platform: str | None = None) -> Path:
    """Return the venv interpreter path for the running platform.

    `platform` is injectable so the Windows and POSIX layouts can both be tested on
    either CI OS without creating or executing a virtualenv.
    """
    selected = platform or os.name
    nested = Path('Scripts') / 'python.exe' if selected == 'nt' else Path('bin') / 'python'
    return ROOT / env / nested


RUNTIME_INTERPRETERS = {
    'basic-pitch': _venv_python('.venv-music'),
    'kong': _venv_python('.venv'),
}


def _interpreter(entry, override=None):
    """Use the adapter's own pinned environment unless the caller overrides it."""
    if override:
        return override
    candidate = RUNTIME_INTERPRETERS.get(entry['family'])
    return str(candidate) if candidate and candidate.is_file() else sys.executable


class ComparisonJobError(ValueError):
    """The comparison cannot be created or executed as specified."""


def _sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True), encoding='utf-8')


def _now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def create(source, interval, variant_ids, *, base_dir=DEFAULT_BASE, owner='owner',
           registry=None, comparison_id=None):
    """Freeze a parent comparison; repeat calls create a new immutable parent."""
    source = Path(source)
    if not source.is_file():
        raise ComparisonJobError(f'source does not exist: {source}')
    start, end = float(interval[0]), float(interval[1])
    if not 0.0 <= start < end:
        raise ComparisonJobError(f'invalid interval {interval!r}')
    registry = registry or registry_module.build()
    entries = {entry['id']: entry for entry in registry['variants']}
    unknown = [identifier for identifier in variant_ids if identifier not in entries]
    if unknown:
        raise ComparisonJobError(f'unknown variants: {unknown}')
    if len(variant_ids) != len(set(variant_ids)):
        raise ComparisonJobError('variant ids must be unique')
    identifier = comparison_id or f'comparison-{int(time.time())}-{os.getpid()}'
    directory = Path(base_dir) / owner / identifier
    if directory.exists():
        raise ComparisonJobError(f'comparison already exists: {directory}')
    (directory / 'runs').mkdir(parents=True)
    runs = {}
    for variant in variant_ids:
        entry = entries[variant]
        runs[variant] = {'variant': variant, 'status': 'queued', 'attempts': [],
                         'blocked': entry['status'] != registry_module.STATUS_READY}
    record = {
        'schema': SCHEMA,
        'id': identifier,
        'owner': owner,
        'created_at': _now(),
        'mode': MODE,
        'source': {'path': str(source), 'sha256': _sha256_file(source),
                   'interval': [start, end]},
        'registry_sha256': _registry_sha256(registry),
        'requested': list(variant_ids),
        'runs': runs,
        'status': 'queued',
        'correction_enabled': False,
        'expression_correction_enabled': False,
    }
    _write(directory / 'comparison.json', record)
    return {'id': identifier, 'directory': str(directory), 'record': record}


def _registry_sha256(registry):
    return hashlib.sha256(json.dumps(
        {entry['id']: {'checkpoint': entry['checkpoint'].get('sha256'),
                       'decoder': entry['decoder'].get('profile'),
                       'rights': entry['rights']['status'],
                       'status': entry['status']}
         for entry in registry['variants']}, sort_keys=True).encode('utf-8')).hexdigest()


def _default_runner(entry, source, interval, output_dir, *, timeout, python):
    command = [_interpreter(entry, python), '-m', 'scripts.piano_model_adapters', 'run',
               '--variant', entry['id'], '--source', str(source),
               '--start', str(interval[0]), '--end', str(interval[1]),
               '--output', str(output_dir)]
    try:
        completed = subprocess.run(command, cwd=str(Path(__file__).resolve().parents[1]),
                                   capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise ComparisonJobError(f'inference timed out after {timeout}s') from error
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        raise ComparisonJobError(detail[-1] if detail else 'adapter failed')
    receipt_path = Path(output_dir) / 'receipt.json'
    if not receipt_path.is_file():
        raise ComparisonJobError('adapter produced no receipt')
    return _json(receipt_path)


def _verify_receipt(identifier, receipt):
    if receipt.get('schema') != 'piano-model-run-receipt-1':
        raise ComparisonJobError(f'{identifier}: unsupported adapter receipt')
    if receipt.get('variant') != identifier:
        raise ComparisonJobError(f'{identifier}: receipt variant mismatch')
    if receipt.get('mode') != MODE:
        raise ComparisonJobError(f'{identifier}: receipt mode mismatch')
    if receipt.get('correction_enabled') is not False:
        raise ComparisonJobError(f'{identifier}: correction bypass was not recorded')
    if receipt.get('expression_correction_enabled') is not False:
        raise ComparisonJobError(f'{identifier}: expression bypass was not recorded')
    if receipt.get('correction_operations') != 0:
        raise ComparisonJobError(f'{identifier}: correction operations were applied')
    return True


def execute(directory, *, runner=None, timeout=DEFAULT_TIMEOUT_SECONDS, python=None,
            registry=None):
    """Run each requested child sequentially; one inference at a time."""
    directory = Path(directory)
    record = _json(directory / 'comparison.json')
    if record.get('schema') != SCHEMA:
        raise ComparisonJobError('not a comparison parent record')
    if record.get('status') in ('running',):
        raise ComparisonJobError('this comparison is already being executed')
    registry = registry or registry_module.build()
    entries = {entry['id']: entry for entry in registry['variants']}
    runner = runner or _default_runner
    record['status'] = 'running'
    _write(directory / 'comparison.json', record)
    started = time.time()
    try:
        for variant in record['requested']:
            entry = entries[variant]
            child = record['runs'][variant]
            if entry['status'] == registry_module.STATUS_BLOCKED:
                child['status'] = 'blocked_license'
                child['blocked_reasons'] = list(entry['rights']['blockers'])
                continue
            if entry['status'] != registry_module.STATUS_READY:
                child['status'] = 'identity_unresolved'
                child['blocked_reasons'] = [entry['identity_problem'] or 'identity incomplete']
                continue
            attempt = str(len(child['attempts']) + 1)
            output_dir = directory / 'runs' / variant / f'attempt-{attempt}'
            output_dir.mkdir(parents=True, exist_ok=False)
            child['status'] = 'running'
            _write(directory / 'comparison.json', record)
            attempt_record = {'attempt': int(attempt), 'directory': str(output_dir),
                              'status': 'running', 'started_at': _now()}
            try:
                receipt = runner(entry, Path(record['source']['path']),
                                 record['source']['interval'], output_dir,
                                 timeout=timeout, python=python)
                _verify_receipt(variant, receipt)
                attempt_record['status'] = ('partial' if receipt.get('warnings')
                                            else 'ready')
                attempt_record['receipt'] = str(output_dir / 'receipt.json')
                attempt_record['receipt_sha256'] = _sha256_file(
                    output_dir / 'receipt.json')
                child['status'] = attempt_record['status']
                child['error'] = None
            except Exception as error:  # noqa: BLE001 - recorded as the child failure
                attempt_record['status'] = 'failed'
                attempt_record['error'] = f'{type(error).__name__}: {error}'
                child['status'] = 'failed'
                child['error'] = attempt_record['error']
            attempt_record['finished_at'] = _now()
            child['attempts'].append(attempt_record)
            _write(directory / 'comparison.json', record)
    finally:
        record['status'] = _parent_status(record)
        record['finished_at'] = _now()
        record['seconds'] = round(time.time() - started, 3)
        _write(directory / 'comparison.json', record)
    return record


def _parent_status(record):
    statuses = [child['status'] for child in record['runs'].values()]
    ready = sum(1 for status in statuses if status in ('ready', 'partial'))
    if statuses and all(status == 'ready' for status in statuses):
        return 'complete'
    if ready:
        return 'partial'
    if any(status == 'failed' for status in statuses):
        return 'failed'
    return 'blocked'


def markdown(record):
    lines = [f"# Comparison {record['id']}", '',
             f"Source `{record['source']['sha256'][:12]}…`, interval "
             f"{record['source']['interval']}, status **{record['status']}**.", '',
             '| variant | status | attempts | error |', '|---|---|---|---|']
    for variant, child in record['runs'].items():
        error = child.get('error') or ', '.join(child.get('blocked_reasons') or [])
        lines.append(f"| {variant} | {child['status']} | {len(child['attempts'])} | "
                     f"{error} |")
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Run a raw model comparison.')
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--start', type=float, default=0.0)
    parser.add_argument('--end', type=float, required=True)
    parser.add_argument('--variant', action='append', default=[])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument('--json', action='store_true')
    arguments = parser.parse_args(argv)
    try:
        created = create(arguments.source, [arguments.start, arguments.end],
                         arguments.variant, base_dir=arguments.output.parent,
                         comparison_id=arguments.output.name)
        record = execute(created['directory'], timeout=arguments.timeout)
    except (ComparisonJobError, OSError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2
    print(json.dumps(record, indent=2, sort_keys=True) if arguments.json
          else markdown(record))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
