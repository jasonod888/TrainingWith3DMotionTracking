"""Deterministic, project-authored symbolic fixtures. No recordings or model accuracy claims."""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'packages/lesson-schema/fixtures/music-corpus'


def note(index,onset,pitch,duration=.25,optional=False):
    return dict(id=f'n{index}',onset=onset,pitch=pitch,duration=duration,velocity=.8,optional=optional)


def generate():
    cases=[
        ('piano-scale','piano',[note(i,.25+i*.5,p) for i,p in enumerate([60,62,64,65])],None,(4,0,0)),
        ('repeated-attacks','piano',[note(i,.25+i*.5,60) for i in range(3)],'missing',(2,1,0)),
        ('piano-chord','piano',[note(i,.5,p,.75) for i,p in enumerate([60,64,67])],'extra',(3,0,1)),
        ('optional-note','piano',[note(0,.5,60),note(1,1,64,optional=True)],None,(2,0,0)),
        ('guitar-open-strings','guitar',[note(i,.5+i*.5,p) for i,p in enumerate([40,45,50])],None,(3,0,0)),
        ('silence','piano',[],None,(0,0,0)),
    ]
    index=[]
    for name,subject,events,mutation,expected in cases:
        directory=DEST/name;directory.mkdir(parents=True,exist_ok=True)
        original=dict(subject=subject,instrument={'instrument':subject},duration=3,events=events,spans=[])
        source_hash=hashlib.sha256(json.dumps(original,sort_keys=True).encode()).hexdigest()
        reference={**original,'reference_version':1,'fixture_kind':'authored-synthetic',
            'review':dict(reviewer_id='synthetic-fixture-author',reviewed_at='2026-11-05T12:00:00Z',
                          draft_id=name,source_reference_sha256=source_hash)}
        proposal_events=events[:-1] if mutation=='missing' else events+[note(99,.5,84)] if mutation=='extra' else events
        proposal={**original,'events':proposal_events,'fixture_kind':'authored-synthetic-proposal'}
        for filename,data in [('reference.json',reference),('proposal.json',proposal)]:
            (directory/filename).write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
        index.append(dict(id=name,reference=f'{name}/reference.json',proposal=f'{name}/proposal.json',
                          expected=dict(zip(('matched','missing','extra'),expected))))
    (DEST/'index.json').write_text(json.dumps(dict(corpus_version=1,kind='authored-synthetic-symbolic',
        rights='Project-authored test data; no third-party performance, recording or model content.',
        purpose='Reader, guide, MIDI and matching regressions; not acoustic or model qualification.',cases=index),indent=2)+'\n',encoding='utf-8')
    return DEST


if __name__=='__main__':
    print(generate())
