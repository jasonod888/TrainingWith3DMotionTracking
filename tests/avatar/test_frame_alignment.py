import shutil
from pathlib import Path
import numpy as np
from pygltflib import GLTF2
from prepare_person_demo import retime_animation

ROOT=Path(__file__).resolve().parents[2]


def test_retiming_preserves_every_pose_and_only_changes_animation_input_clocks(tmp_path):
    path=tmp_path/'reference.glb'
    shutil.copyfile(ROOT/'packages/lesson-schema/synthetic.glb',path)
    original=GLTF2().load(str(path));before=original.binary_blob()
    inputs={sampler.input for animation in original.animations for sampler in animation.samplers}
    counts={original.accessors[index].count for index in inputs}
    assert len(counts)==1
    frames=counts.pop();changed=np.zeros(len(before),dtype=bool)
    retime_animation(path,frames,15)
    result=GLTF2().load(str(path));after=result.binary_blob()
    for index in inputs:
        accessor=result.accessors[index];view=result.bufferViews[accessor.bufferView]
        offset=(view.byteOffset or 0)+(accessor.byteOffset or 0)
        np.testing.assert_allclose(np.frombuffer(after,dtype='<f4',count=frames,offset=offset),np.arange(frames)/15,atol=1e-6)
        changed[offset:offset+frames*4]=True
    assert len(before)==len(after)
    np.testing.assert_array_equal(np.frombuffer(before,dtype=np.uint8)[~changed],np.frombuffer(after,dtype=np.uint8)[~changed])
