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


def retime_animation(path,frames,fps):
    """Retain every exported pose; replace only its sample clock with frame/fps."""
    from pygltflib import GLTF2
    gltf=GLTF2().load(str(path));blob=bytearray(gltf.binary_blob());seen=set()
    times=(np.arange(frames)/fps).astype('<f4')
    for animation in gltf.animations:
        for sampler in animation.samplers:
            if sampler.input in seen:continue
            seen.add(sampler.input);accessor=gltf.accessors[sampler.input]
            if accessor.count!=frames:raise ValueError('Animation and selected video frames do not match.')
            view=gltf.bufferViews[accessor.bufferView];offset=(view.byteOffset or 0)+(accessor.byteOffset or 0)
            blob[offset:offset+frames*4]=times.tobytes();accessor.min=[0.];accessor.max=[float(times[-1])]
    gltf.set_binary_blob(bytes(blob));temporary=path.with_suffix('.frame-clock.glb')
    gltf.save_binary(str(temporary));temporary.replace(path)


def prepare(folder,install=False,edge_style='outlined'):
    assets=ROOT/'web/dist/assets'
    source=assets/'demonstration.mp4'
    manifest_path=assets/'manifest.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    folder.mkdir(parents=True,exist_ok=True)
    original_hash=digest(source)
    if not install:
        with np.load(ROOT/'outputs/full_video/motion.npz',allow_pickle=False) as data:
            values={key:data[key].copy() for key in data.files}
        indices=values['frame_indices'].astype(int);frames=len(indices)
        if frames<2 or np.any(np.diff(indices)<=0):raise ValueError('Invalid reconstruction source-frame map.')
        # Select the exact decoded images used for inference, not an independent
        # fps resample of the wide source. No new frames or poses are inferred.
        terms=[f'eq(n,{index})' for index in indices]
        while len(terms)>1:
            terms=[f'({terms[i]}+{terms[i+1]})' if i+1<len(terms) else terms[i] for i in range(0,len(terms),2)]
        selection=terms[0]
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-an','-vf',
            f"select='{selection}',setpts=N/(15*TB)",'-r','15','-fps_mode','cfr',
            '-c:v','libx264','-crf','18',str(folder/'preview.mp4')],check=True)
        values['timestamps']=np.arange(frames)/15;values['frame_indices']=np.arange(frames)
        np.savez_compressed(folder/'motion.npz',**values)
        (folder/'source.json').write_text(json.dumps({'original_sha256':original_hash,
            'preview_sha256':digest(folder/'preview.mp4'),'motion_sha256':digest(folder/'motion.npz'),
            'exact_reconstruction_frames':indices.tolist(),'fps':15}),encoding='utf-8')
        print('Prepared the exact demo for segmentation. Run the mask builder next, then --install.')
        return
    provenance=json.loads((folder/'source.json').read_text())
    if (provenance['original_sha256']!=original_hash or provenance['preview_sha256']!=digest(folder/'preview.mp4')
            or provenance['motion_sha256']!=digest(folder/'motion.npz')):
        raise ValueError('The demo source or segmentation prompt changed. Prepare it again.')
    exact=provenance.get('exact_reconstruction_frames')
    if not exact:raise ValueError('Prepare the demo from its exact reconstruction frames before installing.')
    frames=len(exact);fps=provenance['fps'];duration=(frames-1)/fps
    start=0.;end=duration
    video=folder/'instructor-person.mp4'
    report=export(folder/'preview.mp4',folder/'motion.npz',video,folder/'segmentation',active_range=(start,end),edge_style=edge_style)
    name=f'instructor-person-{report["video_sha256"][:12]}.mp4'
    shutil.copyfile(video,assets/name)
    report['demo_source_sha256']=original_hash
    report['demo_focused_video_start']=0.
    report['exact_reconstruction_frames']=exact
    (assets/Path(name).with_suffix('.json')).write_text(json.dumps(report,indent=2),encoding='utf-8')
    manifest['focused_video']={'key':f'demo/{name}','mime':'video/mp4','bytes':video.stat().st_size,'sha256':report['video_sha256']}
    manifest['focused_video_start']=0.
    # Presentation coordinates travel with the existing authorized landmark
    # asset. Pose values are retained on the shared reconstruction-frame clock.
    reference_path=assets/Path(manifest['landmarks']['key']).name
    reference=json.loads(reference_path.read_text(encoding='utf-8'))
    if len(reference['times'])!=frames:raise ValueError('Demo reference and selected source frames disagree.')
    reference['times']=(np.arange(frames)/fps).round(6).tolist()
    reference['duration']=duration
    reference['standingTime']=int(reference['standingFrame'])/fps
    retime_animation(assets/Path(manifest['animation']['key']).name,frames,fps)
    manifest['animation']['bytes']=(assets/Path(manifest['animation']['key']).name).stat().st_size
    manifest['animation']['sha256']=digest(assets/Path(manifest['animation']['key']).name)
    manifest.update(duration=duration,standing_time=reference['standingTime'],animation_start=0,animation_duration=duration)
    manifest['section_set']['duration']=duration
    for section in manifest['section_set']['sections']:section['end']=min(section['end'],duration)
    if report.get('instructor_markers'):reference['instructorMarkers']=report['instructor_markers']
    reference_path.write_text(json.dumps(reference,separators=(',',':')),encoding='utf-8')
    manifest['landmarks']['bytes']=reference_path.stat().st_size
    manifest['landmarks']['sha256']=digest(reference_path)
    temporary=manifest_path.with_suffix('.person.tmp')
    temporary.write_text(json.dumps(manifest,indent=2),encoding='utf-8');temporary.replace(manifest_path)
    print(f'Installed person-only demo: {report["video_size"]}, {report["mask_frames"]}/{report["frames"]} mask frames. Exact reconstruction-frame clock installed.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,default=ROOT/'outputs/person_demo')
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--edge-style',choices=('clean','soft','extra-soft','outlined'),default='outlined')
    args=parser.parse_args();prepare(args.folder,args.install,args.edge_style)
