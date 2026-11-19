"""Export a steady person-focused derivative of the exact normalized source.

Reuses source-grounding masks only when their source hash and frame clock match.
Missing masks use the existing image-space body predictions; no model is run.
The default isolates the segmented person on a neutral background and follows
their position at a fixed scale. The older whole-movement envelope is optional.
Original timestamps, frame count and pixel scale are retained.

Two landmark formats are accepted through ``--landmark-format``:

* ``sam-3d-body`` (default, legacy) — MHR70 ``pred_keypoints_2d`` rows and the
  unchanged MHR70 wrist/foot marker indices (62/41 and the toe/foot means).
* ``mediapipe-33`` — the CPU MediaPipe heavy route's ``image_landmarks`` (pixels)
  plus its frame-matched ``visibility`` row. Markers use wrists 15/16 and feet
  31/32, with the ankles 27/28 as a fallback when a foot tip is not visible.

The two formats only differ in which joint is a hand or a foot and in how a
landmark is gated; the crop, matte, encoding and report contract are shared.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np


# Reduced-resolution Farneback keeps the motion-aligned edge stabilization cheap on
# 1080p outputs. Flow vectors are always rescaled back to full-resolution pixels.
FLOW_MAX_HEIGHT = 480
# A MediaPipe landmark contributes to a marker or to fallback crop bounds only when
# its min(visibility, presence) value clears this. Stored values are already min().
MARKER_VISIBILITY = 0.55


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_landmarks(motion, landmark_format='sam-3d-body'):
    """Read and validate the prediction arrays for the requested landmark format.

    Returns ``(points_2d, visibility, timestamps, frame_indices)`` where
    ``points_2d`` is ``[frames, joints, 2]`` in source pixels and ``visibility`` is
    ``[frames, joints]`` (or ``None`` for the legacy SAM arrays, whose confidence is
    not part of the stored keypoints).
    """
    with np.load(motion, allow_pickle=False) as data:
        files = set(data.files)
        if landmark_format == 'mediapipe-33':
            missing = {'image_landmarks', 'visibility', 'timestamps', 'frame_indices'} - files
            if missing:
                raise ValueError(f'MediaPipe motion is missing {sorted(missing)}; use process_video_mediapipe.py output.')
            points = np.asarray(data['image_landmarks'], dtype=float)
            visibility = np.asarray(data['visibility'], dtype=float)
            if points.ndim != 3 or points.shape[1:] != (33, 2):
                raise ValueError(f'MediaPipe image landmarks must be [frames,33,2]; got {points.shape}.')
            if visibility.shape != points.shape[:2]:
                raise ValueError(f'MediaPipe visibility must be [frames,33]; got {visibility.shape}.')
            if not np.isfinite(visibility).all():
                raise ValueError('MediaPipe visibility contains non-finite values.')
        elif landmark_format == 'sam-3d-body':
            missing = {'pred_keypoints_2d', 'timestamps', 'frame_indices'} - files
            if missing:
                raise ValueError(f'SAM motion is missing {sorted(missing)}; use process_video.py output.')
            points = np.asarray(data['pred_keypoints_2d'], dtype=float)
            visibility = None
            if points.ndim != 3 or points.shape[2] != 2 or points.shape[1] < 1:
                raise ValueError(f'SAM keypoints must be [frames,>=1,2]; got {points.shape}.')
        else:
            raise ValueError('Unknown landmark format.')
        times = np.asarray(data['timestamps'], dtype=float)
        indices = np.asarray(data['frame_indices'])
    if not np.isfinite(points).all():
        raise ValueError('Image predictions contain non-finite values.')
    return points, visibility, times, indices


def gated_points(frame_points, frame_visibility):
    """Landmarks usable for fallback crop bounds: finite and confidently visible."""
    if frame_visibility is None:
        return frame_points
    keep = (frame_visibility >= MARKER_VISIBILITY) & np.isfinite(frame_points).all(axis=1)
    return frame_points[keep]


def reduce_gray(gray, max_height=FLOW_MAX_HEIGHT):
    """Downscale a gray frame so Farneback never runs taller than ``max_height``.

    Returns ``(image, flow_width, flow_height)``; identical-size input is returned
    unchanged so a small crop pays nothing for the benchmarked path.
    """
    import cv2
    height, width = gray.shape
    scale = min(1.0, max_height / max(height, 1))
    flow_w = max(16, int(round(width * scale)))
    flow_h = max(16, int(round(height * scale)))
    if (flow_w, flow_h) == (width, height):
        return gray, flow_w, flow_h
    return cv2.resize(gray, (flow_w, flow_h), interpolation=cv2.INTER_AREA), flow_w, flow_h


def scale_flow(flow, width, height, flow_w, flow_h):
    """Spatially resize reduced flow to full resolution, then scale displacements.

    Farneback measures displacement in reduced-image pixels. Interpolating the grid
    alone keeps those reduced-pixel values, so the final vector must be multiplied
    by ``width/flow_w`` and ``height/flow_h`` after the resize.
    """
    import cv2
    scaled = np.asarray(flow, dtype=np.float32)
    if scaled.shape[:2] != (height, width):
        scaled = cv2.resize(scaled, (width, height), interpolation=cv2.INTER_LINEAR)
    else:
        scaled = scaled.copy()
    scaled[..., 0] *= width / max(flow_w, 1)
    scaled[..., 1] *= height / max(flow_h, 1)
    return scaled


def warp_previous(previous, gray, offset=(0., 0.), previous_crop=None, current_crop=None):
    """Sample the previous matte in the current crop, with motion and crop offset.

    Farneback runs at most ``FLOW_MAX_HEIGHT`` tall, then the flow grid is spatially
    resized and vectors are scaled by ``full_w/flow_w`` and ``full_h/flow_h``.
    ``offset`` is ``(current_left-previous_left, current_top-previous_top)``.
    Crop rectangles optionally account for a different crop size: the previous matte
    is resized to the current crop before motion sampling.
    """
    import cv2
    height, width = gray.shape
    current_small, flow_w, flow_h = reduce_gray(gray)
    previous_small, _, _ = reduce_gray(previous['gray'])
    flow = cv2.calcOpticalFlowFarneback(current_small, previous_small, None, .5, 2, 15, 2, 5, 1.1, 0)
    flow = scale_flow(flow, width, height, flow_w, flow_h)
    previous_alpha = np.asarray(previous['alpha'], dtype=np.float32)
    if previous_alpha.shape != (height, width):
        previous_alpha = cv2.resize(previous_alpha, (width, height), interpolation=cv2.INTER_LINEAR)
    if previous_crop is not None and current_crop is not None:
        # Source-space crop movement, expressed in current-crop pixels.
        prev_w, prev_h = float(previous_crop[2]), float(previous_crop[3])
        curr_w, curr_h = float(current_crop[2]), float(current_crop[3])
        scale_x, scale_y = curr_w / max(prev_w, 1.), curr_h / max(prev_h, 1.)
        offset = (offset[0] * scale_x, offset[1] * scale_y)
    yy, xx = np.indices((height, width), dtype=np.float32)
    warped = cv2.remap(previous_alpha, xx + flow[..., 0] + np.float32(offset[0]),
                       yy + flow[..., 1] + np.float32(offset[1]), cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return warped


def padded_crop(boxes, width, height, padding=.15):
    """Even-pixel crop containing every observation, with per-side body padding."""
    boxes = np.asarray(boxes, dtype=float)
    if (width < 2 or height < 2 or boxes.ndim != 2 or boxes.shape[1] != 4
            or not len(boxes) or not np.isfinite(boxes).all() or not 0 <= padding <= .5
            or np.any(boxes[:, 2:] <= boxes[:, :2])):
        raise ValueError('Invalid instructor bounds.')
    # Body-height padding also protects fingers/feet when the person is side-on.
    margin = np.maximum(boxes[:, 3] - boxes[:, 1], boxes[:, 2] - boxes[:, 0]) * padding
    low = np.min(boxes[:, :2] - margin[:, None], axis=0)
    high = np.max(boxes[:, 2:] + margin[:, None], axis=0)
    x = max(0, math.floor(low[0] / 2) * 2)
    y = max(0, math.floor(low[1] / 2) * 2)
    right = min(width, math.ceil(high[0] / 2) * 2)
    bottom = min(height, math.ceil(high[1] / 2) * 2)
    # Normalized conversion sources always have even dimensions. Reject an odd
    # source instead of silently trimming a border containing the instructor.
    if width % 2 or height % 2 or right - x < 2 or bottom - y < 2:
        raise ValueError('Source must have even dimensions and a nonempty crop.')
    return [x, y, right - x, bottom - y]


def clean_person_mask(mask):
    """Discard isolated background specks while retaining nearby body pieces."""
    import cv2
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask>0).astype(np.uint8),8)
    if count<=1:return mask
    anchor=1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
    x,y,w,h,area=stats[anchor]
    margin=max(8,h*.15)
    keep=[]
    for label in range(1,count):
        left,top,cw,ch,size=stats[label]
        if size>=max(3,area*.002) and left+cw>=x-margin and left<=x+w+margin and top+ch>=y-margin and top<=y+h+margin:
            keep.append(label)
    return np.isin(labels,keep).astype(np.uint8)*255


def outlined_person(frame,mask,background,previous=None,offset=(0.,0.)):
    """Keep source pixels in place; expand only the feathered white backing."""
    import cv2
    binary=(mask>127).astype(np.uint8)
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    if not binary.any():
        return np.broadcast_to(background,frame.shape).astype(np.uint8).copy(),{
            'gray':gray,'alpha':np.zeros(mask.shape,dtype=np.float32)}
    height=mask.shape[0]
    expansion=max(1.,height*.0055)
    border=max(.8,height*.0045)
    feather=max(2.5,height*.018)
    distance=cv2.distanceTransform(1-binary,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    # Growing image colors as well as the matte duplicates clothing/face edges
    # and amplifies any source-wall pixels near the segmentation boundary.
    # Keep the entire original person opaque and expand only the white backing.
    body_alpha=binary.astype(np.float32)
    transition=np.clip((expansion+border+feather-distance)/feather,0,1)
    rim_alpha=transition*transition*(3-2*transition)
    rim_alpha=cv2.GaussianBlur(rim_alpha,(5,5),.8)
    if previous is not None and previous['gray'].shape==gray.shape:
        warped=warp_previous(previous,gray,offset)
        agrees=(rim_alpha>.02)&(rim_alpha<.98)&(body_alpha==0)&(np.abs(warped-rim_alpha)<.18)
        rim_alpha=np.where(agrees,rim_alpha*.85+warped*.15,rim_alpha)
    rim_alpha=np.maximum(rim_alpha,body_alpha)
    white=np.array([242,245,240],dtype=np.float32)
    backing=white*rim_alpha[...,None]+background*(1-rim_alpha[...,None])
    result=np.where(binary[...,None]>0,frame,backing)
    return np.clip(result,0,255).astype(np.uint8),{'gray':gray,'alpha':rim_alpha}


def composite_person(frame, mask, background, style='outlined', previous=None, offset=(0.,0.)):
    """Feather the matte, extend real foreground colors and stabilize its edge.

    Only the edge becomes translucent. Foreground-color extension avoids
    bringing the original room back through the wide feather. Motion alignment
    and a strict agreement gate limit temporal filtering to small edge changes.
    """
    import cv2
    if style=='outlined':return outlined_person(frame,mask,background,previous,offset)
    if style not in ('clean','soft','extra-soft'):
        raise ValueError('Unknown person edge treatment.')
    binary=(mask>127).astype(np.uint8)
    gray=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    if not binary.any():
        alpha=np.zeros(mask.shape,dtype=np.float32)
        return np.broadcast_to(background,frame.shape).astype(np.uint8).copy(),{'gray':gray,'alpha':alpha}
    if style=='clean':
        alpha=cv2.GaussianBlur(mask,(3,3),.6).astype(np.float32)/255
        foreground=frame.astype(np.float32)
    else:
        # Round pixel-sized notches before building the wide feather; otherwise
        # a soft matte can still carry a visibly serrated contour when enlarged.
        binary=(cv2.GaussianBlur(binary.astype(np.float32),(5,5),.8)>.45).astype(np.uint8)
        inside=cv2.distanceTransform(binary,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
        outside=cv2.distanceTransform(1-binary,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
        outer=max(2.,mask.shape[0]*(.026 if style=='extra-soft' else .016))
        inner=max(.8,mask.shape[0]*.005)
        transition=np.clip((inside-outside+outer)/(inner+outer),0,1)
        alpha=transition*transition*(3-2*transition)
        alpha=cv2.GaussianBlur(alpha,(5,5),.8)
        # Use interior colors at the boundary, never the room just outside it.
        source_foreground=(mask>127).astype(np.uint8)
        trusted=cv2.erode(source_foreground,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
        if not trusted.any():trusted=source_foreground
        _,labels=cv2.distanceTransformWithLabels(1-trusted,cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
        colors=np.zeros((int(labels.max())+1,3),dtype=np.float32)
        colors[labels[trusted>0]]=frame[trusted>0]
        extended=colors[labels]
        retain=(np.clip((inside-1)/1.5,0,1)*source_foreground)[...,None]
        foreground=frame.astype(np.float32)*retain+extended*(1-retain)
        if previous is not None and previous['gray'].shape==gray.shape:
            # Backward flow samples the prior matte in current-frame coordinates.
            warped=warp_previous(previous,gray,offset)
            agrees=(alpha>.02)&(alpha<.98)&(np.abs(warped-alpha)<.18)
            alpha=np.where(agrees,alpha*.85+warped*.15,alpha)
    result=foreground*alpha[...,None]+background*(1-alpha[...,None])
    return np.clip(result,0,255).astype(np.uint8),{'gray':gray,'alpha':alpha}


def following_crops(boxes, width, height, fps, padding=.08, active=None):
    """Fixed scale, smoothed centers, look-ahead and hard full-body containment."""
    boxes = np.asarray(boxes, dtype=float)
    padded = []
    for box in boxes:
        margin = max(box[2] - box[0], box[3] - box[1]) * padding
        padded.append([max(0, box[0]-margin), max(0, box[1]-margin),
                       min(width, box[2]+margin), min(height, box[3]+margin)])
    padded = np.asarray(padded)
    active = np.ones(len(boxes),dtype=bool) if active is None else np.asarray(active,dtype=bool)
    if not active.any():raise ValueError('No instructor frames in the lesson range.')
    size = np.minimum([width, height], np.ceil((padded[active, 2:]-padded[active, :2]).max(axis=0)/2)*2+4).astype(int)
    # Outside the playable lesson (titles, fades), retain the nearest lesson
    # bounds for presentation planning instead of zooming out to fit title text.
    first,last=np.flatnonzero(active)[[0,-1]]
    padded[:first]=padded[first];padded[last+1:]=padded[last]
    centers = (padded[:, :2] + padded[:, 2:]) / 2
    radius = max(1, round(fps * .3))
    smooth = np.stack([centers[max(0,i-radius):min(len(centers),i+radius+1)].mean(axis=0)
                       for i in range(len(centers))])
    crops = []
    for center, box in zip(smooth, padded):
        lower = np.ceil(np.maximum(0, box[2:]-size)/2)*2
        upper = np.floor(np.minimum(box[:2], np.array([width,height])-size)/2)*2
        origin = np.clip(np.round((center-size/2)/2)*2, lower, upper).astype(int)
        crops.append(list(map(int,[*origin, *size])))
    return crops


def limb_markers(points,crop,mask,landmark_format='sam-3d-body',visibility=None):
    """Anatomical wrists and feet, normalized to the focused video.

    SAM uses the MHR70 indices that pose.js also uses. The MediaPipe route uses
    wrists 15/16 and feet 31/32, falling back to the ankles 27/28 when a foot tip is
    not confidently visible. Never infer left/right from screen position. Finite
    coordinates, crop containment and a spatial mask check reject bad projections.
    """
    left,top,width,height=crop
    if landmark_format=='mediapipe-33':
        if len(points)<33:return [None]*4
        def marker(index,fallbacks=()):
            for candidate in (index,*fallbacks):
                if visibility is not None and not visibility[candidate]>=MARKER_VISIBILITY:continue
                point=points[candidate]
                if np.isfinite(point).all():return point
            return None
        positions=[marker(15),marker(16),marker(31,(27,)),marker(32,(28,))]
    elif landmark_format=='sam-3d-body':
        if len(points)<63:return [None]*4
        positions=[points[62],points[41],np.mean(points[15:18],axis=0),np.mean(points[18:21],axis=0)]
    else:
        raise ValueError('Unknown landmark format.')
    result=[];radius=max(2,min(12,round(height*.025)))
    for point in positions:
        if point is None:
            result.append(None);continue
        x,y=map(float,point)
        if not np.isfinite(point).all() or not (left<=x<left+width and top<=y<top+height):
            result.append(None);continue
        ix,iy=round(x),round(y)
        nearby=mask[max(0,iy-radius):min(mask.shape[0],iy+radius+1),max(0,ix-radius):min(mask.shape[1],ix+radius+1)]
        if not nearby.any():result.append(None);continue
        result.append([round((x-left)/width,6),round((y-top)/height,6)])
    return result


MARKER_SOURCES={'sam-3d-body':'sam-3d-body-mhr70-image','mediapipe-33':'mediapipe-pose-heavy-image'}


def marker_source(landmark_format):
    """Report label for the marker track's landmark origin."""
    try:
        return MARKER_SOURCES[landmark_format]
    except KeyError:
        raise ValueError('Unknown landmark format.') from None


def export(video, motion, output, masks=None, command=None, mode='person', active_range=None, edge_style='outlined', alpha=False, landmark_format='sam-3d-body'):
    import cv2
    video, motion, output = map(Path, (video, motion, output))
    if output.resolve() == video.resolve():
        raise ValueError('The focused video must be a separate file.')
    cap = cv2.VideoCapture(str(video))
    try:
        width, height = (int(cap.get(prop)) for prop in (cv2.CAP_PROP_FRAME_WIDTH, cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        cap.release()
    source_hash = digest(video)
    points, visibility, times, indices = load_landmarks(motion, landmark_format)
    if (len(times) < 2 or len(times) != frames or not np.array_equal(indices, np.arange(frames))
            or points.shape[0] != frames
            or not np.isfinite(times).all()
            or fps <= 0 or not np.allclose(times, np.arange(frames) / fps, atol=.002)):
        raise ValueError('A frame-aligned normalized source and image predictions are required.')
    mask_root = Path(masks) if masks else None
    if mask_root:
        metadata = json.loads((mask_root / 'data.json').read_text(encoding='utf-8'))
        mask_times = np.asarray(metadata.get('times', []))
        if (metadata.get('video_sha256') != source_hash or metadata.get('width') != width
                or metadata.get('motion_sha256') != digest(motion)
                or metadata.get('height') != height or mask_times.ndim != 1
                or len(mask_times) > frames or not np.allclose(mask_times, times[:len(mask_times)], atol=.002)):
            raise ValueError('Segmentation belongs to a different source or timeline.')
    boxes, mask_frames, landmark_frames = [], 0, 0
    for index, frame_points in enumerate(points):
        mask = None
        if mask_root and index < len(mask_times):
            path = mask_root / 'masks' / f'{index:06d}.png'
            if path.is_file():
                mask = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if mask is not None:
            if mask.shape != (height, width):
                raise ValueError('Segmentation dimensions do not match the source.')
            mask=clean_person_mask(mask) if mode=='person' else mask
            ys, xs = np.nonzero(mask)
        else:
            xs, ys = [], []
        if len(xs):
            boxes.append([xs.min(), ys.min(), xs.max() + 1, ys.max() + 1])
            mask_frames += 1
        else:
            # Confidence-aware bounds: only landmarks that are confidently visible and
            # finite may define a fallback crop. A zero placeholder never does.
            usable = gated_points(frame_points, visibility[index] if visibility is not None else None)
            if len(usable) < 2:
                boxes.append(None)
                continue
            low, high = usable.min(axis=0), usable.max(axis=0)
            # Failed perspective projections can be finite but thousands of
            # pixels outside the source. They are not trustworthy body bounds.
            valid = (np.all(low >= [-width * .1, -height * .1])
                     and np.all(high <= [width * 1.1, height * 1.1])
                     and high[1] - low[1] >= height * .05
                     and high[0] - low[0] >= 2)
            boxes.append([*np.maximum(low, 0), *np.minimum(high, [width, height])] if valid else None)
            landmark_frames += int(valid)
    # Offline look-ahead bridges brief missing observations without inventing a
    # moving crop. Longer gaps fail safely to the original-video presentation.
    held_frames, index = 0, 0
    while index < frames:
        if boxes[index] is not None:
            index += 1
            continue
        start = index
        while index < frames and boxes[index] is None:
            index += 1
        if index - start > max(1, round(fps * .5)):
            raise ValueError('Instructor bounds are missing for too long.')
        neighbors = ([boxes[start - 1]] if start else []) + ([boxes[index]] if index < frames else [])
        if not neighbors:
            raise ValueError('No reliable instructor bounds.')
        neighbor = np.asarray(neighbors)
        bridge = [*neighbor[:, :2].min(axis=0), *neighbor[:, 2:].max(axis=0)]
        boxes[start:index] = [bridge] * (index - start)
        held_frames += index - start
    padding = .20 if landmark_frames else .15
    crop = padded_crop(boxes, width, height, padding)
    x, y, w, h = crop
    output.parent.mkdir(parents=True, exist_ok=True)
    intermediate = None
    track = None
    marker_frames=[]
    if mode == 'person':
        if not mask_root or mask_frames != frames:
            raise ValueError('Person-only video requires a complete observed segmentation matte; '
                             'unrepaired gaps disable focused/alpha derivatives.')
        active = None if active_range is None else (times>=active_range[0])&(times<=active_range[1])
        track = following_crops(boxes, width, height, fps, active=active)
        w, h = track[0][2:]
        intermediate = output.with_suffix('.person-frames.avi')
        writer = cv2.VideoWriter(str(intermediate), cv2.VideoWriter_fourcc(*'FFV1'), fps, (w,h))
        reader = cv2.VideoCapture(str(video))
        try:
            if not writer.isOpened():
                raise ValueError('Lossless person-video encoder unavailable.')
            background = np.array([37,46,24], dtype=np.float32)
            # The composite variant keeps the same matte as real transparency, so it can be
            # drawn over a live camera. VP9/WebM is the only widely decodable alpha video.
            alpha_output = output.with_name(output.stem + '-alpha.webm') if alpha else None
            alpha_pipe = None
            if alpha_output:
                alpha_pipe = subprocess.Popen(
                    ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
                     '-s', f'{w}x{h}', '-r', str(fps), '-i', '-', '-an', '-sn', '-dn', '-map_metadata', '-1',
                     '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28',
                     '-row-mt', '1', '-cpu-used', '3', '-fps_mode', 'passthrough', str(alpha_output)],
                    stdin=subprocess.PIPE)
            previous=None
            previous_origin=(0,0)
            marker_source_name=marker_source(landmark_format)
            for index, (left,top,cw,ch) in enumerate(track):
                ok, frame = reader.read()
                if not ok:
                    raise ValueError('Source ended before its segmentation clock.')
                path = mask_root/'masks'/f'{index:06d}.png'
                mask = cv2.imread(str(path),cv2.IMREAD_GRAYSCALE) if index<len(mask_times) and path.is_file() else None
                if mask is None:
                    mask = np.zeros((height,width),dtype=np.uint8)
                else:mask=clean_person_mask(mask)
                marker_frames.append(limb_markers(points[index],(left,top,cw,ch),mask,landmark_format,
                                                 visibility[index] if visibility is not None else None))
                crop_frame=frame[top:top+ch,left:left+cw];crop_mask=mask[top:top+ch,left:left+cw]
                # The previous matte lives in the previous crop's coordinates; pass the
                # crop's own movement so temporal stabilization follows the person.
                offset=(left-previous_origin[0],top-previous_origin[1]) if previous is not None else (0.,0.)
                composed,previous=composite_person(crop_frame,crop_mask,
                                                   background,edge_style,previous,offset)
                previous_origin=(left,top)
                writer.write(composed)
                if alpha_pipe:
                    rgba=np.empty((ch,cw,4),dtype=np.uint8)
                    # Straight alpha: body pixels keep their colour, the rim keeps its white.
                    rgba[...,:3]=np.where(crop_mask[...,None]>0,crop_frame[...,::-1],255)
                    rgba[...,3]=np.clip(previous['alpha']*255,0,255).astype(np.uint8)
                    try:alpha_pipe.stdin.write(rgba.tobytes())
                    except (BrokenPipeError,OSError):alpha_pipe=None
        finally:
            reader.release();writer.release()
            if alpha_pipe:
                try:alpha_pipe.stdin.close()
                except (BrokenPipeError,OSError):pass
                if alpha_pipe.wait()!=0:alpha_output.unlink(missing_ok=True)
        encode_source, filters = intermediate, []
    elif mode == 'envelope':
        encode_source, filters = video, ['-vf', f'crop={w}:{h}:{x}:{y}']
    else:
        raise ValueError('Unknown instructor video mode.')
    # No fps filter or scale: do not synthesize frames or pretend to add detail.
    args = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(encode_source), '-map', '0:v:0',
            '-an', '-sn', '-dn', '-map_metadata', '-1', *filters,
            '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough',
            '-movflags', '+faststart', str(output)]
    try:
        if command:
            command(args, timeout=600)
        else:
            subprocess.run(args, check=True, timeout=600)
    finally:
        if intermediate:intermediate.unlink(missing_ok=True)
    report = {'schema': 1, 'version': 'focused-instructor-v2' if mode=='person' else 'focused-instructor-v1', 'source_sha256': source_hash,
              'motion_sha256': digest(motion), 'crop': track[0] if track else crop, 'source_size': [width, height],
              'frames': frames, 'fps': fps, 'mask_frames': mask_frames,
              'landmark_format': landmark_format,
              'landmark_frames': landmark_frames, 'held_frames': held_frames, 'padding': .08 if track else padding,
              'video_sha256': digest(output)}
    if track:
        if alpha_output and alpha_output.is_file():
            report['alpha_video']={'name':alpha_output.name,'mime':'video/webm',
                                   'bytes':alpha_output.stat().st_size,'sha256':digest(alpha_output)}
        report.update(composition='person-on-neutral-background',crop_mode='follow-person-fixed-scale',
                      video_size=[w,h],crop_track=[list(map(int,box)) for box in track],
                      edge_treatment={'style':edge_style,'version':3 if edge_style=='outlined' else 1,'foreground_color_extension':edge_style in ('soft','extra-soft'),
                                      'motion_aligned_stabilization':edge_style!='clean',
                                      'flow_max_height':FLOW_MAX_HEIGHT,
                                      'crop_movement_compensated':True,
                                      'flow_rescaled_to_full':True})
        if edge_style=='outlined':
            report['edge_treatment'].update(body_opacity=1.,foreground_image_expansion=False,mask_expansion_px=max(1.,h*.0055),
                white_border_px=max(.8,h*.0045),outer_feather_px=max(2.5,h*.018))
        if active_range:report['active_range']=list(map(float,active_range))
        if any(any(point is not None for point in row) for row in marker_frames):
            report['instructor_markers']={'schema':1,'video_sha256':report['video_sha256'],
                'source':marker_source_name,'quality':'unmeasured',
                'order':['left_hand','right_hand','left_foot','right_foot'],
                'times':times.round(6).tolist(),'frames':marker_frames}
    output.with_suffix('.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('video', 'motion', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--masks', type=Path)
    parser.add_argument('--mode', choices=('person','envelope'), default='person')
    parser.add_argument('--edge-style', choices=('clean','soft','extra-soft','outlined'), default='outlined')
    parser.add_argument('--alpha', action='store_true', help='Also write a transparent WebM for camera compositing.')
    # Explicit adapter: the legacy MHR70 arrays stay the default so existing SAM
    # conversions and scripts are untouched; MediaPipe callers opt in by name.
    parser.add_argument('--landmark-format', choices=('sam-3d-body','mediapipe-33'), default='sam-3d-body',
                        help='Landmark table in --motion: MHR70 (default) or MediaPipe 33.')
    args = parser.parse_args()
    result=export(args.video, args.motion, args.output, args.masks, mode=args.mode,edge_style=args.edge_style,alpha=args.alpha,landmark_format=args.landmark_format)
    print(json.dumps({key:value for key,value in result.items() if key not in ('crop_track','instructor_markers')}, indent=2))
