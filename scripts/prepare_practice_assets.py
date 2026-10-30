"""Package the accepted full-video reference for the local browser prototype."""
import json
from pathlib import Path
import shutil
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'outputs/full_video'
target=ROOT/'web/dist/assets'
target.mkdir(parents=True,exist_ok=True)
with np.load(source/'motion.npz',allow_pickle=False) as data:
    times=data['timestamps']-data['timestamps'][0]
    # A stable upright pose sets the display height, not the changing bounds
    # of a crouch/kick. Nose-to-toe height is expanded to approximate the crown.
    heights=np.max(data['pred_keypoints_3d'][:,[13,14,15,18],1],axis=1)-data['pred_keypoints_3d'][:,0,1]
    standing=int(np.argmax(heights))
    reference={'title':'Taegeuk 1 · Full demonstration','duration':float(times[-1]),
               'times':times.round(6).tolist(),'keypoints':data['pred_keypoints_3d'].round(6).tolist(),
               'standingFrame':standing,'standingTime':float(times[standing]),
               'source':'https://www.youtube.com/watch?v=njNv0mM8xjA',
               'sourceStart':float(data['timestamps'][0]),'axes':'x-right/y-down/z-forward; root translation excluded'}
(target/'reference.json').write_text(json.dumps(reference,separators=(',',':')))
shutil.copy2(source/'motion.glb',target/'reference.glb')
shutil.copy2(ROOT/'inputs/taegeuk_1_jang.mp4',target/'demonstration.mp4')
print(f'Prepared reference assets in {target}')
