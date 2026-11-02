import numpy as np

from build_image_motion_revision import corrected_offsets


def test_stable_image_suppresses_false_depth():
    feet = np.zeros((61, 2, 3))
    feet[:, :, 2] = np.sin(np.linspace(0, np.pi, 61))[:, None]*2.5
    offset, supported = corrected_offsets(feet, np.zeros((61, 2, 2)),
                                          np.ones((61, 2), bool), 170.)
    original = np.ptp(feet.mean(axis=1)[:, 2])
    revised = np.ptp((feet+offset[:, None, :]).mean(axis=1)[:, 2])
    assert original > 2.4 and revised < .02
    assert supported.all()


def test_unobserved_travel_is_not_pinned():
    feet = np.zeros((61, 2, 3))
    feet[:, :, 0] = np.linspace(0, 3, 61)[:, None]
    offset, supported = corrected_offsets(feet, np.zeros((61, 2, 2)),
                                          np.zeros((61, 2), bool), 170.)
    np.testing.assert_array_equal(offset, 0)
    assert not supported.any()


def test_image_motion_changes_target_and_crouching_stays_possible():
    feet = np.zeros((61, 2, 3))
    feet[:, :, 1] = -.2*np.sin(np.linspace(0, np.pi, 61))[:, None]
    shifts = np.zeros((61, 2, 2))
    shifts[:, :, 0] = np.linspace(0, 3, 61)[:, None]
    offset, _ = corrected_offsets(feet, shifts, np.ones((61, 2), bool), 100.)
    assert .028 < offset[-1, 0] < .031
    assert .19 < offset[30, 1] < .21
