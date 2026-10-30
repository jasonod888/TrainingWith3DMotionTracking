"""Package only the accepted local demonstration; never upload it automatically."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apps.api.contracts import LessonManifest

def package_demo(folder=ROOT/'web/dist/assets'):
    reference = json.loads((folder/'reference.json').read_text(encoding='utf-8'))
    duration = reference['duration']
    ends = [10.6,12.5,13.7,14.9,16,17.2,18.1,19.3,20.5,21.7,22.6,24.1,24.8,26,27.5,29,30.3,31.7,35.5]
    boundaries = [0, *[v for v in ends if v < duration-.05], duration]
    def asset(name,mime):
        data = (folder/name).read_bytes()
        return {'key':f'demo/{name}','mime':mime,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    thumbnail = folder/'thumbnail.jpg'
    if not thumbnail.exists():
        subprocess.run(['ffmpeg','-loglevel','error','-ss',str(reference['sourceStart']+2),'-i',str(folder/'demonstration.mp4'),'-frames:v','1','-vf','scale=960:-2',str(thumbnail)],check=True)
    manifest = LessonManifest.model_validate({
        'lesson_id':'taegeuk-demo','revision_id':'taegeuk-demo-v1','title':'Taegeuk 1',
        'duration':duration,'source_start':reference['sourceStart'],'engine':'sam-3d-body',
        'engine_version':'b5c765a0d89d789985e186d396315e7590887b94','root_motion':'estimated-camera-relative',
        'confidence':'unmeasured','standing_time':reference['standingTime'],
        'animation':asset('reference.glb','model/gltf-binary'),'landmarks':asset('reference.json','application/json'),
        'source_video':asset('demonstration.mp4','video/mp4'),'thumbnail':asset('thumbnail.jpg','image/jpeg'),
        'section_set':{'id':'taegeuk-sections','revision':1,'duration':duration,'sections':[
            {'id':f'move-{i+1:02}','start':start,'end':boundaries[i+1],
             'label':'Opening & ready' if i==0 else 'Finish & bow' if i==len(boundaries)-2 else f'Move {i:02}'}
            for i,start in enumerate(boundaries[:-1])]},
        'warnings':['Prototype reference. Similarity is not expert technique assessment.','Source demonstration is for local development; confirm rights before hosted distribution.']})
    (folder/'manifest.json').write_text(manifest.model_dump_json(indent=2),encoding='utf-8')
    print('Prepared local demonstration manifest and thumbnail.')

if __name__ == '__main__':
    package_demo()
