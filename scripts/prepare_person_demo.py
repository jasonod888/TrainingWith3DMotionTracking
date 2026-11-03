"""Prepare or install person-only footage for the exact local Taegeuk 1 demo.

Run without --install, segment the generated preview/motion with the existing
GPU mask builder, then run with --install. Never changes the lesson clock or 3D.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from focus_instructor_video import digest,export

ROOT=Path(__file__).resolve().parents[1]


def prepare(folder,install=False,edge_style='outlined'):
    assets=ROOT/'web/dist/assets'
    source=assets/'demonstration.mp4'
    manifest_path=assets/'manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    folder.mkdir(parents=True,exist_ok=True)
    original_hash=digest(source)
    if not install:
        import cv2
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-an','-vf','fps=15',
                        '-c:v','libx264','-crf','18',str(folder/'preview.mp4')],check=True)
        cap=cv2.VideoCapture(str(folder/'preview.mp4'));frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));cap.release()
        times=np.arange(frames)/15
        with np.load(ROOT/'outputs/full_video/motion.npz',allow_pickle=False) as data:
            points=data['pred_keypoints_2d'];old=data['timestamps']
            projected=np.stack([np.interp(times,old,points[:,joint,axis])
                                for joint in range(points.shape[1]) for axis in range(2)],axis=1).reshape(frames,-1,2)
        np.savez_compressed(folder/'motion.npz',timestamps=times,frame_indices=np.arange(frames),
                            pred_keypoints_2d=projected,pred_cam_t=np.zeros((frames,3)))
        (folder/'source.json').write_text(json.dumps({'original_sha256':original_hash,
            'preview_sha256':digest(folder/'preview.mp4'),'motion_sha256':digest(folder/'motion.npz')}),encoding='utf-8')
        print('Prepared the exact demo for segmentation. Run the mask builder next, then --install.')
        return
    provenance=json.loads((folder/'source.json').read_text())
    if (provenance['original_sha256']!=original_hash or provenance['preview_sha256']!=digest(folder/'preview.mp4')
            or provenance['motion_sha256']!=digest(folder/'motion.npz')):
        raise ValueError('The demo source or segmentation prompt changed. Prepare it again.')
    start=manifest['source_start'];end=start+manifest['duration']
    video=folder/'instructor-person.mp4'
    report=export(folder/'preview.mp4',folder/'motion.npz',video,folder/'segmentation',active_range=(start,end),edge_style=edge_style)
    name=f'instructor-person-{report["video_sha256"][:12]}.mp4'
    shutil.copyfile(video,assets/name)
    report['demo_source_sha256']=original_hash
    (assets/Path(name).with_suffix('.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    manifest['focused_video']={'key':f'demo/{name}','mime':'video/mp4','bytes':video.stat().st_size,'sha256':report['video_sha256']}
    # Presentation coordinates travel with the existing authorized landmark
    # asset; scoring geometry and its original clock remain unchanged.
    reference_path=assets/Path(manifest['landmarks']['key']).name
    reference=json.loads(reference_path.read_text(encoding='utf-8'))
    if report.get('instructor_markers'):reference['instructorMarkers']=report['instructor_markers']
    reference_path.write_text(json.dumps(reference,separators=(',',':')),encoding='utf-8')
    manifest['landmarks']['bytes']=reference_path.stat().st_size
    manifest['landmarks']['sha256']=digest(reference_path)
    temporary=manifest_path.with_suffix('.person.tmp')
    temporary.write_text(json.dumps(manifest,indent=2),encoding='utf-8');temporary.replace(manifest_path)
    print(f'Installed person-only demo: {report["video_size"]}, {report["mask_frames"]}/{report["frames"]} mask frames. Original lesson clock retained.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,default=ROOT/'outputs/person_demo')
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--edge-style',choices=('clean','soft','extra-soft','outlined'),default='outlined')
    args=parser.parse_args();prepare(args.folder,args.install,args.edge_style)
