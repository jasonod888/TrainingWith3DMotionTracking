"""Rebuild the demo's avatar derivatives from its actual canonical animation.

Both clips are verified before replacing served files. Previous derivatives are
retained in .local/avatar-refresh for comparison or rollback. No inference is run.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from uuid import uuid4

from retarget_mixamo import ROOT, PROFILES, retarget


def refresh(folder):
    source = folder/'reference.glb'
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    work = ROOT/'.local/avatar-refresh'/uuid4().hex
    work.mkdir(parents=True)
    reports = {}
    for avatar in ('male', 'female'):
        reports[avatar] = retarget(source, PROFILES/f'{avatar}.json',
                                  work/f'avatar-{avatar}.glb', work/f'{avatar}.json')
    summary = {'schema': 1, 'source': {'file': source.name, 'sha256': digest}, 'avatars': reports}
    (work/'avatar-report.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError('The canonical animation changed during conversion; no files replaced.')
    backup = work/'previous'
    backup.mkdir()
    for name in ('avatar-male.glb', 'avatar-female.glb', 'avatar-report.json'):
        destination = folder/name
        if destination.exists():
            shutil.copy2(destination, backup/name)
        shutil.copy2(work/name, folder/f'.{name}.new')
        (folder/f'.{name}.new').replace(destination)
    print(f'Rebuilt demo avatar clips. Previous files: {backup}')
    for avatar, report in reports.items():
        print(avatar, json.dumps(report['foot_placement']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder', type=Path, default=ROOT/'web/dist/assets')
    refresh(parser.parse_args().folder.resolve())
