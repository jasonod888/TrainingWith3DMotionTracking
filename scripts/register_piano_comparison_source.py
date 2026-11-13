"""Register a server-side master audio file for the owner's comparison page.

This is a developer/owner action outside the browser. The API never accepts a filesystem
path; it accepts only the id created here.
"""
import argparse
import hashlib
import sys
import uuid
from pathlib import Path

from apps.api.config import Settings
from apps.api.database import Account, PianoComparisonSource, make_engine
from sqlalchemy import select
from sqlalchemy.orm import Session

try:
    from scripts import piano_reconstruction_harness as harness
except ImportError:  # pragma: no cover - direct execution from another root
    harness = None


def main(argv=None):
    parser = argparse.ArgumentParser(description='Register a comparison source.')
    parser.add_argument('--owner-email', required=True)
    parser.add_argument('--path', type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--lesson-id')
    parser.add_argument('--reference-path', type=Path)
    arguments = parser.parse_args(argv)
    if not arguments.path.is_file():
        print(f'error: source does not exist: {arguments.path}', file=sys.stderr)
        return 2
    if arguments.reference_path and not arguments.reference_path.is_file():
        print(f'error: reference does not exist: {arguments.reference_path}', file=sys.stderr)
        return 2
    settings = Settings()
    engine = make_engine(settings.sqlalchemy_url)
    try:
        with Session(engine) as session:
            account = session.scalar(select(Account).where(
                Account.email == arguments.owner_email))
            if not account:
                print('error: owner account not found', file=sys.stderr)
                return 2
            if harness is None:
                print('error: could not import the WAV inspector', file=sys.stderr)
                return 2
            header = harness.inspect_wav(arguments.path)
            record = PianoComparisonSource(
                id=uuid.uuid4().hex, owner_id=account.id,
                lesson_id=arguments.lesson_id, label=arguments.label,
                path=str(arguments.path.resolve()),
                sha256=hashlib.sha256(arguments.path.read_bytes()).hexdigest(),
                seconds=header['frames'] / header['sample_rate'],
                reference_path=(str(arguments.reference_path.resolve())
                                if arguments.reference_path else None))
            session.add(record)
            session.commit()
            print(record.id)
            return 0
    finally:
        engine.dispose()


if __name__ == '__main__':
    raise SystemExit(main())
