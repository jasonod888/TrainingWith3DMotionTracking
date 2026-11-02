"""Short, authenticated, in-memory voice command recognition."""
import base64
import binascii
from functools import lru_cache
import importlib.util
import json
import threading

from fastapi import Depends,HTTPException
from pydantic import BaseModel,Field

PHRASES=['next','back','again','pause','start','resume','play','stop','slower','faster','loop',
         'next section','go back','repeat','slow down','speed up','[unk]']
slots=threading.BoundedSemaphore(2)


@lru_cache(maxsize=1)
def model(path):
    import vosk
    vosk.SetLogLevel(-1)
    return vosk.Model(path)


def available(settings):
    return settings.voice_enabled and (settings.voice_model_dir/'am/final.mdl').is_file() and importlib.util.find_spec('vosk') is not None


def recognize(pcm,path):
    from vosk import KaldiRecognizer
    decoder=KaldiRecognizer(model(str(path)),16000,json.dumps(PHRASES))
    decoder.SetWords(True)
    decoder.AcceptWaveform(pcm)
    result=json.loads(decoder.FinalResult())
    text=result.get('text','').strip()
    words=result.get('result',[])
    confidence=min((w.get('conf',0) for w in words),default=0)
    if text not in PHRASES or text=='[unk]' or confidence<.6:text=''
    return {'text':text,'confidence':confidence}


class Audio(BaseModel):
    pcm: str=Field(min_length=100,max_length=128000)


def install_voice(app,settings,identity,optional_identity):
    @app.get('/api/voice/capability')
    def capability(account=Depends(optional_identity)):
        return {'available':bool(account) and available(settings),'sample_rate':16000}

    @app.post('/api/voice/recognize')
    def command(body:Audio,account=Depends(identity)):
        if not available(settings):raise HTTPException(503,'Local voice recognition is unavailable.')
        try:pcm=base64.b64decode(body.pcm,validate=True)
        except (ValueError,binascii.Error):raise HTTPException(422,'Invalid microphone audio.')
        if not 8000<=len(pcm)<=96000 or len(pcm)%2:raise HTTPException(422,'Send a short mono 16 kHz audio clip.')
        if not slots.acquire(blocking=False):raise HTTPException(429,'Voice service is busy. Try again.')
        try:return recognize(pcm,settings.voice_model_dir)
        finally:slots.release()
