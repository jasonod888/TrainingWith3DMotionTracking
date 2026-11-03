"""Frame trims keep media clocks aligned and preserve immutable revisions."""
import pytest
from test_accounts import system, imported


def test_trim_rebases_sections_media_and_accepts_atomically(system):
    lesson = imported(system)
    client = system[0]
    original = lesson.model_dump()
    end = int(lesson.duration * 15) - 2
    response = client.put(f'/api/lessons/{lesson.lesson_id}/trim', json={
        'base_revision_id': lesson.revision_id, 'start_frame': 2, 'end_frame': end, 'accept': True})
    assert response.status_code == 200, response.text
    value = response.json()
    assert value['duration'] == pytest.approx((end-2)/15)
    assert value['source_start'] == pytest.approx(lesson.source_start + 2/15)
    assert value['animation_start'] == pytest.approx(2/15)
    assert value['animation_duration'] == lesson.duration
    assert value['animation'] == original['animation']
    assert value['landmarks'] == original['landmarks']
    assert value['section_set']['sections'][0]['start'] == 0
    assert value['section_set']['sections'][-1]['end'] == value['duration']
    state = client.get(f'/api/workflow/lessons/{lesson.lesson_id}').json()
    assert state['accepted_revision_id'] == value['revision_id']
    assert state['latest_revision_id'] == value['revision_id']
    # A subsequent trim accumulates media offsets instead of restarting at frame zero.
    again = client.put(f'/api/lessons/{lesson.lesson_id}/trim', json={
        'base_revision_id': value['revision_id'], 'start_frame': 1, 'end_frame': end-3}).json()
    assert again['animation_start'] == pytest.approx(3/15)
    assert again['animation_duration'] == lesson.duration


@pytest.mark.parametrize('start,end', [(4,3), (-1,5), (0,999999), (1,1), (1.2,5)])
def test_invalid_frame_ranges_do_not_create_a_revision(system,start,end):
    lesson = imported(system)
    client = system[0]
    response = client.put(f'/api/lessons/{lesson.lesson_id}/trim', json={
        'base_revision_id': lesson.revision_id,'start_frame':start,'end_frame':end})
    assert response.status_code == 422
    assert client.get(f'/api/lessons/{lesson.lesson_id}').json()['revision_id'] == lesson.revision_id


def test_trim_rejects_stale_revision_and_non_owner(system):
    lesson = imported(system)
    client, app, _, mail, _ = system
    payload = {'base_revision_id':lesson.revision_id,'start_frame':1,'end_frame':10}
    assert client.put(f'/api/lessons/{lesson.lesson_id}/trim',json=payload).status_code == 200
    assert client.put(f'/api/lessons/{lesson.lesson_id}/trim',json=payload).status_code == 409
    student = __import__('test_sharing').learner(app,mail)
    assert student.put(f'/api/lessons/{lesson.lesson_id}/trim',json=payload).status_code == 404
