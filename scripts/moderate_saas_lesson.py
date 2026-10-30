"""Operator-only lesson report review and reversible access disablement."""
import argparse
import json
from pathlib import Path
import sys
from sqlalchemy import select
from sqlalchemy.orm import Session
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.config import Settings
from apps.api.database import Lesson,LessonReport,make_engine


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lesson-id');parser.add_argument('--enable',action='store_true');args=parser.parse_args()
    engine=make_engine(Settings().sqlalchemy_url)
    with Session(engine) as session:
        if args.lesson_id:
            lesson=session.get(Lesson,args.lesson_id)
            if not lesson:parser.error('Unknown lesson.')
            lesson.disabled=not args.enable;session.commit();print('Lesson access '+('enabled.' if args.enable else 'disabled.'))
        else:
            for report in session.scalars(select(LessonReport).order_by(LessonReport.created_at.desc()).limit(100)):
                print(json.dumps({'lesson_id':report.lesson_id,'created_at':report.created_at.isoformat(),'reason':report.reason}))
    engine.dispose()


if __name__=='__main__':main()
