import json
import shutil
import subprocess

import numpy as np
import pytest

from focus_instructor_video import padded_crop, following_crops, composite_person, limb_markers, export, digest


def test_fixed_crop_contains_entire_movement_with_even_pixel_padding():
    boxes = [[400, 100, 520, 600], [240, 120, 760, 620], [600, 80, 900, 610]]
    x, y, w, h = padded_crop(boxes, 1280, 720)
    assert all(value % 2 == 0 for value in (x, y, w, h))
    for left, top, right, bottom in boxes:
        assert x <= left and y <= top and x + w >= right and y + h >= bottom
    assert x < 240 and x + w > 900
    assert y == 0 and y + h == 698


def test_edge_clamping_never_crops_body_or_stretches_source():
    assert padded_crop([[0, 0, 1280, 720]], 1280, 720) == [0, 0, 1280, 720]
    for boxes in ([], [[1, 1, 0, 5]], [[0, 0, float('nan'), 10]]):
        with pytest.raises(ValueError):
            padded_crop(boxes, 1280, 720)


@pytest.fixture
def source(tmp_path):
    pytest.importorskip('cv2')
    if not shutil.which('ffmpeg'):
        pytest.skip('ffmpeg unavailable')
    video = tmp_path / 'preview.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=15:d=1',
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)], check=True)
    motion = tmp_path / 'motion.npz'
    np.savez(motion, timestamps=np.arange(15) / 15, frame_indices=np.arange(15),
             pred_keypoints_2d=np.tile([[140, 50], [180, 190]], (15, 1, 1)))
    return video, motion, tmp_path / 'instructor.mp4'


def test_export_preserves_frames_timestamps_and_uses_larger_landmark_padding(source):
    video, motion, output = source
    report = export(video, motion, output, mode='envelope')
    assert report['source_sha256'] == digest(video)
    assert report['mask_frames'] == 0 and report['landmark_frames'] == 15
    assert report['crop'] == [112, 22, 96, 196]
    def timeline(path):
        return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)]))['frames']
    assert timeline(video) == timeline(output)
    assert output.with_suffix('.json').is_file()


def test_matching_masks_reused_and_empty_frame_falls_back_to_landmarks(source):
    cv2 = pytest.importorskip('cv2')
    video, motion, output = source
    root = video.parent / 'grounding'
    (root / 'masks').mkdir(parents=True)
    (root / 'data.json').write_text(json.dumps({'video_sha256': digest(video), 'motion_sha256':digest(motion), 'width': 320,
        'height': 240, 'times': (np.arange(15) / 15).tolist()}))
    for i in range(15):
        mask = np.zeros((240, 320), dtype=np.uint8)
        if i != 7:
            mask[40:200, 120:200] = 255
        cv2.imwrite(str(root / 'masks' / f'{i:06d}.png'), mask)
    report = export(video, motion, output, root, mode='envelope')
    assert report['mask_frames'] == 14 and report['landmark_frames'] == 1
    assert report['crop'] == [88, 8, 144, 224]
    data = json.loads((root / 'data.json').read_text())
    data['video_sha256'] = '0' * 64
    (root / 'data.json').write_text(json.dumps(data))
    with pytest.raises(ValueError, match='different source'):
        export(video, motion, output, root, mode='envelope')


def test_nonmatching_frame_clock_cannot_produce_derivative(source):
    video, motion, output = source
    np.savez(motion, timestamps=np.arange(15) / 30, frame_indices=np.arange(15),
             pred_keypoints_2d=np.tile([[140, 50], [180, 190]], (15, 1, 1)))
    with pytest.raises(ValueError, match='frame-aligned'):
        export(video, motion, output, mode='envelope')
    assert not output.exists()


def test_short_failed_projection_gap_uses_neighbors_and_long_gap_is_rejected(source):
    video, motion, output = source
    points = np.tile([[140., 50.], [180., 190.]], (15, 1, 1))
    points[-5:, 1, 1] = 26000
    np.savez(motion, timestamps=np.arange(15) / 15, frame_indices=np.arange(15), pred_keypoints_2d=points)
    report = export(video, motion, output, mode='envelope')
    assert report['held_frames'] == 5 and report['landmark_frames'] == 10
    assert report['crop'] == [112, 22, 96, 196]
    points[-10:, 1, 1] = 26000
    np.savez(motion, timestamps=np.arange(15) / 15, frame_indices=np.arange(15), pred_keypoints_2d=points)
    with pytest.raises(ValueError, match='missing for too long'):
        export(video, motion, output, mode='envelope')


def test_following_crop_tracks_travel_with_fixed_scale_and_contains_extended_limbs():
    boxes = [[100+i*8, 40, 180+i*8, 200] for i in range(20)]
    boxes[10] = [120, 20, 280, 210]
    track = following_crops(boxes, 640, 360, 15)
    assert len(set((w,h) for x,y,w,h in track)) == 1
    assert track[-1][0] > track[0][0]
    assert track[0][2] < 250
    for (x,y,w,h),(left,top,right,bottom) in zip(track,boxes):
        assert x<=left and y<=top and x+w>=right and y+h>=bottom


def test_person_export_removes_background_and_keeps_person(source):
    cv2 = pytest.importorskip('cv2')
    video,motion,output=source
    root=video.parent/'person-masks';(root/'masks').mkdir(parents=True)
    (root/'data.json').write_text(json.dumps({'video_sha256':digest(video),'motion_sha256':digest(motion),
        'width':320,'height':240,'times':(np.arange(15)/15).tolist()}))
    for i in range(15):
        mask=np.zeros((240,320),dtype=np.uint8);mask[50:190,140:180]=255
        cv2.imwrite(str(root/'masks'/f'{i:06d}.png'),mask)
    report=export(video,motion,output,root)
    assert report['composition']=='person-on-neutral-background'
    c=cv2.VideoCapture(str(output));ok,frame=c.read();c.release();assert ok
    assert np.linalg.norm(frame[0,0].astype(float)-[37,46,24])<12
    center=frame[frame.shape[0]//2,frame.shape[1]//2]
    assert center[0]>200 and center[1]<20 and center[2]<20
    assert frame.shape[0]<180 and frame.shape[1]<100


def test_nonlesson_title_frames_do_not_determine_person_scale():
    boxes=[[0,0,640,360]]+[[280,80,360,250]]*10+[[0,0,640,360]]
    track=following_crops(boxes,640,360,15,active=[False]+[True]*10+[False])
    assert track[0][2]<150 and track[0][3]<220
    assert all(item[2:]==track[0][2:] for item in track)


def test_soft_edge_preserves_detail_and_does_not_reintroduce_source_background():
    pytest.importorskip('cv2')
    mask=np.zeros((160,100),dtype=np.uint8);mask[20:140,25:75]=255
    frame=np.full((160,100,3),[0,0,255],dtype=np.uint8)
    frame[mask>0]=[180,100,40]
    frame[75:85,45:55]=[12,200,70]
    bg=np.array([37,46,24],dtype=np.float32)
    soft,state=composite_person(frame,mask,bg,style='soft')
    assert np.array_equal(soft[80,50],frame[80,50]),'Interior detail must stay sharp.'
    assert state['alpha'][80,24]>.05 and state['alpha'][80,20]<.02
    assert soft[:,:,2].max()<=70,'The red source wall must not bleed into feathered edges.'
    assert np.array_equal(soft[0,0],bg.astype(np.uint8))


def test_edge_stabilization_never_leaves_an_old_silhouette_after_fast_motion():
    pytest.importorskip('cv2')
    bg=np.array([37,46,24],dtype=np.float32)
    frame=np.full((120,160,3),bg,dtype=np.uint8)
    old=np.zeros((120,160),dtype=np.uint8);old[15:105,20:45]=255
    frame[old>0]=[180,100,40]
    _,state=composite_person(frame,old,bg)
    current=np.zeros_like(old);current[15:105,105:130]=255
    frame[:]=bg;frame[current>0]=[180,100,40]
    result,state=composite_person(frame,current,bg,previous=state)
    assert np.array_equal(result[60,30],bg.astype(np.uint8))
    assert state['alpha'][60,30]==0
    assert state['alpha'][60,115]>.99


def test_outlined_edge_keeps_all_original_body_pixels_opaque_and_adds_white_outside():
    pytest.importorskip('cv2')
    mask=np.zeros((160,100),dtype=np.uint8);mask[20:140,25:75]=255
    mask[70:72,15:25]=255  # Thin hand/arm detail must not be faded away.
    frame=np.full((160,100,3),[0,0,255],dtype=np.uint8)
    rng=np.random.default_rng(7)
    frame[mask>0]=rng.integers(0,200,(np.count_nonzero(mask),3),dtype=np.uint8)
    bg=np.array([37,46,24],dtype=np.float32)
    result,state=composite_person(frame,mask,bg)
    assert np.array_equal(result[mask>0],frame[mask>0]),'Feather must never soften the original body.'
    assert np.all(state['alpha'][mask>0]==1)
    rim=result[50,23]
    assert rim.min()>200 and rim.max()-rim.min()<12,'A neutral white rim should be outside the expanded person.'
    assert np.array_equal(result[50,10],bg.astype(np.uint8))
    assert np.all(result[50,20]>bg) and np.all(result[50,20]<rim),'The rim should fade outward to the background.'


def test_outline_expands_only_white_backing_without_copying_an_offset_person():
    pytest.importorskip('cv2')
    mask=np.zeros((240,160),dtype=np.uint8);mask[30:210,50:110]=255
    frame=np.full((240,160,3),[0,0,255],dtype=np.uint8)
    frame[mask>0]=[180,60,20]
    bg=np.array([37,46,24],dtype=np.float32)
    result,_=composite_person(frame,mask,bg)
    assert np.array_equal(result[mask>0],frame[mask>0])
    # The immediate exterior used to contain a second, expanded colored edge.
    rim=result[80:160,48:50].astype(int)
    assert rim.min()>200 and np.max(rim.max(axis=2)-rim.min(axis=2))<12
    assert np.array_equal(result[0,0],bg.astype(np.uint8))


def test_marker_identity_and_crop_mapping_use_anatomical_joints():
    points=np.full((70,2),[150.,100.]);points[62]=[180,80];points[41]=[120,85]
    points[15:18]=[170,180];points[18:21]=[130,185]
    mask=np.full((240,320),255,dtype=np.uint8)
    markers=limb_markers(points,(100,40,100,160),mask)
    assert markers==[[.8,.25],[.2,.28125],[.7,.875],[.3,.90625]]
    mask[:]=0
    assert limb_markers(points,(100,40,100,160),mask)==[None]*4
    mask[:]=255;points[62]=[9000,9000]
    assert limb_markers(points,(100,40,100,160),mask)[0] is None


def test_export_binds_limb_guides_to_video_crop_and_frame_clock(source):
    cv2=pytest.importorskip('cv2')
    video,motion,output=source
    points=np.tile([160.,120.],(15,70,1));points[:,62]=[145,90];points[:,41]=[175,90]
    points[:,15:18]=[150,180];points[:,18:21]=[170,180]
    np.savez(motion,timestamps=np.arange(15)/15,frame_indices=np.arange(15),pred_keypoints_2d=points)
    root=video.parent/'guide-masks';(root/'masks').mkdir(parents=True)
    (root/'data.json').write_text(json.dumps({'video_sha256':digest(video),'motion_sha256':digest(motion),
        'width':320,'height':240,'times':(np.arange(15)/15).tolist()}))
    for i in range(15):
        mask=np.zeros((240,320),dtype=np.uint8);mask[50:190,140:180]=255
        cv2.imwrite(str(root/'masks'/f'{i:06d}.png'),mask)
    report=export(video,motion,output,root)
    guides=report['instructor_markers']
    assert guides['video_sha256']==digest(output)
    assert guides['order']==['left_hand','right_hand','left_foot','right_foot']
    assert len(guides['frames'])==15 and guides['times']==(np.arange(15)/15).round(6).tolist()
    x,y,w,h=report['crop_track'][0]
    assert guides['frames'][0][0]==[round((145-x)/w,6),round((90-y)/h,6)]
