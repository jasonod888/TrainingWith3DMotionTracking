"""Outbound-only conversion worker: no database, bucket credentials or browser sessions.

Two local body pipelines are served, selected by the job's `pipeline_version` and
gated by the worker credential's exact `(provider, pipeline_version)` scope:

* ``sam-3d-body-v1``  — the GPU SAM 3D Body + SAM 2 + MHR-to-GLB + Mixamo route.
  Extracted verbatim into :meth:`Worker.run_sam_3d_body`; its behaviour, assets and
  completion payload are unchanged.
* ``body-mediapipe-v1`` — the CPU MediaPipe heavy route. Video-only: it normalises to
  1920 px / <= 30 fps, runs the Pose Landmarker in VIDEO mode, and writes landmarks
  plus the model's own segmentation. No GLB, SAM 2, avatar or Mixamo step.

MediaPipe availability is a deployment choice. A job whose pipeline this worker does
not own is never claimed (the API scopes credentials), and an unexpected pipeline is
refused rather than silently processed by the wrong model.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import struct
import subprocess
import sys
import threading
import time
from urllib.parse import urlparse

import httpx

ROOT=Path(__file__).resolve().parents[1]
SAM_PIPELINE_VERSION='sam-3d-body-v1'
SAM_ENGINE_VERSION='b5c765a0d89d789985e186d396315e7590887b94'
MEDIAPIPE_PIPELINE_VERSION='body-mediapipe-v1'
MEDIAPIPE_ENGINE_VERSION='mediapipe-pose-heavy-v1'
# Normalisation ceilings. The client also clamps, but the server never trusts it.
MAX_PREVIEW_EDGE=1920
MAX_PREVIEW_FPS=30


class LeaseLost(Exception):pass
class InvalidVideo(Exception):pass


class Worker:
    def __init__(self,url,token):
        parsed=urlparse(url)
        if parsed.scheme!='https' and parsed.hostname not in ('localhost','127.0.0.1','host.docker.internal'):
            raise ValueError('Remote worker connections require HTTPS.')
        self.api=httpx.Client(base_url=url.rstrip('/'),headers={'Authorization':f'Bearer {token}'},timeout=60,trust_env=False)

    def prepare_avatars(self,folder,headers,path,command):
        """Retarget both avatars and upload the clips while the lease is still valid.

        Uploads must happen before `/finish`, which releases the lease; `/derivatives` then
        attaches them to the lesson.
        """
        avatars=folder/'avatars';avatars.mkdir(parents=True,exist_ok=True)
        reports=[]
        for avatar in ('male','female'):
            command([sys.executable,str(ROOT/'scripts/retarget_mixamo.py'),
                     '--source',str(folder/'reference.glb'),'--avatar',avatar,
                     '--output',str(avatars/f'avatar-{avatar}.glb'),
                     '--report',str(avatars/f'avatar-{avatar}.json')],timeout=600)
            reports.append(json.loads((avatars/f'avatar-{avatar}.json').read_text(encoding='utf-8')))
        summary={'schema':1,'avatars':{report['target']['avatar_id']:report for report in reports},
                 'source':{'file':'reference.glb','sha256':hashlib.sha256((folder/'reference.glb').read_bytes()).hexdigest()}}
        grounding=folder/'grounding/grounding-summary.json'
        if grounding.exists():summary['grounding']=json.loads(grounding.read_text())
        (avatars/'avatar-report.json').write_text(json.dumps(summary,separators=(',',':')),encoding='utf-8')
        uploaded={}
        for name in ('avatar-male.glb','avatar-female.glb','avatar-report.json'):
            with (avatars/name).open('rb') as file:
                response=self.api.put(path+'/files/'+name,headers={**headers,'Content-Type':'application/octet-stream'},content=file)
            response.raise_for_status();uploaded[name]=response.json()
        return uploaded

    def publish_avatars(self,uploaded,headers,path,job_id):
        """Attach the uploaded clips to the finished lesson."""
        result=self.api.post(path+'/derivatives',headers=headers,json={
            'male':uploaded['avatar-male.glb'],'female':uploaded['avatar-female.glb'],
            'report':uploaded['avatar-report.json']})
        result.raise_for_status()
        print(f'Conversion {job_id}: avatar clips published ({len(result.json().get("stored",[]))} assets).',flush=True)

    def run(self,job):
        """Shared lease, download and probe, then dispatch to the pipeline handler."""
        pipeline=job.get('pipeline_version',SAM_PIPELINE_VERSION)
        if job.get('provider','local')!='local':
            raise ValueError('This CPU worker only serves local pipelines.')
        if pipeline not in (SAM_PIPELINE_VERSION,MEDIAPIPE_PIPELINE_VERSION):
            raise ValueError('This worker does not support that pipeline.')
        job_id=job['id'];lease=job['attempt_token']
        if not all(value and len(value)<81 and all(c in '0123456789abcdef' for c in value) for value in (job_id,lease)):raise ValueError('Invalid job identity.')
        folder=ROOT/'outputs/jobs'/job_id/lease
        folder.mkdir(parents=True,exist_ok=False)
        if shutil.disk_usage(folder).free<5*1024**3:raise RuntimeError('Worker needs 5 GB free temporary storage.')
        headers={'X-Job-Lease':lease};path=f'/api/worker/jobs/{job_id}'
        stage={'stage':'validating','frames':0};lost=threading.Event();done=threading.Event();stage_lock=threading.Lock()
        def pulse():
            while not done.is_set():
                try:
                    with stage_lock:result=self.api.post(path+'/heartbeat',headers=headers,json=dict(stage))
                    if result.status_code in (401,409):lost.set();return
                    result.raise_for_status()
                except httpx.HTTPError:
                    lost.set();return  # Stop work rather than risk finalising after a lost lease.
                if done.wait(15):return
        thread=threading.Thread(target=pulse,daemon=True);thread.start()
        def check():
            if lost.is_set():raise LeaseLost()
        def advance(value):
            check()
            with stage_lock:
                stage['stage']=value
                result=self.api.post(path+'/heartbeat',headers=headers,json=dict(stage));result.raise_for_status()
        def command(args,timeout=240,progress=None):
            check();log=folder/f'command-{time.time_ns()}.log'
            with log.open('w',encoding='utf-8') as output:
                process=subprocess.Popen(args,cwd=ROOT,stdout=output,stderr=subprocess.STDOUT,start_new_session=os.name!='nt')
                began=time.monotonic()
                try:
                    while process.poll() is None:
                        check()
                        if time.monotonic()-began>timeout:raise RuntimeError('Processing time limit exceeded.')
                        if stage['stage']=='processing':
                            text=log.read_text(encoding='utf-8',errors='replace')
                            # The SAM pipeline logs CUDA peak memory once per frame; the
                            # MediaPipe pipeline logs its own frame counter instead.
                            stage['frames']=progress(text) if progress else text.count('CUDA peak')
                        time.sleep(.3)
                    if process.returncode:raise RuntimeError('Processing command failed; see local attempt log.')
                finally:
                    if process.poll() is None:
                        if os.name!='nt':os.killpg(process.pid,signal.SIGTERM)
                        else:process.terminate()
                        try:process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            if os.name!='nt':os.killpg(process.pid,signal.SIGKILL)
                            else:process.kill()
                            process.wait()
        try:
            source=folder/'input.bin';checksum=hashlib.sha256();total=0
            with self.api.stream('GET',path+'/source',headers=headers) as response,source.open('wb') as file:
                response.raise_for_status()
                for chunk in response.iter_bytes(1024*1024):
                    check();total+=len(chunk)
                    if total>job['bytes']:raise InvalidVideo('Source exceeded its declared size.')
                    checksum.update(chunk);file.write(chunk)
            if total!=job['bytes'] or checksum.hexdigest()!=job['sha256']:raise InvalidVideo('Source checksum mismatch.')
            probe=subprocess.run(['ffprobe','-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0','-show_entries','stream=width,height,codec_name:format=duration,format_name','-of','json',str(source)],capture_output=True,text=True,timeout=20)
            if probe.returncode:raise InvalidVideo('Unsupported video.')
            metadata=json.loads(probe.stdout);streams=metadata.get('streams',[])
            if not streams or not set(metadata.get('format',{}).get('format_name','').split(','))&{'mov','mp4','matroska','webm','avi'}:raise InvalidVideo('Unsupported video container.')
            video=streams[0];duration=float(metadata['format']['duration'])
            if not (0<duration<=1800 and 0<video['width']<=4096 and 0<video['height']<=4096 and job['start']+job['duration']<=duration+.1):raise InvalidVideo('Video dimensions, duration or trim range exceed limits.')
            if pipeline==MEDIAPIPE_PIPELINE_VERSION:
                self.run_mediapipe(job,folder,command,check,advance,stage,headers,path,source)
            else:
                self.run_sam_3d_body(job,folder,command,check,advance,stage,headers,path)
        except LeaseLost:
            print(f'Conversion {job_id}: stopped after cancellation or lost lease.',flush=True)
        except Exception as exc:
            if not lost.is_set():
                category='invalid_video' if isinstance(exc,InvalidVideo) else 'conversion_failed'
                try:self.api.post(path+'/fail',headers=headers,json={'category':category})
                except httpx.HTTPError:pass
            print(f'Conversion {job_id}: failed ({type(exc).__name__}); inspect local attempt logs.',flush=True)
        finally:
            done.set();thread.join(timeout=20)

    # ------------------------------------------------------------------ SAM 3D Body
    def run_sam_3d_body(self,job,folder,command,check,advance,stage,headers,path):
        """The existing GPU pipeline, unchanged: a 1280 px / 15 fps preview, SAM 3D Body
        motion, MHR-to-GLB export, optional grounding, SAM 2 instructor segmentation,
        reference.json, avatars, then completion."""
        job_id=job['id'];lease=job['attempt_token']
        source=folder/'input.bin'
        preview=folder/'preview.mp4'
        command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe','-ss',str(job['start']),'-i',str(source),'-t',str(job['duration']),'-map','0:v:0','-an','-sn','-dn','-map_metadata','-1','-vf',"scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=15",'-c:v','libx264','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(preview)])
        advance('processing')
        # Normalisation already produces 15 fps. Preserve every resulting frame.
        command([sys.executable,str(ROOT/'scripts/process_video.py'),str(preview),'--duration',str(job['duration']),'--fps','0','--output',str(folder/'motion')],timeout=max(1800,job['duration']*15))
        advance('exporting')
        # Opt-in diagnostics only: image tracking is not proof of support.
        # Failure must not discard an otherwise valid source reconstruction.
        if os.environ.get('FORM_GROUNDING_DIAGNOSTICS') == '1':
            try:
                command([sys.executable,str(ROOT/'scripts/ground_motion.py'),
                         str(folder/'motion/motion.npz'),'--video',str(preview),
                         '--output',str(folder/'grounding')],timeout=max(240,job['duration']*5))
            except Exception as exc:
                check()
                print(f'Grounding diagnostics unavailable ({type(exc).__name__}).',flush=True)
        command([sys.executable,str(ROOT/'scripts/export_glb.py'),str(folder/'motion/motion.npz'),'--output',str(folder/'reference.glb')])
        grounding={'status':'skipped','reason':'disabled'}
        if os.environ.get('FORM_SOURCE_GROUNDING','auto')!='off':
            try:
                command([sys.executable,str(ROOT/'scripts/source_grounding.py'),
                    '--video',str(preview),'--motion',str(folder/'motion/motion.npz'),
                    '--source',str(folder/'reference.glb'),'--output',str(folder/'grounding')],
                    timeout=max(600,job['duration']*12))
                grounding=json.loads((folder/'grounding/grounding-summary.json').read_text())
            except Exception:
                check();grounding={'status':'skipped','reason':'correction-failed'}
        advance('verifying')
        # Every local project gets the approved presentation, even if floor
        # correction is disabled, unavailable or outside its duration scope.
        # Reuse its masks when valid; otherwise segment independently.
        focused=None
        try:
            from instructor_pipeline import prepare_instructor
            focused=prepare_instructor(folder,command,job['duration'])
        except Exception as exc:
            check()
            print(f'Focused instructor video unavailable ({type(exc).__name__}).',flush=True)
        import numpy as np
        from pygltflib import GLTF2
        with np.load(folder/'motion/motion.npz',allow_pickle=False) as data:
            times=data['timestamps']-data['timestamps'][0];points=data['pred_keypoints_3d']
            if len(times)<2 or not np.isfinite(points).all() or np.any(np.diff(times)<=0):raise InvalidVideo('Unusable motion frames.')
            heights=np.max(points[:,[13,14,15,18],1],axis=1)-points[:,0,1];standing=int(np.argmax(heights))
            reference={'duration':float(times[-1]),'times':times.round(6).tolist(),'keypoints':points.round(6).tolist(),'standingTime':float(times[standing]),'sourceStart':0,'sourceTimestampMap':{'start':job['start'],'normalised_fps':15},'axes':'x-right/y-down/z-forward'}
            stage['frames']=len(times)
        if focused:
            instructor_report=json.loads(focused.with_suffix('.json').read_text(encoding='utf-8'))
            if instructor_report.get('instructor_markers'):reference['instructorMarkers']=instructor_report['instructor_markers']
        gltf=GLTF2().load(str(folder/'reference.glb'))
        if not gltf.skins or not gltf.meshes or not gltf.animations:raise InvalidVideo('Animation export is incomplete.')
        for animation in gltf.animations:
            for sampler in animation.samplers:
                accessor=gltf.accessors[sampler.input];view=gltf.bufferViews[accessor.bufferView]
                actual=np.frombuffer(gltf.binary_blob(),dtype='<f4',count=accessor.count,offset=(view.byteOffset or 0)+(accessor.byteOffset or 0))
                np.testing.assert_allclose(actual,times,atol=1e-5)
                output=gltf.accessors[sampler.output];buffer=gltf.bufferViews[output.bufferView]
                values=np.frombuffer(gltf.binary_blob(),dtype='<f4',count=buffer.byteLength//4,offset=buffer.byteOffset or 0)
                if not np.isfinite(values).all():raise InvalidVideo('Non-finite animation.')
        (folder/'reference.json').write_text(json.dumps(reference,separators=(',',':')),encoding='utf-8')
        command(['ffmpeg','-nostdin','-v','error','-ss',str(reference['standingTime']),'-i',str(preview),'-frames:v','1','-vf','scale=640:-2',str(folder/'thumbnail.jpg')])
        assets={}
        for name in ('reference.glb','reference.json','preview.mp4','thumbnail.jpg'):
            check()
            with (folder/name).open('rb') as file:
                response=self.api.put(path+'/files/'+name,headers={**headers,'Content-Type':'application/octet-stream'},content=file)
            response.raise_for_status();assets[name]=response.json()
        if focused:
            try:
                with focused.open('rb') as file:
                    response=self.api.put(path+'/files/instructor.mp4',headers={**headers,'Content-Type':'application/octet-stream'},content=file)
                response.raise_for_status();assets['instructor.mp4']=response.json()
            except Exception as exc:
                check();focused=None
                print(f'Focused instructor upload unavailable ({type(exc).__name__}).',flush=True)
        # The transparent variant is optional: compositing falls back to side by side.
        alpha=focused.with_name(focused.stem+'-alpha.webm') if focused else None
        if alpha and alpha.is_file():
            try:
                with alpha.open('rb') as file:
                    response=self.api.put(path+'/files/instructor-alpha.webm',headers={**headers,'Content-Type':'application/octet-stream'},content=file)
                response.raise_for_status();assets['instructor-alpha.webm']=response.json()
            except Exception as exc:
                check();print(f'Transparent instructor upload unavailable ({type(exc).__name__}).',flush=True)
        manifest={'schema_version':1,'lesson_id':job_id,'revision_id':lease,'title':job['title'],'duration':reference['duration'],'source_start':0,
            'engine':'sam-3d-body','engine_version':SAM_ENGINE_VERSION,'units':'metres','landmark_axes':'x-right/y-down/z-forward','root_motion':'estimated-camera-relative','confidence':'unmeasured','standing_time':reference['standingTime'],
            'animation':assets['reference.glb'],'landmarks':assets['reference.json'],'source_video':assets['preview.mp4'],'thumbnail':assets['thumbnail.jpg'],
            'section_set':{'id':job_id,'revision':1,'duration':reference['duration'],'sections':[{'id':'whole','label':'Full movement','start':0,'end':reference['duration']}]},
            'warnings':['Review the reconstruction before teaching. Pose accuracy and foot contact are not certified.',f'Source range starts at {job["start"]}s; preview is normalised to 15 fps with audio removed.']}
        # Avatar presentation is derived from the canonical export. Uploads must happen
        if focused:
            manifest['focused_video']=assets['instructor.mp4']
            manifest['focused_video_start']=0.
            if 'instructor-alpha.webm' in assets:manifest['focused_video_alpha']=assets['instructor-alpha.webm']
        else:manifest['warnings'].append('Person-only instructor video could not be prepared (unrepaired matte gap or derivative failure). The original wide video remains available.')
        if grounding['status']=='applied':
            manifest['root_motion']='floor-guided'
            manifest['warnings'].append('Floor movement was corrected using a fixed-camera estimate; review tracking and foot placement.')
        else:
            manifest['warnings'].append(f"Floor movement correction was not applied ({grounding.get('reason','unavailable')}).")
        # before finish (that releases the lease) and attaching them after; a failure at
        # either step must never fail the lesson, which stays fully usable.
        prepared=None
        try:prepared=self.prepare_avatars(folder,headers,path,command)
        except Exception as exc:
            print(f'Conversion {job_id}: avatar clips could not be built ({type(exc).__name__}); '
                  'the canonical lesson is unaffected.',flush=True)
        check();result=self.api.post(path+'/finish',headers=headers,json=manifest);result.raise_for_status()
        print(f'Conversion {job_id}: ready for section review.',flush=True)
        lesson_id=(result.json() or {}).get('lesson_id')
        if prepared and lesson_id:
            try:self.publish_avatars(prepared,headers,path,job_id)
            except Exception as exc:
                print(f'Conversion {job_id}: avatar clips unavailable ({type(exc).__name__}); '
                      'the canonical lesson is unaffected.',flush=True)

    # -------------------------------------------------------------------- MediaPipe
    def run_mediapipe(self,job,folder,command,check,advance,stage,headers,path,source):
        """CPU MediaPipe heavy route: video-only, no GLB, no SAM 2 and no avatars."""
        from process_video_mediapipe import (LANDMARK_FORMAT, frame_rate_filter, normalized_clock,
                                             playback_duration, probe_video, standing_frame,
                                             target_frame_rate, thumbnail_frame)
        import numpy as np

        job_id=job['id'];lease=job['attempt_token']
        upload=probe_video(source)
        rate=target_frame_rate(upload['source_fps'])
        if rate>MAX_PREVIEW_FPS:rate=MAX_PREVIEW_FPS
        fps_filter=frame_rate_filter(rate)
        preview=folder/'preview.mp4'
        # Always re-normalise: the worker never trusts a client's dimensions or rate.
        # `force_original_aspect_ratio=decrease` on the auto-rotated frame keeps the
        # 1920 px longest-edge ceiling for portrait phone clips, and
        # `force_divisible_by=2` guarantees even dimensions for yuv420p.
        command(['ffmpeg','-nostdin','-v','error','-protocol_whitelist','file,pipe',
                 '-ss',str(job['start']),'-i',str(source),'-t',str(job['duration']),
                 '-map','0:v:0','-an','-sn','-dn','-map_metadata','-1',
                 '-vf',(f"scale=w='min({MAX_PREVIEW_EDGE},iw)':h='min({MAX_PREVIEW_EDGE},ih)'"
                        ':force_original_aspect_ratio=decrease:force_divisible_by=2,'
                        f'fps={fps_filter}'),
                 '-c:v','libx264','-preset','veryfast','-crf','23','-maxrate','6M','-bufsize','12M',
                 '-pix_fmt','yuv420p','-movflags','+faststart',str(preview)])
        produced=probe_video(preview)
        if max(produced['width'],produced['height'])>MAX_PREVIEW_EDGE:
            raise InvalidVideo('Normalised preview exceeded the 1920 px ceiling.')
        # One authoritative clock, probed from the file that is actually processed.
        times,fps=normalized_clock(preview)
        if fps>MAX_PREVIEW_FPS+1e-3:raise InvalidVideo('Normalised preview exceeded 30 fps.')
        advance('processing')
        command([sys.executable,str(ROOT/'scripts/process_video_mediapipe.py'),str(preview),
                 '--output',str(folder/'motion'),'--model',str(ROOT/'models/pose_landmarker_heavy.task')],
                timeout=max(1800,job['duration']*20),
                progress=lambda text: text.count('MediaPipe frame'))
        advance('verifying')
        with np.load(folder/'motion/mediapipe.npz',allow_pickle=False) as data:
            stamps=np.asarray(data['timestamps'],dtype=np.float64)
            world=np.asarray(data['world_landmarks'],dtype=np.float32)
            image=np.asarray(data['image_landmarks'],dtype=np.float32)
            visibility=np.asarray(data['visibility'],dtype=np.float32)
        if (world.shape!=(len(times),33,3) or image.shape!=(len(times),33,2)
                or visibility.shape!=(len(times),33)):
            raise InvalidVideo('MediaPipe landmarks do not match the authoritative clock.')
        if not np.allclose(stamps,times,atol=1e-6):
            raise InvalidVideo('MediaPipe inference used a different frame clock.')
        quality=json.loads((folder/'motion/mediapipe.json').read_text(encoding='utf-8'))
        width,height=produced['width'],produced['height']
        # `standing_time` is only ever taken from a confident upright full-body frame.
        # Without one, the poster frame stands in and the flag tells every consumer not
        # to treat it as a height reference.
        stand=standing_frame(world,image,visibility,times,width,height)
        poster=thumbnail_frame(world,image,visibility,times,width,height)
        duration=playback_duration(times,fps,produced.get('duration'))
        poster_time=float(times[poster])
        if duration>0:poster_time=min(poster_time,max(0.0,duration-1e-3))
        standing_available=stand is not None
        standing_time=float(times[stand]) if standing_available else poster_time
        standing_time=min(max(0.0,standing_time),duration)
        reference={'duration':duration,'times':times.round(6).tolist(),
                   'keypoints':world.round(6).tolist(),'visibility':visibility.round(6).tolist(),
                   'landmarkFormat':LANDMARK_FORMAT,'root_motion':'hip-relative',
                   'standingTime':standing_time,'standingCalibrationAvailable':standing_available,
                   'sourceStart':0,'sourceTimestampMap':{'start':job['start'],'normalised_fps':fps},
                   'axes':'x-right/y-down/z-forward','frameRate':fps}
        command(['ffmpeg','-nostdin','-v','error','-ss',f'{poster_time:.6f}','-i',str(preview),
                 '-frames:v','1','-vf','scale=640:-2',str(folder/'thumbnail.jpg')])
        focused=None
        if quality.get('segmentation',{}).get('available'):
            try:
                from instructor_pipeline import prepare_mediapipe_instructor
                focused=prepare_mediapipe_instructor(folder,command,job['duration'])
            except Exception as exc:
                check()
                print(f'Focused instructor video unavailable ({type(exc).__name__}).',flush=True)
        else:
            print('MediaPipe matte has an unrepaired gap; focused/alpha derivatives disabled while preview and reference are kept.',flush=True)
        if focused:
            # The same reference carries the anatomical hand/foot guides the focused
            # video uses, stamped with that video's hash by the compositor.
            instructor_report=json.loads(focused.with_suffix('.json').read_text(encoding='utf-8'))
            if instructor_report.get('instructor_markers'):reference['instructorMarkers']=instructor_report['instructor_markers']
        (folder/'reference.json').write_text(json.dumps(reference,separators=(',',':'),allow_nan=False),encoding='utf-8')
        assets={}
        for name in ('reference.json','preview.mp4','thumbnail.jpg'):
            check()
            with (folder/name).open('rb') as file:
                response=self.api.put(path+'/files/'+name,headers={**headers,'Content-Type':'application/octet-stream'},content=file)
            response.raise_for_status();assets[name]=response.json()
        if focused:
            try:
                with focused.open('rb') as file:
                    response=self.api.put(path+'/files/instructor.mp4',headers={**headers,'Content-Type':'application/octet-stream'},content=file)
                response.raise_for_status();assets['instructor.mp4']=response.json()
            except Exception as exc:
                check();focused=None
                print(f'Focused instructor upload unavailable ({type(exc).__name__}).',flush=True)
        alpha=focused.with_name(focused.stem+'-alpha.webm') if focused else None
        if alpha and alpha.is_file():
            try:
                with alpha.open('rb') as file:
                    response=self.api.put(path+'/files/instructor-alpha.webm',headers={**headers,'Content-Type':'application/octet-stream'},content=file)
                response.raise_for_status();assets['instructor-alpha.webm']=response.json()
            except Exception as exc:
                check();print(f'Transparent instructor upload unavailable ({type(exc).__name__}).',flush=True)
        warnings=['Review the movement before teaching. Pose accuracy is not certified.',
                  f'Source range starts at {job["start"]}s; preview is normalised to {fps:.3f} fps with audio removed.']
        if not standing_available:
            warnings.append('No confident upright full-body frame was found, so standing calibration is unavailable; practice uses a confident frame instead.')
        manifest={'schema_version':1,'lesson_id':job_id,'revision_id':lease,'title':job['title'],
                  'duration':duration,'source_start':0,'frame_rate':fps,
                  'engine':'mediapipe','engine_version':MEDIAPIPE_ENGINE_VERSION,
                  'units':'metres','landmark_axes':'x-right/y-down/z-forward',
                  'root_motion':'hip-relative','confidence':'unmeasured',
                  'standing_time':standing_time,
                  # Video-only: the contract allows a null animation and requires the source.
                  'animation':None,
                  'landmarks':assets['reference.json'],'source_video':assets['preview.mp4'],
                  'thumbnail':assets['thumbnail.jpg'],
                  'section_set':{'id':job_id,'revision':1,'duration':duration,
                                 'sections':[{'id':'whole','label':'Full movement','start':0,'end':duration}]},
                  'warnings':warnings}
        if focused:
            manifest['focused_video']=assets['instructor.mp4']
            manifest['focused_video_start']=0.
            if 'instructor-alpha.webm' in assets:manifest['focused_video_alpha']=assets['instructor-alpha.webm']
        else:
            warnings.append('Person-only instructor video could not be prepared (unrepaired matte gap or derivative failure). The original wide video remains available.')
        # Deliberately no export_glb, no source_grounding, no avatars and no /derivatives.
        check();result=self.api.post(path+'/finish',headers=headers,json=manifest);result.raise_for_status()
        print(f'Conversion {job_id}: ready for section review.',flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--once',action='store_true');args=parser.parse_args()
    worker=Worker(os.environ.get('WORKER_API_URL','http://127.0.0.1:8001'),os.environ['WORKER_TOKEN'])
    while True:
        try:
            response=worker.api.post('/api/worker/claim',json={});response.raise_for_status();job=response.json()
            if job:worker.run(job)
        except httpx.HTTPError:
            print('Worker connection unavailable; waiting to reconnect.',flush=True)
        if args.once:return
        time.sleep(5)


if __name__=='__main__':main()
