import base64
from unittest.mock import patch
from test_accounts import system,imported


def test_voice_requires_account_and_csrf(system):
    client,_,_,_,_=system
    assert client.post('/api/voice/recognize',json={'pcm':base64.b64encode(b'\0'*8000).decode()}).status_code==401
    imported(system)
    token=client.headers.pop('X-CSRF-Token')
    assert client.post('/api/voice/recognize',json={'pcm':base64.b64encode(b'\0'*8000).decode()}).status_code==403
    client.headers['X-CSRF-Token']=token


def test_short_audio_validated_and_not_stored(system):
    imported(system);client,_,_,_,_=system
    with patch('apps.api.voice.available',return_value=True),patch('apps.api.voice.recognize',return_value={'text':'pause','confidence':.99}) as recognize:
        assert client.post('/api/voice/recognize',json={'pcm':'!'*100}).status_code==422
        assert client.post('/api/voice/recognize',json={'pcm':base64.b64encode(b'\0'*101).decode()}).status_code==422
        pcm=b'\0'*16000
        result=client.post('/api/voice/recognize',json={'pcm':base64.b64encode(pcm).decode()})
        assert result.status_code==200 and result.json()['text']=='pause'
        assert recognize.call_args.args[0]==pcm


def test_unavailable_voice_reports_capability(system):
    client,_,_,_,_=system
    with patch('apps.api.voice.available',return_value=False):
        assert client.get('/api/voice/capability').json()['available'] is False


def test_anonymous_client_does_not_select_authenticated_voice_service(system):
    client,_,_,_,_=system
    with patch('apps.api.voice.available',return_value=True):
        assert client.get('/api/voice/capability').json()['available'] is False
        imported(system)
        assert client.get('/api/voice/capability').json()['available'] is True
