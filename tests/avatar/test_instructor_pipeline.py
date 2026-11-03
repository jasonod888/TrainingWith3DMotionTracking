import json
from pathlib import Path

import numpy as np
import pytest
from focus_instructor_video import digest
from instructor_pipeline import prepare_instructor,reusable_masks


def job(tmp_path):
    (tmp_path/'motion').mkdir()
    (tmp_path/'preview.mp4').write_bytes(b'exact normalized source')
    np.savez(tmp_path/'motion/motion.npz',timestamps=np.arange(30)/15)
    return tmp_path


def masks(folder,root,count=30):
    (folder/'masks').mkdir(parents=True)
    metadata={'video_sha256':digest(root/'preview.mp4'),'motion_sha256':digest(root/'motion/motion.npz'),
              'times':(np.arange(count)/15).tolist(),'frames':count}
    (folder/'data.json').write_text(json.dumps(metadata))
    for i in range(count):(folder/'masks'/f'{i:06d}.png').write_bytes(b'mask')


def runner(root,calls,style='outlined'):
    def command(args,timeout):
        calls.append((args,timeout))
        if Path(args[1]).name=='build_foot_mask_experiment.py':
            masks(Path(args[args.index('--output')+1]),root)
        else:
            output=Path(args[args.index('--output')+1]);output.write_bytes(b'encoded person video')
            output.with_suffix('.json').write_text(json.dumps({'video_sha256':digest(output),
                'edge_treatment':{'style':style,'body_opacity':1}}))
    return command


def test_valid_grounding_masks_are_reused_and_approved_style_is_pinned(tmp_path):
    root=job(tmp_path);masks(root/'grounding',root);calls=[]
    assert prepare_instructor(root,runner(root,calls),2)==root/'instructor.mp4'
    assert len(calls)==1
    args,_=calls[0]
    assert args[args.index('--masks')+1]==str(root/'grounding')
    assert args[args.index('--edge-style')+1]=='outlined'


def test_long_project_segments_independently_when_floor_correction_is_off(tmp_path,monkeypatch):
    monkeypatch.setenv('FORM_SOURCE_GROUNDING','off')
    monkeypatch.setenv('FORM_MOGE_SOURCE',str(tmp_path/'missing-floor-model'))
    root=job(tmp_path);calls=[]
    prepare_instructor(root,runner(root,calls),240)
    assert [Path(args[1]).name for args,_ in calls]==['build_foot_mask_experiment.py','focus_instructor_video.py']
    args,timeout=calls[0]
    assert args[args.index('--duration')+1]=='240.1' and timeout>=1920
    assert args[args.index('--output')+1]==str(root/'instructor-segmentation')


def test_truncated_or_different_source_masks_cannot_be_reused(tmp_path):
    root=job(tmp_path);masks(root/'grounding',root,count=5)
    assert not reusable_masks(root/'grounding',root/'preview.mp4',root/'motion/motion.npz')
    calls=[];prepare_instructor(root,runner(root,calls),2)
    assert len(calls)==2
    (root/'preview.mp4').write_bytes(b'changed source')
    assert not reusable_masks(root/'instructor-segmentation',root/'preview.mp4',root/'motion/motion.npz')


def test_unapproved_edge_treatment_is_not_published_as_the_standard(tmp_path):
    root=job(tmp_path);masks(root/'grounding',root)
    with pytest.raises(ValueError,match='approved treatment'):
        prepare_instructor(root,runner(root,[],style='soft'),2)
