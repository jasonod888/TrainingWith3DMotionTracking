"""Import a trusted, prepared lesson into a verified account's private library."""
import argparse
import sys
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from apps.api.config import Settings
from apps.api.database import Account, make_engine
from apps.api.lessons import import_fixture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email', required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    settings = Settings()
    engine = make_engine(settings.sqlalchemy_url)
    try:
        with Session(engine) as session:
            account = session.scalar(select(Account).where(Account.email == args.email.lower(), Account.verified.is_(True)))
            if not account:
                parser.error('Create and verify this account before importing.')
            owner_id = account.id
        lesson = import_fixture(engine, settings, owner_id, args.manifest, args.assets)
        print(f'Imported private lesson {lesson.lesson_id}: {lesson.title}')
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
