"""Contact-constrained source placement. Raw predictions are never modified.

Automatic observations are diagnostic candidates, not certified contacts. A reviewed
contact file is required to generate an exportable correction in this first release.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

VERSION = '1.0.0'
AXES = np.array([1., -1., -1.])
FOOT_POINTS = (15, 17, 18, 20)  # MHR70: left toe/heel, right toe/heel


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def solve(times, raw, local, contacts):
    """Joint sparse fit of placement and unknown fixed contact anchors, in metres.

    Each contact is a fixed physical landmark interval, not a migrating mask centre.
    No pelvis-height lock or limb scaling. Weak raw prior fixes gauge and supports gaps.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import lsqr
    n = len(times)
    if n < 2 or not np.isfinite(times).all() or np.any(np.diff(times) <= 0):
        raise ValueError('Expected increasing source timestamps.')
    if raw.shape != (n, 3) or local.shape[:1] != (n,) or local.shape[-1] != 3:
        raise ValueError('Invalid placement or landmark dimensions.')
    if not np.isfinite(raw).all() or not np.isfinite(local).all():
        raise ValueError('Non-finite motion.')
    if not contacts:
        return raw.copy(), np.zeros(n, dtype=bool), 0.
    rows, cols, vals, targets = [], [], [], []
    def equation(entries, target, weight):
        r = len(targets)
        for c, v in entries:
            rows.append(r); cols.append(c); vals.append(v*weight)
        targets.append(np.asarray(target)*weight)
    for i in range(n):
        equation([(i, 1)], raw[i], .03)
    equation([(0, 1)], raw[0], 100.)
    # Preserve original displacement outside observed support; smooth correction,
    # rather than smoothing the pose or suppressing rapid intentional movement.
    for i in range(1, n):
        equation([(i, 1), (i-1, -1)], raw[i]-raw[i-1], .08)
    for i in range(1, n-1):
        a, b = times[i]-times[i-1], times[i+1]-times[i]
        entries = [(i-1, 1/a), (i, -1/a-1/b), (i+1, 1/b)]
        target = raw[i-1]/a-raw[i]*(1/a+1/b)+raw[i+1]/b
        equation(entries, target, .025)
    active = np.zeros(n, dtype=bool)
    for j, c in enumerate(contacts):
        start, end, point = int(c['start']), int(c['end']), int(c['point'])
        confidence = float(c.get('confidence', 1))
        if not (0 <= start < end < n and 0 <= point < local.shape[1]
                and .5 <= confidence <= 1):
            raise ValueError('Invalid reviewed contact interval.')
        if times[end]-times[start] < .2:
            raise ValueError('Contact interval is too short.')
        for i in range(start, end+1):
            equation([(i, 1), (n+j, -1)], -local[i, point], 10*confidence)
            active[i] = True
    matrix = coo_matrix((vals, (rows, cols)), shape=(len(targets), n+len(contacts))).tocsr()
    rhs = np.asarray(targets)
    solutions = [lsqr(matrix, rhs[:, k], atol=1e-10, btol=1e-10,
                      iter_lim=max(1000, n*5)) for k in range(3)]
    if any(s[1] not in (0, 1, 2) for s in solutions):
        raise ValueError('Placement solver did not converge.')
    result = np.column_stack([s[0][:n] for s in solutions])
    errors = []
    for c in contacts:
        s, e, p = c['start'], c['end'], c['point']
        world = result[s:e+1]+local[s:e+1, p]
        errors.extend(np.linalg.norm(world-np.median(world, axis=0), axis=1).tolist())
    residual = max(errors, default=0.)
    return result, active, residual


def observe(video, motion, output):
    """Independent forward/backward optical-flow observations, diagnostic only.

    SAM points seed searches once; failed tracks stay missing rather than being
    silently replaced with SAM predictions. Background flow only checks stability.
    """
    import cv2
    with np.load(motion, allow_pickle=False) as data:
        indices = data['frame_indices'].astype(int)
        times = data['timestamps'].copy()
        seeds = data['pred_keypoints_2d'][0, list(FOOT_POINTS)].astype(np.float32)
    cap = cv2.VideoCapture(str(video))
    observed = np.full((len(times), 4, 2), np.nan, dtype=np.float32)
    valid = np.zeros((len(times), 4), bool)
    bg_motion, previous, bg = [], None, None
    tracked = seeds.reshape(-1, 1, 2)
    alive = np.ones(4, bool)
    frame = sample = 0
    try:
        while sample < len(indices):
            ok, image = cap.read()
            if not ok:
                raise ValueError('Video ended before the saved motion frames.')
            if frame != indices[sample]:
                frame += 1
                continue
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            if previous is None:
                height, width = gray.shape
                alive &= (seeds[:, 0] >= 0) & (seeds[:, 0] < width) & (seeds[:, 1] >= 0) & (seeds[:, 1] < height)
            else:
                nxt, status, _ = cv2.calcOpticalFlowPyrLK(previous, gray, tracked, None)
                back, reverse, _ = cv2.calcOpticalFlowPyrLK(gray, previous, nxt, None)
                alive &= status.ravel().astype(bool) & reverse.ravel().astype(bool)
                alive &= np.linalg.norm(back[:, 0]-tracked[:, 0], axis=1) < 1.
                tracked = nxt
                if bg is not None:
                    moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, gray, bg, None)
                    good = status.ravel().astype(bool)
                    if good.sum() >= 12:
                        bg_motion.append(float(np.median(np.linalg.norm(moved[good]-bg[good], axis=2))))
            observed[sample, alive] = tracked[alive, 0]
            valid[sample] = alive
            # Border features reduce person contamination; absence is uncertainty.
            mask = np.full(gray.shape, 255, np.uint8)
            h, w = gray.shape
            mask[int(h*.1):, int(w*.15):int(w*.85)] = 0
            bg = cv2.goodFeaturesToTrack(gray, 150, .02, 10, mask=mask)
            previous = gray
            sample += 1; frame += 1
    finally:
        cap.release()
    np.savez_compressed(output/'foot-observations.npz', timestamps=times,
                        points=observed, visible=valid, landmark_ids=FOOT_POINTS)
    # No inference of a floor plane from static background tracks.
    return {'camera': 'stationary-candidate' if len(bg_motion) > 5 and max(bg_motion) < 1 else 'uncertain',
            'background_max_median_flow_px': max(bg_motion, default=None),
            'tracked_fraction': float(valid.mean()), 'contact_status': 'requires independent review',
            'limitations': ['Seeds may not coincide with visible foot landmarks.',
                           'Optical flow is not proof of floor contact.',
                           'No segmentation or calibrated floor geometry in this baseline.']}


def run(motion, output, video=None, contact_file=None):
    output.mkdir(parents=True, exist_ok=True)
    # Never leave a previously accepted correction beside a newly rejected report.
    (output/'grounding.npz').unlink(missing_ok=True)
    with np.load(motion, allow_pickle=False) as data:
        times = data['timestamps'].copy()
        raw = data['pred_cam_t'].astype(float)*AXES
        raw -= raw[0]
        local = data['pred_keypoints_3d'].astype(float)*AXES
    if (len(times) < 2 or np.any(np.diff(times) <= 0) or
            not np.isfinite(raw).all() or not np.isfinite(local).all()):
        raise ValueError('Invalid source motion or timing.')
    report = {'schema_version': 1, 'version': VERSION, 'motion_sha256': digest(motion),
              'status': 'diagnostic-only', 'frames': len(times),
              'raw_translation_range_m': np.ptp(raw, axis=0).tolist()}
    if video:
        report['observations'] = observe(video, motion, output)
        report['video_sha256'] = digest(video)
    if contact_file:
        spec = json.loads(contact_file.read_text(encoding='utf-8'))
        if spec.get('motion_sha256') != report['motion_sha256'] or spec.get('reviewed') is not True:
            raise ValueError('Contacts must be reviewed and bound to this motion hash.')
        contacts = spec['contacts']
        if not contacts:
            raise ValueError('No reviewed contacts.')
        result, active, residual = solve(times, raw, local, contacts)
        report.update(max_contact_residual_m=residual, supported_frames=int(active.sum()),
                      contacts_sha256=digest(contact_file),
                      max_correction_m=float(np.linalg.norm(result-raw, axis=1).max()))
        if residual > .03 or not np.isfinite(result).all():
            report['status'] = 'rejected-contact-disagreement'
        else:
            report['status'] = 'reviewed-contact-correction'
            np.savez_compressed(output/'grounding.npz', timestamps=times,
                                translation_m=result, supported=active,
                                motion_sha256=report['motion_sha256'], version=VERSION,
                                axes='x-right/y-up/z-back', placement='replace-relative-camera-translation')
    (output/'grounding-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def load_placement(path, motion, times):
    with np.load(path, allow_pickle=False) as data:
        if (str(data['motion_sha256']) != digest(motion) or str(data['version']) != VERSION
                or str(data['axes']) != 'x-right/y-up/z-back'
                or str(data['placement']) != 'replace-relative-camera-translation'):
            raise ValueError('Grounding identity or coordinate contract mismatch.')
        if data['timestamps'].shape != times.shape or not np.allclose(data['timestamps'], times, atol=1e-7, rtol=0):
            raise ValueError('Grounding timestamps differ from source.')
        result = data['translation_m'].copy()
    if result.shape != (len(times), 3) or not np.isfinite(result).all():
        raise ValueError('Invalid grounding placement.')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('motion', type=Path)
    p.add_argument('--video', type=Path)
    p.add_argument('--contacts', type=Path)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(run(a.motion, a.output, a.video, a.contacts), indent=2))


if __name__ == '__main__':
    main()
