from uuid import uuid4
from test_accounts import system,imported

def test_attempt_summary_is_opt_in_idempotent_and_revision_checked(system):
    lesson=imported(system);client=system[0];path=f'/api/lessons/{lesson.lesson_id}/attempts'
    assert client.get(path).json()==[]
    value={'id':str(uuid4()),'revision_id':lesson.revision_id,'start':0,'end':lesson.duration,'score':75,'coverage':.8,'cue':'Compare left elbow','section':'First','configuration':'user:same:0'}
    assert client.post(path,json=value).status_code==201
    assert client.post(path,json=value).status_code==201
    assert len(client.get(path).json())==1
    assert client.post(path,json={**value,'id':str(uuid4()),'revision_id':'old'}).status_code==409
    assert client.post(path,json={**value,'id':str(uuid4()),'score':101}).status_code==422
