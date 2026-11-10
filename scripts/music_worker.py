"""Isolated outbound-only music worker transport. No body pipeline or model imports.

An explicit adapter command is required before claiming jobs. It receives --input (PCM
WAV), --source, --job (JSON) and --output (directory), and writes result.json containing
either a draft (unreviewed proposal, stored separately and never publishable) or a
reviewed manifest, plus files {asset_role: relative_path}. No built-in transcription or
fake approval.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse

import httpx

try:
    from .music_run_profile import load_profile, VerifiedProfile
except ImportError:  # Direct script execution.
    from music_run_profile import load_profile, VerifiedProfile

PIPELINES = {'music-piano-v1': 'piano', 'music-guitar-v1': 'guitar'}


class LeaseLost(RuntimeError):
    pass


class MusicWorker:
    def __init__(self, url, token, pipeline, adapter_command, work_dir, *, api=None, heartbeat_seconds=5,
                 profile=None, fixture=False, allow_insecure_local=False):
        parsed = urlparse(url)
        if parsed.scheme != 'https' and parsed.hostname not in ('127.0.0.1', 'localhost') and not allow_insecure_local:
            raise ValueError('Remote music workers require HTTPS.')
        if pipeline not in PIPELINES or not adapter_command:
            raise ValueError('Choose a music pipeline and an explicit adapter command.')
        if fixture and profile:
            raise ValueError('Choose either an exact run profile or explicit fixture mode.')
        if not fixture and not profile:
            raise ValueError('An exact run profile is required; fixture mode must be explicit.')
        if profile:
            if not isinstance(profile, VerifiedProfile):
                raise ValueError('Load a verified profile before starting the worker.')
            profile.reverify()
            # The code artifact must be the entry point actually passed to the process.
            entry = adapter_command[1] if len(adapter_command) > 1 and Path(adapter_command[0]).stem.lower().startswith('python') else adapter_command[0]
            if Path(entry).resolve() != profile.paths['code']:
                raise ValueError('The verified code file must be the executed adapter entry point.')
        self.profile, self.fixture = profile, fixture
        self.pipeline, self.adapter_command = pipeline, list(adapter_command)
        self.work_dir = Path(work_dir)
        self.api = api or httpx.Client(base_url=url.rstrip('/'), timeout=60, trust_env=False)
        self.authorization = {'Authorization': 'Bearer ' + token}
        self.heartbeat_seconds = heartbeat_seconds
        self.shutdown = threading.Event()

    def claim(self):
        if self.profile:
            self.profile.reverify()
        response = self.api.post('/api/worker/claim', headers=self.authorization, json={})
        response.raise_for_status()
        return response.json()

    def run(self, job):
        if self.profile:
            self.profile.reverify()
        instrument = PIPELINES[self.pipeline]
        if (job.get('provider') != 'local' or job.get('pipeline_version') != self.pipeline
                or job.get('subject') != instrument or job.get('instrument') != instrument):
            raise ValueError('Music worker route mismatch.')
        if any(not value or len(value) > 80 or any(c not in '0123456789abcdef' for c in value)
               for value in (job['id'], job['attempt_token'])):
            raise ValueError('Invalid music job identity.')
        work_root = self.work_dir.resolve()
        work_root.mkdir(parents=True, exist_ok=True)
        folder = Path(tempfile.mkdtemp(prefix=job['id']+'-', dir=work_root))
        headers = {**self.authorization, 'X-Job-Lease': job['attempt_token']}
        path = '/api/worker/jobs/' + job['id']
        lost, done, lock = threading.Event(), threading.Event(), threading.Lock()
        stage = 'validating'

        def post(suffix, body):
            response = self.api.post(path+suffix, headers=headers, json=body)
            if response.status_code in (401, 409):
                lost.set()
                raise LeaseLost('Music attempt is no longer leased.')
            response.raise_for_status()
            return response.json()

        def check():
            if lost.is_set() or self.shutdown.is_set():
                raise LeaseLost('Music work cancelled or lease lost.')

        def advance(value):
            nonlocal stage
            check()
            with lock:
                post('/heartbeat', {'stage': value})
                stage = value

        def pulse():
            while not done.wait(self.heartbeat_seconds):
                try:
                    with lock:
                        post('/heartbeat', {'stage': stage})
                except Exception:
                    lost.set()
                    return

        def command(arguments, timeout):
            check()
            log = folder / 'command.log'
            with log.open('wb') as output:
                environment={**os.environ,'CUDA_VISIBLE_DEVICES':'-1','OMP_NUM_THREADS':'1',
                             'TF_NUM_INTRAOP_THREADS':'1','TF_NUM_INTEROP_THREADS':'1'}
                environment.pop('MUSIC_RUN_PROFILE', None)
                environment.pop('MUSIC_MODEL_WEIGHTS', None)
                if self.profile:
                    environment['MUSIC_RUN_PROFILE']=json.dumps(self.profile,sort_keys=True)
                    environment['MUSIC_MODEL_WEIGHTS']=str(self.profile.paths['weights'])
                process = subprocess.Popen(arguments, env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                    start_new_session=os.name != 'nt',
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                began = time.monotonic()
                try:
                    while process.poll() is None:
                        check()
                        if time.monotonic()-began > timeout:
                            raise RuntimeError('Music command exceeded its time limit.')
                        time.sleep(.05)
                    if process.returncode:
                        raise RuntimeError('Music command failed.')
                finally:
                    if process.poll() is None:
                        if os.name == 'nt':
                            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)

        thread = threading.Thread(target=pulse, daemon=True)
        thread.start()
        try:
            advance('validating')
            source = folder/'source.media'
            digest, size = hashlib.sha256(), 0
            with self.api.stream('GET', path+'/source', headers=headers) as response:
                response.raise_for_status()
                with source.open('wb') as output:
                    for chunk in response.iter_bytes(1024*1024):
                        check()
                        size += len(chunk)
                        if size > job['bytes']:
                            raise RuntimeError('Source exceeds its bound size.')
                        digest.update(chunk)
                        output.write(chunk)
            if size != job['bytes'] or digest.hexdigest() != job['sha256']:
                raise RuntimeError('Source identity mismatch.')
            audio = folder/'analysis.wav'
            # A lossless analysis derivative; retain the original source for demonstration export.
            command(['ffmpeg', '-v', 'error', '-xerror', '-threads', '1', '-filter_threads', '1', '-i', str(source), '-map', '0:a:0', '-vn',
                     '-t', str(job['duration']), '-ar', str(self.profile['sample_rate'] if self.profile else 22050), '-ac', '1', '-c:a', 'pcm_s16le',
                     '-y', str(audio)], 120)
            job_file = folder/'job.json'
            job_file.write_text(json.dumps({key: job[key] for key in
                ('id', 'subject', 'instrument', 'duration', 'pipeline_version')}), encoding='utf-8')
            result_dir = folder/'result'
            result_dir.mkdir()
            advance('processing')
            command([*self.adapter_command, '--input', str(audio), '--source', str(source),
                     '--job', str(job_file), '--output', str(result_dir)], 1800)
            check()
            result = json.loads((result_dir/'result.json').read_text(encoding='utf-8'))
            draft = result.get('draft')
            manifest = result.get('manifest')
            if draft is None and manifest is None:
                raise ValueError('Adapter returned neither a draft nor a manifest.')
            if draft is not None:
                if self.profile:
                    provenance=draft.get('provenance',{})
                    if provenance.get('engine') == 'fixture' or any(provenance.get(key) != self.profile[key]
                            for key in ('profile_sha256','model','model_version')):
                        raise ValueError('Adapter did not confirm the executed model profile.')
                    if provenance.get('audio_sha256') != hashlib.sha256(audio.read_bytes()).hexdigest():
                        raise ValueError('Adapter analysis-audio identity does not match.')
                # Unreviewed proposals take the draft handoff and can never publish.
                if draft.get('subject') != instrument or (draft.get('instrument') or {}).get('instrument') != instrument:
                    raise ValueError('Adapter returned the wrong instrument.')
                document = draft
            else:
                if self.profile:
                    raise ValueError('Profiled transcription must hand off an unreviewed draft.')
                if manifest.get('reference_reviewed') is not True:
                    raise RuntimeError('An unreviewed manifest requires review through the draft handoff.')
                if manifest.get('subject') != instrument:
                    raise ValueError('Adapter returned the wrong instrument.')
                document = manifest
            advance('exporting')
            files = result['files']
            if 'reference' not in files:
                raise ValueError('Adapter omitted its reference.')
            uploads = []
            for role, relative in files.items():
                spec = job['output_roles'].get(role)
                asset = (result_dir/relative).resolve()
                if not spec or not asset.is_relative_to(result_dir.resolve()) or not asset.is_file():
                    raise ValueError('Adapter output is outside its role or attempt.')
                if asset.stat().st_size > 160*1024*1024:
                    raise ValueError('Music output exceeds its size limit.')
                uploads.append((role, spec, asset))
            advance('verifying')
            for role, spec, asset in uploads:
                check()
                with asset.open('rb') as data:
                    response = self.api.put(path+'/files/'+spec['name'], headers=headers, content=data)
                if response.status_code in (401, 409):
                    raise LeaseLost('Music output attempt is no longer valid.')
                response.raise_for_status()
                document[role] = response.json()
            check()
            # Retry only the idempotent completion after an uncertain transport response.
            target = '/draft' if draft is not None else '/finish'
            with lock:
                try:
                    return post(target, document)
                except httpx.TransportError:
                    check()
                    return post(target, document)
        except LeaseLost:
            raise
        except Exception:
            if not lost.is_set() and not self.shutdown.is_set():
                try:
                    post('/fail', {'category': 'conversion_failed'})
                except Exception:
                    pass
            raise
        finally:
            done.set()
            thread.join(timeout=65)
            if folder.resolve().parent != work_root:
                raise RuntimeError('Music attempt cleanup left its work directory.')
            shutil.rmtree(folder)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pipeline', choices=tuple(PIPELINES), required=True)
    parser.add_argument('--work-dir', type=Path, default=Path('outputs/music-jobs'))
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--profile', type=Path, help='Exact run profile JSON; required unless --fixture')
    parser.add_argument('--weights', type=Path, help='Pinned model weights file')
    parser.add_argument('--code', type=Path, help='Pinned executed adapter script or executable bundle')
    parser.add_argument('--config', type=Path, help='Pinned inference configuration file')
    parser.add_argument('--approval', type=Path, help='Retained commercial evidence file')
    parser.add_argument('--fixture', action='store_true', help='Explicit fixture mode; never for production')
    parser.add_argument('--allow-insecure-local', action='store_true', help='Permit plain HTTP to a local mock only')
    parser.add_argument('--adapter-command', nargs=argparse.REMAINDER, required=True)
    args = parser.parse_args()
    if args.fixture and args.profile:
        parser.error('Choose either --profile or explicit --fixture.')
    if not args.fixture and not args.profile:
        parser.error('An exact run profile is required; use --fixture only for tests.')
    profile = None
    if args.profile:
        missing = [name for name in ('weights', 'code', 'config', 'approval') if getattr(args, name) is None]
        if missing:
            parser.error('A profile requires ' + ', '.join('--' + name for name in missing) + '.')
        try:
            profile = load_profile(args.profile, weights=args.weights, code=args.code,
                                   config=args.config, approval=args.approval)
        except (OSError, ValueError) as error:
            parser.error(str(error))
    token = os.environ.get('WORKER_TOKEN', '').strip()
    if not token and os.environ.get('WORKER_TOKEN_FILE'):
        token = Path(os.environ['WORKER_TOKEN_FILE']).read_text(encoding='utf-8').strip()
    if not token:
        parser.error('WORKER_TOKEN or WORKER_TOKEN_FILE is required.')
    worker = MusicWorker(os.environ.get('WORKER_API_URL', 'http://127.0.0.1:8001'),
                         token, args.pipeline, args.adapter_command, args.work_dir,
                         profile=profile, fixture=args.fixture, allow_insecure_local=args.allow_insecure_local)
    for name in ('SIGINT', 'SIGTERM'):
        signal.signal(getattr(signal, name), lambda *_: worker.shutdown.set())
    while not worker.shutdown.is_set():
        try:
            job = worker.claim()
            if job:
                worker.run(job)
        except Exception as error:
            print(f'Music worker stopped attempt ({type(error).__name__}).', flush=True)
        if args.once:
            return
        worker.shutdown.wait(5)


if __name__ == '__main__':
    main()
