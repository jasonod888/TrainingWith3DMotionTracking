"""Placement invariants; no private videos or model weights required."""
import json

import numpy as np
import pytest

from ground_motion import AXES, digest, load_placement, run, solve


def sequence(n=60):
    t = np.arange(n)/15
    local = np.zeros((n, 70, 3))
    raw = np.zeros((n, 3))
    return t, raw, local


def test_planted_contact_removes_false_depth_without_locking_crouch():
    t, raw, local = sequence()
    raw[:, 2] = 2*np.sin(np.linspace(0, np.pi, len(t)))
    # Body-relative sole moves upwards as the pelvis crouches.
    local[:, 17, 1] = -.9+.3*np.sin(np.linspace(0, np.pi, len(t)))
    result, active, error = solve(t, raw, local, [dict(start=0, end=59, point=17)])
    assert active.all() and error < .005
    assert np.ptp(result[:, 2]) < .005
    assert np.ptp(result[:, 1]) > .29


def test_no_contacts_preserves_walking_and_jump():
    t, raw, local = sequence()
    raw[:, 0] = t
    raw[:, 1] = np.sin(t)
    result, active, error = solve(t, raw, local, [])
    np.testing.assert_allclose(result, raw, atol=1e-5)
    assert not active.any()


def test_conflicting_contacts_have_large_residual():
    t, raw, local = sequence()
    local[:, 20, 0] = t
    _, _, error = solve(t, raw, local, [dict(start=0, end=59, point=17),
                                        dict(start=0, end=59, point=20)])
    assert error > .3


def test_review_identity_and_timestamp_contract(tmp_path):
    t, raw, local = sequence()
    motion = tmp_path/'motion.npz'
    np.savez(motion, timestamps=t, pred_cam_t=raw, pred_keypoints_3d=local/AXES)
    spec = tmp_path/'contacts.json'
    spec.write_text(json.dumps(dict(reviewed=True, motion_sha256=digest(motion),
                                   contacts=[dict(start=0, end=59, point=17)])))
    report = run(motion, tmp_path/'result', contact_file=spec)
    assert report['status'] == 'reviewed-contact-correction'
    artifact = tmp_path/'result/grounding.npz'
    np.testing.assert_allclose(load_placement(artifact, motion, t), raw, atol=1e-6)
    with pytest.raises(ValueError, match='timestamps'):
        load_placement(artifact, motion, t+.01)
    np.savez(motion, changed=True)
    with pytest.raises(ValueError, match='identity'):
        load_placement(artifact, motion, t)


def test_diagnostic_only_never_emits_correction(tmp_path):
    t, raw, local = sequence()
    path = tmp_path/'motion.npz'
    np.savez(path, timestamps=t, pred_cam_t=raw, pred_keypoints_3d=local)
    report = run(path, tmp_path/'result')
    assert report['status'] == 'diagnostic-only'
    assert not (tmp_path/'result/grounding.npz').exists()
