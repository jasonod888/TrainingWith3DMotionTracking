from datetime import timedelta
from uuid import uuid4
from sqlalchemy.orm import Session
from test_accounts import system, imported, register, login
from apps.api.auth import now
from apps.api.database import MimicPair

def setup_pair(system):
    lesson=imported(system);client=system[0]
    result=client.post('/api/mimic-pairs',json={'lesson_id':lesson.lesson_id,'revision_id':lesson.revision_id})
    assert result.status_code==201,result.text
    capture=result.json();receiver=client.post('/api/mimic-pairs/claim',json={'code':capture['code']}).json()
    return client,lesson,capture,receiver

def headers(pair):return {'X-Mimic-Token':pair['token']}

def test_receiver_requires_capture_approval_and_revocation(system):
    client,lesson,capture,receiver=setup_pair(system);path='/api/mimic-pairs/'+capture['id']
    assert client.get(path,headers=headers(receiver)).json()['manifest'] is None
    command={'id':str(uuid4()),'sequence':1,'action':'resume'}
    assert client.post(path+'/commands',headers=headers(receiver),json=command).status_code==403
    assert client.post(path+'/approve',headers=headers(receiver),json={}).status_code==403
    assert client.post(path+'/approve',headers=headers(capture),json={}).status_code==200
    assert client.get(path,headers=headers(receiver)).json()['manifest']['revision_id']==lesson.revision_id
    assert client.post(path+'/commands',headers=headers(receiver),json=command).status_code==200
    assert client.post(path+'/commands',headers=headers(receiver),json=command).status_code==200
    assert len(client.get(path,headers=headers(capture)).json()['commands'])==1
    assert client.request('DELETE',path,headers=headers(receiver),json={}).status_code==200
    assert client.get(path,headers=headers(capture)).status_code==404

def test_state_sequence_ack_and_replayed_commands(system):
    client,lesson,capture,receiver=setup_pair(system);path='/api/mimic-pairs/'+capture['id']
    client.post(path+'/approve',headers=headers(capture),json={})
    command={'id':str(uuid4()),'sequence':1,'action':'next'}
    client.post(path+'/commands',headers=headers(receiver),json=command)
    seq=client.get(path,headers=headers(capture)).json()['commands'][0]['sequence']
    state={'sequence':2,'time':0,'speed':.5,'index':0,'end':lesson.duration,'ack':seq}
    assert client.put(path+'/state',headers=headers(capture),json=state).status_code==200
    assert client.put(path+'/state',headers=headers(capture),json=state).status_code==409
    assert client.post(path+'/commands',headers=headers(receiver),json=command).status_code==200
    assert client.get(path,headers=headers(capture)).json()['commands']==[]
    assert client.put(path+'/state',headers=headers(receiver),json={**state,'sequence':3}).status_code==403
    assert client.put(path+'/state',headers=headers(capture),json={**state,'sequence':3,'time':lesson.duration+1}).status_code==422

def test_expiry_and_revision_changes_block_pairing(system):
    client,lesson,capture,receiver=setup_pair(system);path='/api/mimic-pairs/'+capture['id']
    assert client.get(path,headers={'X-Mimic-Token':'wrong'}).status_code==403
    with Session(system[1].state.engine) as session:
        row=session.get(MimicPair,capture['id']);assert row.capture_hash!=capture['token'];row.expires_at=now()-timedelta(seconds=1);session.commit()
    assert client.get(path,headers=headers(capture)).status_code==404

def test_pairing_is_account_bound_and_code_is_single_use(system):
    from fastapi.testclient import TestClient
    client,lesson,capture,receiver=setup_pair(system)
    assert client.post('/api/mimic-pairs/claim',json={'code':capture['code']}).status_code==404
    stranger=TestClient(system[1]);stranger.headers.update({'Origin':'http://testserver','X-Form-Request':'1'});register(stranger,system[3],'other@example.test');login(stranger,'other@example.test')
    assert stranger.get('/api/mimic-pairs/'+capture['id'],headers=headers(capture)).status_code==404
