"""Best-effort fixed-camera source correction before avatar conversion.

Missing models, ambiguous camera motion or failed geometry leave the valid raw
export intact and produce an explicit status. No clip-specific regions are used.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np

ROOT=Path(__file__).resolve().parents[1]


def camera_is_fixed(frames, masks):
    import cv2
    paths=sorted(Path(frames).glob('*.jpg'))
    transforms=[]
    for index in range(0,len(paths)-15,15):
        a=cv2.imread(str(paths[index]),0);b=cv2.imread(str(paths[index+15]),0)
        mask=cv2.imread(str(Path(masks)/paths[index].with_suffix('.png').name),0)
        available=255-cv2.dilate(mask,np.ones((41,41),np.uint8))
        points=cv2.goodFeaturesToTrack(a,200,.02,12,mask=available)
        if points is None or len(points)<20:
            return False
        moved,status,_=cv2.calcOpticalFlowPyrLK(a,b,points,None)
        good=status[:,0]>0
        matrix,inliers=cv2.estimateAffinePartial2D(points[good],moved[good],method=cv2.RANSAC,ransacReprojThreshold=1.5)
        if matrix is None or inliers.mean()<.65:
            return False
        scale=np.hypot(matrix[0,0],matrix[0,1])
        if abs(scale-1)>.01 or np.linalg.norm(matrix[:,2])>3 or abs(matrix[1,0])>.01:
            return False
        transforms.append(matrix[:,2])
    return bool(transforms) and np.linalg.norm(np.sum(transforms,axis=0))<5


def process(video,motion,source,work):
    work.mkdir(parents=True,exist_ok=True)
    report={'version':'floor-guided-v2','status':'skipped','reason':'unavailable'}
    try:
        sam=Path(os.environ.get('FORM_SAM2_SOURCE',ROOT/'.local/sam2'))
        sam_weights=Path(os.environ.get('FORM_SAM2_CHECKPOINT',ROOT/'models/sam2.1_hiera_small.pt'))
        moge=Path(os.environ.get('FORM_MOGE_SOURCE',ROOT/'.local/MoGe'))
        moge_weights=Path(os.environ.get('FORM_MOGE_CHECKPOINT',ROOT/'models/moge-2-vitb-normal/model.pt'))
        if not all(p.exists() for p in (sam,sam_weights,moge,moge_weights)):
            report['reason']='models-unavailable';return report
        with np.load(motion,allow_pickle=False) as data:
            duration=float(data['timestamps'][-1]-data['timestamps'][0])
        if duration>180 or duration<1:
            report['reason']='unsupported-duration';return report
        def command(script,*args):
            subprocess.run([sys.executable,str(ROOT/'scripts'/script),*map(str,args)],check=True)
        command('build_foot_mask_experiment.py','--video',video,'--motion',motion,
                '--output',work,'--duration',duration+.1,'--sam2',sam,'--checkpoint',sam_weights,
                '--chunk-frames',120,'--assets-only')
        if not camera_is_fixed(work/'frames',work/'masks'):
            report['reason']='camera-motion-or-uncertain';return report
        command('build_moge_floor_experiment.py','--experiment',work,'--source',source,
                '--motion',motion,'--checkpoint',moge_weights,'--automatic','--assets-only')
        details=json.loads((work/'floor-data.json').read_text())
        if details['support_fraction']<.5 or details['floor_fit']['p95_residual_m']>.08:
            report['reason']='insufficient-evidence';return report
        # Builder checks identity, timestamps and every unchanged pose track.
        candidate=source.with_name('.grounded-reference.glb')
        shutil.copyfile(work/'floor-guided.glb',candidate)
        shutil.copyfile(source,work/'raw-reference.glb')
        candidate.replace(source)
        report.update(status='applied',reason=None,selection='automatic',
                      support_fraction=details['support_fraction'],floor_fit=details['floor_fit'],
                      max_correction_m=details['max_correction_m'])
        return report
    except Exception as exc:
        report.update(reason='correction-failed',error_type=type(exc).__name__)
        return report
    finally:
        (work/'grounding-summary.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('video','motion','source','output'):
        p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();print(json.dumps(process(a.video,a.motion,a.source,a.output),indent=2))
