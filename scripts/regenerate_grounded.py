"""Build an isolated reviewed source/avatars revision; never publish or replace assets."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from ground_motion import run

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('motion', type=Path)
    p.add_argument('--contacts', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    a = p.parse_args()
    # A new directory is a revision boundary: failed work cannot overwrite a live lesson.
    a.output.mkdir(parents=True, exist_ok=False)
    report = run(a.motion, a.output, contact_file=a.contacts)
    if report['status'] != 'reviewed-contact-correction':
        raise SystemExit('Contact disagreement: revision was not exported.')
    def command(script, *args):
        subprocess.run([sys.executable, str(ROOT/'scripts'/script), *map(str, args)], check=True)
    command('export_glb.py', a.motion, '--grounding', a.output/'grounding.npz',
            '--output', a.output/'reference.glb')
    for avatar in ('male', 'female'):
        command('retarget_mixamo.py', '--source', a.output/'reference.glb',
                '--avatar', avatar, '--output', a.output/f'avatar-{avatar}.glb',
                '--report', a.output/f'avatar-{avatar}-report.json')
    (a.output/'revision.json').write_text(json.dumps({
        'schema_version': 1, 'status': 'local-review-only',
        'motion_sha256': report['motion_sha256'],
        'files': ['reference.glb', 'avatar-male.glb', 'avatar-female.glb', 'grounding-report.json'],
        'scoring': 'original landmarks unchanged',
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
