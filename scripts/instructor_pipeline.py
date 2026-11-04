"""Standard instructor presentation for every local conversion, independent of floor correction."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
from focus_instructor_video import digest

ROOT=Path(__file__).resolve().parents[1]
DEFAULT_EDGE_STYLE='outlined'


def reusable_masks(folder,video,motion):
    """Never reuse another source/person prompt or a truncated segmentation."""
    try:
        metadata=json.loads((folder/'data.json').read_text(encoding='utf-8'))
        with np.load(motion,allow_pickle=False) as data:times=data['timestamps']
        stored=np.asarray(metadata['times'])
        return (metadata['video_sha256']==digest(video) and metadata['motion_sha256']==digest(motion)
                and len(stored)>=len(times)*.95 and len(stored)<=len(times)
                and np.allclose(stored,times[:len(stored)],atol=.002)
                and len(list((folder/'masks').glob('*.png')))>=len(times)*.95)
    except (OSError,ValueError,KeyError,TypeError):
        return False


def prepare_instructor(folder,command,duration):
    folder=Path(folder);video=folder/'preview.mp4';motion=folder/'motion/motion.npz'
    masks=folder/'grounding'
    if not reusable_masks(masks,video,motion):
        masks=folder/'instructor-segmentation'
        if not reusable_masks(masks,video,motion):
            sam=Path(os.environ.get('FORM_SAM2_SOURCE',ROOT/'.local/sam2'))
            checkpoint=Path(os.environ.get('FORM_SAM2_CHECKPOINT',ROOT/'models/sam2.1_hiera_small.pt'))
            command([sys.executable,str(ROOT/'scripts/build_foot_mask_experiment.py'),
                     '--video',str(video),'--motion',str(motion),'--output',str(masks),
                     '--duration',str(duration+.1),'--sam2',str(sam),'--checkpoint',str(checkpoint),
                     '--chunk-frames','120','--assets-only'],timeout=max(600,duration*8))
    output=folder/'instructor.mp4'
    # Pin the approved style explicitly; a later preview/default change must not
    # silently change the treatment of newly created projects.
    command([sys.executable,str(ROOT/'scripts/focus_instructor_video.py'),
             '--video',str(video),'--motion',str(motion),'--output',str(output),
             '--masks',str(masks),'--mode','person','--edge-style',DEFAULT_EDGE_STYLE,'--alpha'],
            timeout=max(900,duration*5))
    report=json.loads(output.with_suffix('.json').read_text(encoding='utf-8'))
    edge=report.get('edge_treatment',{})
    if (edge.get('style')!=DEFAULT_EDGE_STYLE or edge.get('body_opacity')!=1
            or report.get('video_sha256')!=digest(output)):
        raise ValueError('Instructor output does not match the approved treatment.')
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,required=True)
    parser.add_argument('--duration',type=float,required=True)
    args=parser.parse_args()
    def command(values,timeout):subprocess.run(values,check=True,timeout=timeout)
    print(prepare_instructor(args.folder,command,args.duration))
