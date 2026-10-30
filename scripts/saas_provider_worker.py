"""Lightweight remote inference dispatcher. No CUDA/model/database/bucket credentials.

Uses durable submission receipts and polling; a lost POST response is never retried.
Run separately from the web process. See docs/processing-providers.md.
"""
import argparse
import copy
import os
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlparse
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from apps.api.provider_adapters import adapter,validate_output_url
from apps.api.processing import ENGINE_VERSION,PIPELINE_VERSION

FILES={'animation':'reference.glb','landmarks':'reference.json','source_video':'preview.mp4','thumbnail':'thumbnail.jpg'}


class RemoteWorker:
    def __init__(self,url,token,provider,provider_token,api=None,transport=None,downloads=None):
        if provider not in ('replicate','fal'):raise ValueError('Choose replicate or fal.')
        parsed=urlparse(url)
        if parsed.scheme!='https' and parsed.hostname not in ('localhost','127.0.0.1','host.docker.internal'):
            raise ValueError('Remote API connections require HTTPS.')
        self.provider=provider
        self.api=api or httpx.Client(base_url=url.rstrip('/'),headers={'Authorization':'Bearer '+token},timeout=60,trust_env=False)
        self.transport=transport or adapter(provider,provider_token)
        self.downloads=downloads or httpx.Client(timeout=60,trust_env=False,follow_redirects=False)

    def run(self,job,poll_seconds=5,max_seconds=3600):
        if job['provider']!=self.provider or job['pipeline_version']!=PIPELINE_VERSION:raise ValueError('Worker route mismatch.')
        path='/api/worker/jobs/'+job['id'];headers={'X-Job-Lease':job['attempt_token']}
        identity=job['provider_request_id'];target=job['provider_target'];stage='validating';terminal=False
        stopped=threading.Event();lost=threading.Event();lock=threading.Lock()
        def post(suffix,body):
            response=self.api.post(path+suffix,headers=headers,json=body);response.raise_for_status();return response.json()
        def pulse():
            while not stopped.wait(15):
                try:
                    with lock:post('/heartbeat',{'stage':stage})
                except httpx.HTTPError:lost.set();return
        thread=threading.Thread(target=pulse,daemon=True);thread.start()
        def check():
            if lost.is_set():raise RuntimeError('lease_lost')
        def advance(value):
            nonlocal stage
            check()
            with lock:post('/heartbeat',{'stage':value});stage=value
        try:
            if not identity:
                # Persist intent BEFORE the chargeable call. No automatic retry of submit.
                source=post('/submission/start',{})['source_url']
                if urlparse(source).scheme!='https':raise ValueError('Providers require a public HTTPS input URL.')
                try:
                    identity=self.transport.submit(target,{'video_url':source,'start':job['start'],'duration':job['duration'],
                        'pipeline_version':PIPELINE_VERSION,'engine_version':ENGINE_VERSION})
                    post('/submission/record',{'request_id':identity})
                except Exception:
                    if identity:
                        try:self.transport.cancel(target,identity)
                        except Exception:pass
                    post('/fail',{'category':'provider_submission_unknown'})
                    return
            advance('processing');deadline=time.monotonic()+max_seconds
            while True:
                check()
                if time.monotonic()>deadline:raise TimeoutError('Provider processing time limit exceeded.')
                try:result=self.transport.poll(target,identity)
                except httpx.HTTPError:
                    if lost.wait(poll_seconds):check()
                    continue  # Reconcile the SAME paid request, never create another.
                if result.state=='failed':post('/fail',{'category':'provider_failed'});return
                if result.state=='succeeded':terminal=True;break
                if lost.wait(poll_seconds):check()
            advance('exporting')
            output=result.output
            if not isinstance(output,dict) or output.get('pipeline_version')!=PIPELINE_VERSION:raise ValueError('Invalid pipeline output.')
            manifest=copy.deepcopy(output['manifest'])
            if manifest['engine']!='sam-3d-body' or manifest['engine_version']!=ENGINE_VERSION:raise ValueError('Model version mismatch.')
            advance('verifying')
            for field,name in FILES.items():
                check();url=validate_output_url(output['files'][name],self.provider)
                data=bytearray()
                with self.downloads.stream('GET',url) as response:
                    response.raise_for_status()
                    for chunk in response.iter_bytes(1024*1024):
                        check();data.extend(chunk)
                        if len(data)>64*1024*1024:raise ValueError('Provider output exceeded its limit.')
                response=self.api.put(path+'/files/'+name,headers={**headers,'Content-Type':'application/octet-stream'},content=bytes(data))
                response.raise_for_status();manifest[field]=response.json()
            check();post('/finish',manifest)
            print('Remote conversion ready for review.',flush=True)
        except Exception:
            if not lost.is_set():
                try:post('/fail',{'category':'provider_failed' if terminal else 'infrastructure'})
                except httpx.HTTPError:pass
            if identity:
                try:
                    self.transport.cancel(target,identity)
                    # Cancellation is a signal, not proof that billable work ended.
                    until=time.monotonic()+60
                    while time.monotonic()<until:
                        if self.transport.poll(target,identity).state in ('failed','succeeded'):
                            post('/submission/closed',{'request_id':identity});break
                        time.sleep(5)
                except Exception:pass  # Reservation remains held for operator reconciliation.
            print('Remote conversion stopped; inspect its durable job record.',flush=True)
        finally:stopped.set();thread.join(timeout=65)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--once',action='store_true');args=parser.parse_args()
    provider=os.environ['WORKER_PROVIDER']
    worker=RemoteWorker(os.environ['WORKER_API_URL'],os.environ['WORKER_TOKEN'],provider,os.environ['PROVIDER_API_TOKEN'])
    while True:
        try:
            response=worker.api.post('/api/worker/claim',json={});response.raise_for_status();job=response.json()
            if job:worker.run(job)
        except httpx.HTTPError:print('Dispatcher connection unavailable; waiting to reconnect.',flush=True)
        if args.once:return
        time.sleep(5)


if __name__=='__main__':main()
