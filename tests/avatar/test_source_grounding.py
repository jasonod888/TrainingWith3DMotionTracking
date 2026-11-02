import json
from pathlib import Path
import numpy as np
import pytest

from source_grounding import process, camera_is_fixed


def test_missing_models_preserve_raw_source(tmp_path,monkeypatch):
    monkeypatch.setenv('FORM_SAM2_SOURCE',str(tmp_path/'missing'))
    source=tmp_path/'reference.glb';source.write_bytes(b'original source')
    report=process(tmp_path/'video.mp4',tmp_path/'motion.npz',source,tmp_path/'grounding')
    assert report['status']=='skipped' and report['reason']=='models-unavailable'
    assert source.read_bytes()==b'original source'
    assert json.loads((tmp_path/'grounding/grounding-summary.json').read_text())==report


def test_background_motion_guard(tmp_path):
    cv2=pytest.importorskip('cv2')
    frames=tmp_path/'frames';masks=tmp_path/'masks';frames.mkdir();masks.mkdir()
    rng=np.random.default_rng(3)
    image=rng.integers(0,255,(240,320),dtype=np.uint8)
    for i in range(16):
        cv2.imwrite(str(frames/f'{i:06d}.jpg'),image)
        cv2.imwrite(str(masks/f'{i:06d}.png'),np.zeros_like(image))
    assert camera_is_fixed(frames,masks)
    shifted=cv2.warpAffine(image,np.float32([[1,0,10],[0,1,0]]),(320,240))
    cv2.imwrite(str(frames/'000015.jpg'),shifted)
    assert not camera_is_fixed(frames,masks)
