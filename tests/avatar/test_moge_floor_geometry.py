import numpy as np
import pytest

from build_moge_floor_experiment import fit_plane, ray_floor
from build_moge_floor_experiment import support_scores, stabilize_offsets, track_foot, distinct_feet


def test_fixed_plane_recovers_travel_from_pixels():
    K = np.array([[900.,0,640],[0,900,360],[0,0,1]])
    normal = np.array([0.,1.,0.])
    # Ground 1.4 m below camera: lower image points are closer on the same plane.
    near = ray_floor([640,600], K, normal, -1.4)
    far = ray_floor([640,500], K, normal, -1.4)
    assert far[2] > near[2]
    np.testing.assert_allclose(near[1], 1.4)
    np.testing.assert_allclose(far[1], 1.4)
    np.testing.assert_allclose(ray_floor([640,600], K, normal, -1.4), near)


def test_horizon_and_behind_camera_rejected():
    K = np.array([[900.,0,640],[0,900,360],[0,0,1]])
    assert ray_floor([640,360], K, np.array([0.,1.,0.]), -1.4) is None
    assert ray_floor([640,200], K, np.array([0.,1.,0.]), -1.4) is None


def test_robust_plane_fit_with_outliers():
    rng = np.random.default_rng(7)
    p = rng.uniform([-2,1.4,2],[2,1.4,8],(1000,3))
    p[:,1] += rng.normal(0,.003,len(p))
    p[:150] += rng.uniform(-.5,.5,(150,3))
    normal,d,report = fit_plane(p)
    assert normal[1] > .99
    assert abs(d+1.4) < .01
    assert report['inlier_fraction'] > .8
    with pytest.raises(ValueError):
        fit_plane(p[:3])


def test_support_does_not_drop_at_ten_centimetre_boundary():
    pixels=np.array([[800.,540.],[730.,539.]])
    local=np.array([[0.,-.15,0.],[0.,-.251,0.]])
    a,state=support_scores(pixels,local,np.ones(2),np.ones(2),np.ones(2,bool))
    local[1,1]=-.249
    b,_=support_scores(pixels,local,np.ones(2),np.ones(2),np.ones(2,bool))
    assert state[1]
    assert abs(a[1]-b[1])<.01


def test_short_gap_bridges_and_long_loss_holds_correction():
    times=np.arange(40)/15
    values=np.zeros((40,3));values[:,2]=1.4
    valid=np.ones(40,bool);valid[10:18]=False;valid[25:]=False
    values[~valid]=0
    result,modes=stabilize_offsets(values,valid,times)
    assert np.all(result[9:,2]>1.39)
    assert modes[14]=='bridged' and modes[-1]=='held'


def test_image_features_follow_motion_without_sam_pixel_offset():
    cv2=pytest.importorskip('cv2')
    rng=np.random.default_rng(4)
    before=np.zeros((160,160),np.uint8)
    before[70:115,60:110]=rng.integers(30,255,(45,50),dtype=np.uint8)
    after=cv2.warpAffine(before,np.float32([[1,0,6],[0,1,2]]),(160,160))
    tracked=track_foot(before,after,before>0,np.array([85.,110.]))
    assert tracked is not None
    np.testing.assert_allclose(tracked,[91,112],atol=.6)


def test_collapsed_foot_tracks_do_not_reject_the_visible_foot():
    keep=distinct_feet(np.array([[727.,539.],[727.,539.]]),
                       np.array([[828.,556.],[735.,531.]]))
    np.testing.assert_array_equal(keep,[False,True])
