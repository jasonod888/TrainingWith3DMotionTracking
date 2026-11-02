"""First-frame metric floor experiment. Does not modify published lessons."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import os

import numpy as np
from scipy.ndimage import gaussian_filter1d

from build_image_motion_revision import write_revision
from ground_motion import digest
from retarget_mixamo import load_motion

ROOT = Path(__file__).resolve().parents[1]


def fit_plane(points, threshold=.04):
    points = np.asarray(points, float)
    points = points[np.isfinite(points).all(axis=1)]
    if len(points) < 100:
        raise ValueError('Not enough valid first-frame floor points.')
    rng = np.random.default_rng(13)
    points = points[rng.choice(len(points), min(8000, len(points)), replace=False)]
    best = np.zeros(len(points), bool)
    for _ in range(300):
        a, b, c = points[rng.choice(len(points), 3, replace=False)]
        normal = np.cross(b-a, c-a)
        length = np.linalg.norm(normal)
        if length < 1e-8:
            continue
        normal /= length
        if abs(normal[1]) < .5:
            continue
        inliers = abs(points@normal-a@normal) < threshold
        if inliers.sum() > best.sum():
            best = inliers
    if best.mean() < .65:
        raise ValueError('First-frame floor fit is unreliable.')
    center = points[best].mean(axis=0)
    _, _, vh = np.linalg.svd(points[best]-center, full_matrices=False)
    normal = vh[-1]
    if normal[1] < 0:
        normal = -normal
    d = -normal@center
    residual = np.abs(points[best]@normal+d)
    return normal, float(d), {'inlier_fraction': float(best.mean()),
                             'median_residual_m': float(np.median(residual)),
                             'p95_residual_m': float(np.quantile(residual, .95))}


def ray_floor(pixel, K, normal, d):
    ray = np.linalg.solve(K, np.array([pixel[0], pixel[1], 1.]))
    denom = normal@ray
    if abs(denom) < 1e-6:
        return None
    distance = -d/denom
    if not .1 < distance < 40:
        return None
    return ray*distance


def scene_reference(experiment, checkpoint):
    import cv2
    import torch
    cache = experiment/'moge-first-frame.npz'
    if cache.exists():
        with np.load(cache, allow_pickle=False) as saved:
            result = dict(saved)
        if (str(result['frame_sha256']) != digest(experiment/'frames/000000.jpg')
                or str(result['checkpoint_sha256']) != digest(checkpoint)):
            raise ValueError('Cached scene does not match first frame or checkpoint.')
        return result
    sys.path.insert(0, os.environ.get('FORM_MOGE_SOURCE',str(ROOT/'.local/MoGe')))
    from moge.model.v2 import MoGeModel
    model = MoGeModel.from_pretrained(str(checkpoint)).to('cuda').eval()
    image = cv2.imread(str(experiment/'frames/000000.jpg'))
    tensor = torch.tensor(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)/255.,
                          dtype=torch.float32, device='cuda').permute(2, 0, 1)
    with torch.inference_mode():
        output = model.infer(tensor, resolution_level=6)
    result = {key: value.float().cpu().numpy() for key, value in output.items()}
    result['checkpoint_sha256'] = np.array(digest(checkpoint))
    result['frame_sha256'] = np.array(digest(experiment/'frames/000000.jpg'))
    np.savez_compressed(cache, **result)
    return result


def foot_boundary(mask, pixel, offset, radius=23):
    """SAM image landmarks locate a search region; mask pixels supply observations."""
    center = np.asarray(pixel)+offset
    h, w = mask.shape
    x, y = center
    x0, x1 = max(0, int(x-radius)), min(w, int(x+radius+1))
    y0, y1 = max(0, int(y-38)), min(h, int(y+39))
    if x1-x0 < 8 or y1-y0 < 8:
        return None
    columns = []
    for col in range(x0, x1):
        ys = np.flatnonzero(mask[y0:y1, col])
        if len(ys) and ys[-1] < y1-y0-2:
            columns.append([col, y0+ys[-1]])
    if len(columns) < 5:
        return None
    columns = np.asarray(columns)
    # Favor the low contour close to the landmark; discard trouser side edges.
    bottom = np.quantile(columns[:, 1], .8)
    columns = columns[(columns[:, 1] >= bottom-3) & (abs(columns[:, 0]-x) < radius)]
    if len(columns) < 3:
        return None
    return np.median(columns, axis=0)


def track_foot(previous, current, previous_mask, point):
    """Track foreground features near the last observed foot, with a round-trip check."""
    import cv2
    h, w = previous.shape
    x, y = np.round(point).astype(int)
    region = np.zeros((h,w), np.uint8)
    region[max(0,y-24):min(h,y+12),max(0,x-22):min(w,x+23)] = 255
    foreground = cv2.erode(previous_mask.astype(np.uint8)*255,np.ones((3,3),np.uint8))
    region &= foreground
    features = cv2.goodFeaturesToTrack(previous, 24, .015, 3, mask=region)
    if features is None or len(features)<3:
        return None
    moved, status, _ = cv2.calcOpticalFlowPyrLK(previous,current,features,None,
                                              winSize=(21,21),maxLevel=3)
    returned, reverse, _ = cv2.calcOpticalFlowPyrLK(current,previous,moved,None,
                                                 winSize=(21,21),maxLevel=3)
    delta = moved[:,0]-features[:,0]
    valid = (status[:,0]>0)&(reverse[:,0]>0)
    valid &= np.linalg.norm(returned[:,0]-features[:,0],axis=1)<1.5
    valid &= np.linalg.norm(delta,axis=1)<60
    if valid.sum()<3:
        return None
    flow = np.median(delta[valid],axis=0)
    agreement = np.linalg.norm(delta[valid]-flow,axis=1)<5
    if agreement.mean()<.5:
        return None
    return np.asarray(point)+flow


def support_scores(pixels, local, observation_quality, previous_scores, previous_state):
    """Soft image/pose evidence and hysteresis avoid a 10 cm threshold cliff."""
    finite = np.isfinite(pixels[:,0])
    score = np.zeros(2)
    if finite.any():
        image_gap = np.nanmax(pixels[:,1])-pixels[:,1]
        pose_gap = np.max(local[:,1])-local[:,1]
        score[finite] = (observation_quality[finite]*np.exp(-image_gap[finite]/18.)
                         *np.exp(-pose_gap[finite]/.22))
    filtered = .3*previous_scores+.7*score
    state = finite & (score>=.12) & ((filtered>=.50)|(previous_state&(filtered>=.28)))
    return filtered, state


def distinct_feet(pixels, projected):
    """Two tracks cannot claim the same visible foot when the pose separates them."""
    keep=np.isfinite(pixels[:,0])
    if keep.all() and np.linalg.norm(pixels[0]-pixels[1])<12 and np.linalg.norm(projected[0]-projected[1])>35:
        distance=np.linalg.norm(pixels-projected,axis=1)
        keep[int(np.argmax(distance))]=False
    return keep


def stabilize_offsets(offsets, supported, times, max_bridge=.8):
    """Bridge brief gaps; hold the last correction through long loss, never reset to zero."""
    result = offsets.copy()
    modes = np.full(len(times),'observed',dtype='<U16')
    valid = np.flatnonzero(supported)
    if not len(valid):
        return np.zeros_like(offsets), np.full(len(times),'unavailable',dtype='<U16')
    for i in range(len(times)):
        if supported[i]:
            continue
        before = valid[valid<i]; after = valid[valid>i]
        if len(before) and len(after) and times[after[0]]-times[before[-1]]<=max_bridge:
            left,right=before[-1],after[0]
            alpha=(times[i]-times[left])/(times[right]-times[left])
            result[i]=(1-alpha)*offsets[left]+alpha*offsets[right];modes[i]='bridged'
        elif len(before):
            result[i]=result[i-1];modes[i]='held'
        else:
            result[i]=0; modes[i]='unavailable'
    result=gaussian_filter1d(result,.7,axis=0,mode='nearest')
    result[0]=0
    return result,modes


def main():
    import cv2
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--experiment', type=Path, required=True)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--motion', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, default=ROOT/'models/moge-2-vitb-normal/model.pt')
    p.add_argument('--automatic', action='store_true', help='Select floor candidates and initial foot searches from geometry/mask')
    p.add_argument('--assets-only', action='store_true', help='Do not copy experimental viewer or transcode playback video')
    a = p.parse_args(); out = a.experiment
    meta = json.loads((out/'data.json').read_text())
    if meta['motion_sha256'] != digest(a.motion):
        raise ValueError('Motion identity mismatch.')
    scene = scene_reference(out, a.checkpoint)
    h, w = scene['depth'].shape
    first_mask = cv2.imread(str(out/'masks/000000.png'), 0)>127
    excluded = cv2.dilate(first_mask.astype(np.uint8), np.ones((25,25),np.uint8))>0
    floor_region = np.zeros((h,w), bool)
    # Explicit reviewed floor region: excludes walls and lower-left title overlay.
    if a.automatic:
        floor_region[int(h*.65):int(h*.97), int(w*.03):int(w*.97)] = True
        if 'normal' in scene:
            floor_region &= np.abs(scene['normal'][...,1])>.65
    else:
        floor_region[int(h*.78):int(h*.97), int(w*.36):int(w*.96)] = True
    selected = floor_region & ~excluded & np.isfinite(scene['depth']) & (scene['mask']>.5)
    normal, d, quality = fit_plane(scene['points'][selected])
    K = scene['intrinsics'].copy()
    K[0] *= w; K[1] *= h
    xaxis = np.array([1.,0,0]); xaxis -= normal*(xaxis@normal); xaxis /= np.linalg.norm(xaxis)
    forward = np.cross(xaxis, normal)
    if forward[2] < 0:
        forward = -forward
    depth = scene['depth']; valid = np.isfinite(depth)
    lo, hi = np.quantile(depth[valid], [.02,.98])
    colored = cv2.applyColorMap(np.uint8(np.clip((np.nan_to_num(depth, posinf=hi)-lo)/(hi-lo),0,1)*255), cv2.COLORMAP_TURBO)
    cv2.imwrite(str(out/'first-depth.jpg'), colored)
    preview = cv2.imread(str(out/'frames/000000.jpg'))
    preview[selected] = preview[selected]*.55+np.array([40,120,25])
    cv2.imwrite(str(out/'floor-fit.jpg'), preview)
    with np.load(a.motion, allow_pickle=False) as raw:
        points2d = raw['pred_keypoints_2d'][:, [14,13]].copy()
        local3d = raw['pred_keypoints_3d'][:, [14,13]].copy()
    motion = load_motion(a.source); n = meta['frames']
    feet = np.asarray([[motion.worlds_at(i)[name][:3,3] for name in ('r_foot','l_foot')] for i in range(n)])
    # Reviewed first-frame visible sole centers; offsets calibrate ankle-to-boundary search.
    seeds = np.array([[638.,542.],[659.,542.]])
    if a.automatic:
        ys=np.flatnonzero(first_mask.any(axis=1))
        if len(ys)<20:
            raise ValueError('No reliable initial person silhouette.')
        height=ys[-1]-ys[0]
        auto_seeds=[foot_boundary(first_mask,point,[0,.08*height],radius=max(25,int(.15*height)))
                    for point in points2d[0]]
        if any(point is None for point in auto_seeds):
            raise ValueError('Initial feet could not be associated with silhouette.')
        seeds=np.asarray(auto_seeds)
    search_offset = seeds-points2d[0]
    pixels = np.full((n,2,2), np.nan); reliable = np.zeros((n,2), bool)
    scores = np.zeros((n,2)); observation_quality=np.zeros((n,2))
    previous_gray=None;previous_mask=None
    last_pixels=seeds.copy();last_seen=np.zeros(2,dtype=int)
    floor_points = np.full((n,2,3), np.nan)
    for i in range(n):
        mask = cv2.imread(str(out/'masks'/f'{i:06d}.png'),0)>127
        gray=cv2.imread(str(out/'frames'/f'{i:06d}.jpg'),0)
        for j in range(2):
            predicted = (track_foot(previous_gray,gray,previous_mask,last_pixels[j])
                         if i and last_seen[j]==i-1 else None)
            observation=None
            if predicted is not None:
                observation=foot_boundary(mask,predicted,[0,0])
                if observation is not None and np.linalg.norm(observation-predicted)>25:
                    observation=None
                if observation is not None:
                    observation_quality[i,j]=1.
            if observation is None:
                # Reacquire with the latest observed offset, not the first-frame offset.
                offset=search_offset[j] if last_seen[j]==i-1 else np.clip(search_offset[j],[-25,-15],[25,15])
                observation=foot_boundary(mask,points2d[i,j],offset,radius=80)
                if observation is not None:
                    observation_quality[i,j]=1. if i==0 else .65
            if observation is not None:
                point = ray_floor(observation, K, normal, d)
                if point is not None:
                    pixels[i,j] = observation; floor_points[i,j] = point
        distinct=distinct_feet(pixels[i],points2d[i])
        for j in range(2):
            if distinct[j]:
                last_pixels[j]=pixels[i,j];last_seen[j]=i
                search_offset[j]=.3*search_offset[j]+.7*(pixels[i,j]-points2d[i,j])
            else:
                pixels[i,j]=np.nan;floor_points[i,j]=np.nan;observation_quality[i,j]=0
                search_offset[j]=0
        scores[i],reliable[i]=support_scores(pixels[i],local3d[i],observation_quality[i],
                scores[i-1] if i else np.ones(2),reliable[i-1] if i else np.ones(2,bool))
        previous_gray=gray;previous_mask=mask
    if not np.isfinite(floor_points[0]).all():
        raise ValueError('Initial foot observations unavailable.')
    targets = feet.copy()
    offsets = np.zeros((n,3)); supported = reliable.any(axis=1)
    residuals = np.zeros(n)
    for i in range(n):
        candidates = [];weights=[]
        for j in range(2):
            if reliable[i,j]:
                delta = floor_points[i,j]-floor_points[0,j]
                targets[i,j] = feet[0,j]+[delta@xaxis, 0., -delta@forward]
                candidates.append(targets[i,j]-feet[i,j])
                weights.append(scores[i,j])
        if candidates:
            offsets[i] = np.average(candidates,axis=0,weights=weights)
            residuals[i] = max(np.linalg.norm(c-offsets[i]) for c in candidates)
            if residuals[i] > .18:
                supported[i] = False
    corrected,gap_modes=stabilize_offsets(offsets,supported,np.asarray(meta['times']))
    write_revision(a.source,out/'original.glb',n)
    write_revision(a.source,out/'floor-guided.glb',n,corrected)
    result=load_motion(out/'floor-guided.glb')
    for name,tracks in motion.tracks.items():
        for kind,values in tracks.items():
            if name!='body_world' or kind!='translation':
                np.testing.assert_array_equal(values[:n],result.tracks[name][kind])
    report={'schema':1,'version':'2.0','method':'first-frame-moge2-floor','frames':n,'duration':meta['analysed_duration'],
            'times':meta['times'],'offsets':corrected.tolist(),'supported':supported.tolist(),
            'pixels':[[p.tolist() if np.isfinite(p).all() else None for p in row] for row in pixels],
            'reliable_regions':reliable.tolist(),'support_fraction':float(supported.mean()),
            'support_scores':scores.tolist(),'gap_modes':gap_modes.tolist(),
            'contact_disagreement_m':residuals.tolist(),'floor_normal':normal.tolist(),'floor_offset':d,
            'floor_fit':quality,'intrinsics_pixels':K.tolist(),'source_sha256':digest(a.source),
            'checkpoint_sha256':str(scene['checkpoint_sha256']),
            'max_correction_m':float(np.linalg.norm(corrected,axis=1).max()),
            'selection':'automatic' if a.automatic else 'reviewed-experiment',
            'assumptions':['Fixed camera and lens; reviewed first-frame floor patch and foot seed locations.',
                           'Probable support classification is heuristic, not certified.',
                           'MoGe metric scale is predicted; floor fitting does not establish true metric accuracy.',
                           'Translation-only correction; all original pose tracks preserved.']}
    (out/'floor-data.json').write_text(json.dumps(report,allow_nan=False),encoding='utf-8')
    # Share the same vendored viewer modules as the first experiment.
    if not a.assets_only:
        shutil.copytree(ROOT/'.local/foot-mask-experiment/vendor',out/'vendor',dirs_exist_ok=True)
        shutil.copyfile(ROOT/'scripts/moge-floor-experiment.html',out/'floor.html')
        from experiment_video import prepare_video
        prepare_video(out/'video.mp4', out/'video.webm')
    print(json.dumps({k:report[k] for k in ['support_fraction','floor_fit','max_correction_m']},indent=2))


if __name__=='__main__':
    main()
