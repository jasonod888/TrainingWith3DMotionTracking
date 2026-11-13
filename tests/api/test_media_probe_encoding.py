import json
import subprocess
import sys

from apps.api.media_probe import _run


def test_media_tool_output_uses_utf8_even_under_windows_legacy_codepage(monkeypatch):
    # Emulate the locale that caused ffprobe's reader thread to fail on byte 0x9d.
    monkeypatch.setattr(subprocess, '_text_encoding', lambda: 'cp1252')
    details = {'format': {'duration': '209.594',
                          'tags': {'title': '이루마 — “River Flows in You”'}}}
    payload = json.dumps(details, ensure_ascii=False).encode('utf-8')
    stderr = 'Metadata: 이루마 “piano”'.encode('utf-8')
    script = f'import sys; sys.stdout.buffer.write({payload!r}); sys.stderr.buffer.write({stderr!r})'
    result = _run([sys.executable, '-c', script])
    assert result.returncode == 0
    assert json.loads(result.stdout) == details
    assert result.stderr == stderr.decode('utf-8')


def test_non_utf8_diagnostic_bytes_do_not_discard_valid_probe_json():
    result = _run([sys.executable, '-c',
                   'import sys; sys.stdout.buffer.write(b\'{"format":{"duration":"2.5"}}\'); '
                   'sys.stderr.buffer.write(b"diagnostic: \\xff")'])
    assert result.returncode == 0
    assert json.loads(result.stdout)['format']['duration'] == '2.5'
    assert 'diagnostic:' in result.stderr
