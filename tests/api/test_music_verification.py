"""Owner review of diagnostic verification findings: persistence and staleness."""
import io
import json
import zipfile
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from apps.api.contracts import MusicDraftDocument
from apps.api.database import MusicDraft, MusicVerificationDecision
from apps.api.music_corrections import (VERIFIER_PATH, current_application_sha256,
                                       file_sha256, policy_sha256)
from apps.api.music_verification import (automatic_working_document, current_state_token,
                                         proposal_sha256)
from scripts.piano_verifier import proposal_digest
from support_multi import import_music
from test_music_conversions import music_app


EVENTS = [
    {'id': 'e1', 'onset': 0.7, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7,
     'confidence': None, 'optional': False, 'string': None, 'fret': None},
    {'id': 'e2', 'onset': 1.0, 'duration': 0.4, 'pitch': 64, 'velocity': None,
     'confidence': None, 'optional': True, 'string': None, 'fret': None},
]


def implementation(settings_sha='a' * 64):
    return {'verifier_code_sha256': file_sha256(VERIFIER_PATH),
            'settings_sha256': settings_sha, 'weights_sha256': 'b' * 64,
            'model': 'basic-pitch', 'model_version': '0.4.0',
            'decoder': 'basic-pitch-0.4.0/piano-peaks-v1',
            'decoder_sha256': 'c' * 64,
            'application_code_sha256': current_application_sha256()}


def report(findings, events=EVENTS):
    return {'schema_version': 1, 'verifier_version': 'piano-verifier-1', 'mode': 'diagnostic',
            'status': 'complete',
            'source': {'audio_sha256': 'a' * 64, 'proposal_sha256': proposal_sha256(events),
                       'duration': 2.0, 'note_count': len(events)},
            'settings': {}, 'settings_sha256': '0' * 64,
            'findings': findings, 'edits': [edit for finding in findings for edit in finding['proposed_edits']],
            'summary': {'finding_count': len(findings)},
            'warnings': []}


def finding(identifier, edits, kind='onset_shift', pitch=60):
    return {'id': identifier, 'kind': kind, 'status': 'suggested',
            'time_range': [0.5, 0.9],
            'event_ids': [value for edit in edits for value in edit['event_ids']],
            'pitch': pitch, 'explanation': 'This note may start slightly later.',
            'evidence': {'gain': 0.4}, 'alternatives': [], 'proposed_edits': edits,
            'ambiguous': False, 'ambiguity_reasons': []}


def shift_edit(identifier='e1', onset=0.5):
    return {'op': 'set_onset', 'event_ids': [identifier], 'before': {'onset': 0.7},
            'after': {'onset': onset}, 'reason': 'Pitch attack evidence.'}


def seed(tmp_path, findings=None, status='draft', with_report=True, events=None, report_value=None):
    manager = music_app(tmp_path)
    client, app, settings, store, mail = manager.__enter__()
    manifest = import_music((client, app, settings, mail, store))
    lesson_id = manifest.lesson_id
    owner = client.get('/api/auth/session').json()['account']['id']
    draft_id = uuid4().hex
    source_events = [dict(event) for event in (events or EVENTS)]
    document = {'draft_version': 1, 'subject': 'piano', 'instrument': {'instrument': 'piano'},
                'duration': 2.0, 'reference': manifest.reference.model_dump(),
                'events': source_events,
                'spans': [{'start': 0.2, 'end': 1.8}], 'guitar_chords': [],
                'provenance': {'adapter': 'basic-pitch-adapter', 'engine': 'onnx',
                               'model': 'basic-pitch', 'model_version': '0.4.0',
                               'code_version': 'test', 'audio_sha256': 'a' * 64},
                'warnings': []}
    with Session(app.state.engine) as session:
        session.add(MusicDraft(id=draft_id, job_id=uuid4().hex, lesson_id=lesson_id, owner_id=owner,
                               subject='piano', instrument='piano', status=status, document=document))
        session.commit()
    if with_report:
        value = report_value or report(findings or [finding('vf-1', [shift_edit()])], events=source_events)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('verification.json', json.dumps(value))
        store.objects[f'lessons/{lesson_id}/{draft_id}-analysis.zip'] = buffer.getvalue()
    return manager, client, app, settings, store, mail, lesson_id, owner, draft_id


def close(context):
    context[0].__exit__(None, None, None)


def decide(client, lesson_id, draft_id, payload):
    if 'base_state_token' not in payload:
        state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
        payload = {**payload, 'base_state_token': state['state_token'],
                   'base_report_sha256': state['report_sha256']}
    return client.post(f'/api/lessons/{lesson_id}/music-draft/verification-decision',
                       json={'draft_id': draft_id, **payload})


def test_owner_reads_accepts_and_reopens_a_suggestion(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            url = f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}'
            opened = client.get(url)
            assert opened.status_code == 200, opened.text
            state = opened.json()
            assert state['available'] is True and state['stale'] is False
            assert state['decisions'] == [] and state['events'][0]['onset'] == 0.7
            assert state['report']['findings'][0]['id'] == 'vf-1'
            accepted = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert accepted.status_code == 200, accepted.text
            after = accepted.json()
            assert after['events'][0]['onset'] == 0.5
            assert after['decisions'][0]['decision'] == 'accepted'
            reopened = client.get(url).json()
            assert reopened['events'][0]['onset'] == 0.5
            assert reopened['decisions'][0]['finding_id'] == 'vf-1'
        with Session(app.state.engine) as session:
            row = session.scalar(select(MusicVerificationDecision).where(
                MusicVerificationDecision.draft_id == draft_id))
            assert row.decision == 'accepted' and row.reviewer_id == owner
            assert row.document['edits'][0]['op'] == 'set_onset'
            baseline = session.get(MusicDraft, draft_id)
            assert baseline.document['events'][0]['onset'] == 0.7
        with patch('apps.api.music_verification.storage_client', return_value=store):
            undone = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': proposal_sha256(EVENTS),
                'finding_id': 'vf-1', 'decision': 'cleared'})
            assert undone.status_code == 200, undone.text
            assert undone.json()['events'][0]['onset'] == 0.7
            assert undone.json()['decisions'] == []
    finally:
        close(context)


def test_rejection_is_recorded_without_changing_the_proposal(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            rejected = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': proposal_sha256(EVENTS),
                'finding_id': 'vf-1', 'decision': 'rejected'})
            assert rejected.status_code == 200, rejected.text
            state = rejected.json()
            assert state['events'][0]['onset'] == 0.7
            assert state['decisions'][0]['decision'] == 'rejected'
    finally:
        close(context)


def test_changed_proposal_rejects_the_stale_report_and_decisions(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            draft = session.get(MusicDraft, draft_id)
            draft.document = {**draft.document, 'events': [{**draft.document['events'][0], 'pitch': 62},
                                                           draft.document['events'][1]]}
            session.commit()
        with patch('apps.api.music_verification.storage_client', return_value=store):
            url = f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}'
            state = client.get(url)
            assert state.status_code == 200, state.text
            assert state.json()['stale'] is True and state.json()['events'][0]['pitch'] == 62
            refused = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': proposal_sha256(EVENTS),
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert refused.status_code == 409
            assert 'changed' in refused.json()['detail']
    finally:
        close(context)


def test_conflicting_acceptances_are_refused(tmp_path):
    merger = {'op': 'merge', 'event_ids': ['e1', 'e2'],
              'before': [{'id': 'e1', 'onset': 0.7, 'duration': 0.4, 'pitch': 60, 'velocity': 0.7},
                         {'id': 'e2', 'onset': 1.0, 'duration': 0.4, 'pitch': 64, 'velocity': None}],
              'after': {'onset': 0.7, 'duration': 0.6, 'pitch': 60},
              'reason': 'One strike.'}
    findings = [finding('vf-1', [merger], kind='duplicate_event', pitch=60),
                finding('vf-2', [shift_edit('e2', 1.1)])]
    context = seed(tmp_path, findings=findings)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            base = proposal_sha256(EVENTS)
            first = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': base, 'finding_id': 'vf-1', 'decision': 'accepted'})
            assert first.status_code == 200, first.text
            second = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': base, 'finding_id': 'vf-2', 'decision': 'accepted'})
            assert second.status_code == 409
            assert 'conflicts' in second.json()['detail']
    finally:
        close(context)


def test_non_owner_cannot_read_or_decide(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        from fastapi.testclient import TestClient
        from test_accounts import login, register
        with patch('apps.api.music_verification.storage_client', return_value=store):
            with TestClient(app) as other:
                other.headers.update({'Origin': 'http://testserver', 'X-Form-Request': '1'})
                register(other, mail, 'verification-other@example.test')
                login(other, 'verification-other@example.test')
                url = f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}'
                assert other.get(url).status_code == 404
                denied = other.post(f'/api/lessons/{lesson_id}/music-draft/verification-decision', json={
                    'draft_id': draft_id, 'base_proposal_sha256': proposal_sha256(EVENTS),
                    'base_state_token': '0' * 64, 'base_report_sha256': '0' * 64,
                    'finding_id': 'vf-1', 'decision': 'accepted'})
                assert denied.status_code == 404
    finally:
        close(context)


def test_missing_artifact_and_reviewed_draft_are_reported(tmp_path):
    context = seed(tmp_path, with_report=False)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            url = f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}'
            missing = client.get(url)
            assert missing.status_code == 200
            assert missing.json()['available'] is False
            assert missing.json()['report'] is None
            assert missing.json()['report_error'] == 'missing-artifact'
        with Session(app.state.engine) as session:
            session.get(MusicDraft, draft_id).status = 'reviewed'
            session.commit()
        with patch('apps.api.music_verification.storage_client', return_value=store):
            reviewed = client.get(url)
            assert reviewed.status_code == 409
    finally:
        close(context)


def test_reviewed_reference_records_owner_verification_provenance(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            accepted = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'}).json()
        # The draft reference identity comes from the stored draft view.
        view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        response = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json={
            'draft_id': draft_id, 'reference_sha256': view['reference']['sha256'],
            'title': 'Verified piano', 'events': accepted['events'], 'spans': view['spans'],
            'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 2}],
            'verification_state_token': accepted['state_token'],
            'confirm_reviewed': True})
        assert response.status_code == 200, response.text
        manifest = response.json()
        reference = json.loads(store.objects[manifest['reference']['key']])
        decisions = reference['review']['verification']['decisions']
        assert decisions[0]['finding_id'] == 'vf-1' and decisions[0]['decision'] == 'accepted'
        assert decisions[0]['document']['edits'][0]['op'] == 'set_onset'
        assert reference['events'][0]['onset'] == 0.5
    finally:
        close(context)


def test_real_verifier_output_is_accepted_by_the_review_api(tmp_path):
    import math
    import numpy as np
    from scripts.piano_verifier import verify_piano_transcription

    rate = 22050
    times = np.arange(int(2.0 * rate)) / rate
    values = np.zeros(len(times))
    low = int(round(0.5 * rate))
    local = times[low:] - 0.5
    values[low:] = 0.5 * np.sin(2 * math.pi * 261.63 * local) * np.exp(-local / 1.2)
    events = [{'id': 'e1', 'onset': 0.63, 'duration': 1.0, 'pitch': 60, 'velocity': 0.5,
               'confidence': None, 'optional': False, 'string': None, 'fret': None}]
    result = verify_piano_transcription(audio=values, events=events, sample_rate=rate, duration=2.0,
                                     provenance={'audio_sha256': 'a' * 64})
    suggested = [item for item in result['findings'] if item['status'] == 'suggested' and item['proposed_edits']]
    assert suggested, result['findings']
    context = seed(tmp_path, events=events, report_value=result)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert state['stale'] is False
            accepted = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'finding_id': suggested[0]['id'], 'decision': 'accepted'})
            assert accepted.status_code == 200, accepted.text
            assert abs(accepted.json()['events'][0]['onset'] - 0.5) <= 0.07
    finally:
        close(context)


def test_proposal_digest_matches_the_verifier_for_optional_fields():
    events = [{'id': 'a', 'onset': 0.5, 'duration': None, 'pitch': 60, 'velocity': None}]
    assert proposal_sha256(events) == proposal_digest(events)


def _rewrite_report(store, lesson_id, draft_id, value):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('verification.json', json.dumps(value))
    store.objects[f'lessons/{lesson_id}/{draft_id}-analysis.zip'] = buffer.getvalue()


def accept_first(client, lesson_id, draft_id):
    state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
    finding = state['report']['findings'][0]
    response = decide(client, lesson_id, draft_id, {
        'base_proposal_sha256': state['proposal_sha256'],
        'base_state_token': state['state_token'],
        'base_report_sha256': state['report_sha256'],
        'finding_id': finding['id'], 'decision': 'accepted'})
    assert response.status_code == 200, response.text
    return state, response.json()


def test_accepted_work_survives_archive_expiry_and_can_be_undone(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            before, accepted = accept_first(client, lesson_id, draft_id)
            assert accepted['events'][0]['onset'] == 0.5
            del store.objects[f'lessons/{lesson_id}/{draft_id}-analysis.zip']
            reopened = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert reopened['available'] is False and reopened['report'] is None
            assert reopened['report_error'] == 'missing-artifact'
            assert reopened['events'][0]['onset'] == 0.5
            assert reopened['decisions'][0]['decision'] == 'accepted'
            assert reopened['state_token'] == accepted['state_token']
            undone = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': reopened['proposal_sha256'],
                'base_state_token': reopened['state_token'],
                'finding_id': 'vf-1', 'decision': 'cleared'})
            assert undone.status_code == 200, undone.text
            assert undone.json()['events'][0]['onset'] == 0.7
            assert undone.json()['decisions'] == []
    finally:
        close(context)


def test_review_save_does_not_need_the_expired_archive(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            _before, accepted = accept_first(client, lesson_id, draft_id)
            del store.objects[f'lessons/{lesson_id}/{draft_id}-analysis.zip']
            view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
            response = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json={
                'draft_id': draft_id, 'reference_sha256': view['reference']['sha256'],
                'title': 'Verified after expiry', 'events': accepted['events'], 'spans': view['spans'],
                'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 2}],
                'verification_state_token': accepted['state_token'], 'confirm_reviewed': True})
            assert response.status_code == 200, response.text
    finally:
        close(context)


def test_added_note_is_clipped_and_can_be_saved_after_review(tmp_path):
    add = {'op': 'add_note', 'event_ids': [], 'before': None,
           'after': {'onset': 1.9, 'duration': 0.4, 'pitch': 60, 'velocity': 0.5},
           'reason': 'Unmatched attack.'}
    context = seed(tmp_path, findings=[finding('vf-1', [add], kind='unmatched_attack')])
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            _state, accepted = accept_first(client, lesson_id, draft_id)
            added = [event for event in accepted['events'] if event['id'] == 'vf-vf-1-a']
            assert len(added) == 1 and abs(added[0]['duration'] - 0.1) < 1e-6
            view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
            response = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json={
                'draft_id': draft_id, 'reference_sha256': view['reference']['sha256'],
                'title': 'Clipped addition', 'events': accepted['events'], 'spans': view['spans'],
                'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 2}],
                'verification_state_token': accepted['state_token'], 'confirm_reviewed': True})
            assert response.status_code == 200, response.text
    finally:
        close(context)


def test_automatic_working_document_applies_only_qualified_corrections(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            document = session.get(MusicDraft, draft_id).document
        qualified = {**finding('vf-1', [shift_edit('e1', 0.5)]),
                     'correction_status': 'qualified'}
        withheld = {**finding('vf-2', [shift_edit('e2', 0.6)]),
                    'status': 'unresolved', 'correction_status': 'withheld'}
        impl = implementation()
        policy = {'policy_version': 'piano-corrections-1', 'status': 'qualified',
                  'categories': {'onset_shift': {'enabled': True}},
                  'implementation': impl}
        report_value = {'mode': 'qualified', 'findings': [qualified, withheld],
                        'source': {'proposal_sha256': proposal_sha256(document['events']),
                                   'verifier_code_sha256': impl['verifier_code_sha256'],
                                   'model': impl['model'], 'model_version': impl['model_version'],
                                   'decoder': impl['decoder'],
                                   'decoder_sha256': impl['decoder_sha256'],
                                   'weights_sha256': impl['weights_sha256']},
                        'settings_sha256': impl['settings_sha256'],
                        'correction_policy': {'mode': 'qualified', 'policy': policy,
                                              'policy_sha256': policy_sha256(policy),
                                              'enabled_categories': ['onset_shift']}}
        working, history = automatic_working_document(document, report_value)
        assert working is not None and len(history) == 1
        assert working['events'][0]['onset'] == 0.5
        assert working['events'][1]['onset'] == 1.0
        assert document['events'][0]['onset'] == 0.7
        MusicDraftDocument.model_validate(working)
        assert history[0]['finding_id'] == 'vf-1' and history[0]['reverted_at'] is None
    finally:
        close(context)


def test_draft_serves_working_notes_and_rollback_retains_history(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            row = session.get(MusicDraft, draft_id)
            working = {**row.document,
                       'events': [{**row.document['events'][0], 'onset': 0.5},
                                  row.document['events'][1]]}
            row.working_document = working
            row.correction_history = [{'source': 'automatic', 'finding_id': 'vf-1',
                                       'kind': 'onset_shift', 'applied_at': '2026-11-11T00:00:00+00:00',
                                       'edits': [shift_edit('e1', 0.5)], 'reverted_at': None}]
            session.commit()
        view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        assert view['working_corrected'] is True
        assert view['events'][0]['onset'] == 0.5
        assert view['baseline_events'][0]['onset'] == 0.7
        assert view['automatic_corrections'][0]['finding_id'] == 'vf-1'
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert state['working_corrected'] is True
            assert state['automatic_corrections'][0]['finding_id'] == 'vf-1'
            assert state['events'][0]['onset'] == 0.5
            before_rollback_token = state['state_token']
        rolled = client.post(f'/api/lessons/{lesson_id}/music-draft/corrections/rollback',
                             json={'draft_id': draft_id,
                                   'base_state_token': before_rollback_token})
        assert rolled.status_code == 200, rolled.text
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert state['state_token'] != before_rollback_token
        restored = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        assert restored['events'][0]['onset'] == 0.7
        assert 'working_corrected' not in restored
        with Session(app.state.engine) as session:
            history = session.get(MusicDraft, draft_id).correction_history
            assert history[0]['reverted_at']
    finally:
        close(context)


def test_rollback_requires_the_displayed_draft_and_token(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            old = session.get(MusicDraft, draft_id)
            working = {**old.document,
                       'events': [{**old.document['events'][0], 'onset': 0.5},
                                  old.document['events'][1]]}
            history = [{'source': 'automatic', 'finding_id': 'vf-1',
                        'kind': 'onset_shift', 'applied_at': '2026-11-11T00:00:00+00:00',
                        'edits': [shift_edit('e1', 0.5)], 'reverted_at': None}]
            old.working_document = working
            old.correction_history = history
            new_id = uuid4().hex
            session.add(MusicDraft(id=new_id, job_id=uuid4().hex, lesson_id=lesson_id,
                                   owner_id=owner, subject='piano', instrument='piano',
                                   status='draft', document=old.document,
                                   working_document=working, correction_history=history))
            session.commit()
            old_token = current_state_token(old, [])
        stale = client.post(f'/api/lessons/{lesson_id}/music-draft/corrections/rollback',
                            json={'draft_id': draft_id, 'base_state_token': old_token})
        assert stale.status_code == 409
        with Session(app.state.engine) as session:
            assert session.get(MusicDraft, new_id).working_document is not None
            new_token = current_state_token(session.get(MusicDraft, new_id), [])
        current = client.post(f'/api/lessons/{lesson_id}/music-draft/corrections/rollback',
                              json={'draft_id': new_id, 'base_state_token': new_token})
        assert current.status_code == 200, current.text
    finally:
        close(context)


def test_review_records_automatic_correction_history(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            row = session.get(MusicDraft, draft_id)
            working = {**row.document,
                       'events': [{**row.document['events'][0], 'onset': 0.5},
                                  row.document['events'][1]]}
            row.working_document = working
            row.correction_history = [{'source': 'automatic', 'finding_id': 'vf-1',
                                       'kind': 'onset_shift', 'applied_at': '2026-11-11T00:00:00+00:00',
                                       'edits': [shift_edit('e1', 0.5)], 'reverted_at': None}]
            session.commit()
            events = working['events']
        view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
        response = client.post(f'/api/lessons/{lesson_id}/music-draft/review', json={
            'draft_id': draft_id, 'reference_sha256': view['reference']['sha256'],
            'title': 'Automatic correction', 'events': events, 'spans': view['spans'],
            'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 2}],
            'verification_state_token': state['state_token'],
            'confirm_reviewed': True})
        assert response.status_code == 200, response.text
        manifest = response.json()
        reference = json.loads(store.objects[manifest['reference']['key']])
        verification = reference['review']['verification']
        assert verification['working_corrected'] is True
        assert verification['automatic_corrections'][0]['finding_id'] == 'vf-1'
        assert verification['baseline_sha256'] != verification['working_sha256']
    finally:
        close(context)


def test_stale_tab_cannot_change_decisions_or_save_the_review(tmp_path):
    findings = [finding('vf-1', [shift_edit('e1', 0.5)]), finding('vf-2', [shift_edit('e2', 1.1)])]
    context = seed(tmp_path, findings=findings)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            first, accepted = accept_first(client, lesson_id, draft_id)
            stale_decision = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': first['proposal_sha256'],
                'base_state_token': first['state_token'],
                'base_report_sha256': first['report_sha256'],
                'finding_id': 'vf-2', 'decision': 'accepted'})
            assert stale_decision.status_code == 409
            assert 'another tab' in stale_decision.json()['detail']
            view = client.get(f'/api/lessons/{lesson_id}/music-draft').json()
            body = {'draft_id': draft_id, 'reference_sha256': view['reference']['sha256'],
                    'title': 'Stale piano', 'events': accepted['events'], 'spans': view['spans'],
                    'sections': [{'id': 'whole', 'label': 'Whole lesson', 'start': 0, 'end': 2}],
                    'confirm_reviewed': True}
            stale_save = client.post(f'/api/lessons/{lesson_id}/music-draft/review',
                                     json={**body, 'verification_state_token': first['state_token']})
            assert stale_save.status_code == 409
            assert 'working notes changed' in stale_save.json()['detail']
            missing_edit = client.post(f'/api/lessons/{lesson_id}/music-draft/review',
                                       json={**body, 'events': view['events'],
                                             'verification_state_token': accepted['state_token']})
            assert missing_edit.status_code == 409
            assert 'do not include' in missing_edit.json()['detail']
            saved = client.post(f'/api/lessons/{lesson_id}/music-draft/review',
                                json={**body, 'verification_state_token': accepted['state_token']})
            assert saved.status_code == 200, saved.text
    finally:
        close(context)


def test_out_of_clip_or_invalid_edits_are_refused_before_commit(tmp_path):
    out_of_clip = {'op': 'set_onset', 'event_ids': ['e1'], 'before': {'onset': 0.7},
                   'after': {'onset': 1.9}, 'reason': 'Too late.'}
    context = seed(tmp_path, findings=[finding('vf-1', [out_of_clip])])
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            refused = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'base_state_token': state['state_token'],
                'base_report_sha256': state['report_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert refused.status_code == 422
            reopened = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert reopened['decisions'] == [] and reopened['events'][0]['onset'] == 0.7
    finally:
        close(context)


def test_withheld_correction_cannot_be_accepted(tmp_path):
    withheld = {**finding('vf-1', [shift_edit('e1', 0.5)]),
                'status': 'unresolved', 'correction_status': 'withheld',
                'withheld_reason': 'Category has not met qualification limits.'}
    context = seed(tmp_path, findings=[withheld])
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            refused = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'base_state_token': state['state_token'],
                'base_report_sha256': state['report_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert refused.status_code == 422
            dismissed = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'base_state_token': state['state_token'],
                'base_report_sha256': state['report_sha256'],
                'finding_id': 'vf-1', 'decision': 'rejected'})
            assert dismissed.status_code == 200, dismissed.text
    finally:
        close(context)


def test_qualified_report_accepts_a_qualified_correction(tmp_path):
    qualified = {**finding('vf-1', [shift_edit('e1', 0.5)]),
                 'correction_status': 'qualified'}
    report_value = {**report([qualified]), 'mode': 'qualified',
                    'correction_policy': {'mode': 'qualified', 'policy_version': 'piano-corrections-1',
                                          'policy_sha256': 'b' * 64,
                                          'enabled_categories': ['onset_shift'],
                                          'withheld_count': 0}}
    context = seed(tmp_path, report_value=report_value)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            accepted = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'base_state_token': state['state_token'],
                'base_report_sha256': state['report_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()['events'][0]['onset'] == 0.5
    finally:
        close(context)


def test_automatic_application_rejects_inconsistent_qualification(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with Session(app.state.engine) as session:
            document = session.get(MusicDraft, draft_id).document
        impl = implementation()

        def report(policy_categories, finding, app_hash=None):
            impl_value = {**impl, 'application_code_sha256': app_hash or impl['application_code_sha256']}
            policy = {'policy_version': 'piano-corrections-1', 'status': 'qualified',
                      'categories': policy_categories, 'implementation': impl_value}
            return {'mode': 'qualified',
                    'source': {'proposal_sha256': proposal_sha256(document['events']),
                               'verifier_code_sha256': impl['verifier_code_sha256'],
                               'model': impl['model'], 'model_version': impl['model_version'],
                               'decoder': impl['decoder'],
                               'decoder_sha256': impl['decoder_sha256'],
                               'weights_sha256': impl['weights_sha256']},
                    'settings_sha256': impl['settings_sha256'],
                    'findings': [finding],
                    'correction_policy': {'mode': 'qualified', 'policy': policy,
                                          'policy_sha256': policy_sha256(policy),
                                          'enabled_categories': sorted(policy_categories)}}

        qualified = {**finding('vf-1', [shift_edit('e1', 0.5)]),
                     'correction_status': 'qualified'}
        assert automatic_working_document(document, report({}, qualified))[0] is None
        ambiguous = {**qualified, 'ambiguous': True}
        assert automatic_working_document(document, report({'onset_shift': {'enabled': True}}, ambiguous))[0] is None
        unresolved = {**qualified, 'status': 'unresolved'}
        assert automatic_working_document(document, report({'onset_shift': {'enabled': True}}, unresolved))[0] is None
        unsupported = {**qualified, 'proposed_edits': [{'op': 'rewrite_all', 'event_ids': ['e1'],
                                                        'before': None, 'after': {}}]}
        assert automatic_working_document(document, report({'onset_shift': {'enabled': True}}, unsupported))[0] is None
        deletion = {**qualified, 'proposed_edits': [{'op': 'delete_note', 'event_ids': ['e1'],
                                                   'before': document['events'][0], 'after': None}]}
        assert automatic_working_document(document, report({'onset_shift': {'enabled': True}}, deletion))[0] is None
        assert automatic_working_document(
            document, report({'onset_shift': {'enabled': True}}, qualified, '0' * 64))[0] is None
        conflicting = {**qualified, 'id': 'vf-2',
                       'proposed_edits': [shift_edit('e1', 0.6)]}
        two = report({'onset_shift': {'enabled': True}}, qualified)
        two['findings'].append(conflicting)
        assert automatic_working_document(document, two)[0] is None
        wrong_verifier = {**impl, 'verifier_code_sha256': '0' * 64}
        changed = report({'onset_shift': {'enabled': True}}, qualified)
        changed['correction_policy']['policy'] = {
            **changed['correction_policy']['policy'], 'implementation': wrong_verifier}
        changed['correction_policy']['policy_sha256'] = policy_sha256(
            changed['correction_policy']['policy'])
        assert automatic_working_document(document, changed)[0] is None
        wrong_settings = {**impl, 'settings_sha256': '0' * 64}
        changed = report({'onset_shift': {'enabled': True}}, qualified)
        changed['correction_policy']['policy'] = {
            **changed['correction_policy']['policy'], 'implementation': wrong_settings}
        changed['correction_policy']['policy_sha256'] = policy_sha256(
            changed['correction_policy']['policy'])
        assert automatic_working_document(document, changed)[0] is None
    finally:
        close(context)


def test_incompatible_property_edits_are_refused(tmp_path):
    findings = [finding('vf-1', [shift_edit('e1', 0.5)]), finding('vf-2', [shift_edit('e1', 0.6)])]
    context = seed(tmp_path, findings=findings)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            first, accepted = accept_first(client, lesson_id, draft_id)
            second = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': accepted['proposal_sha256'],
                'base_state_token': accepted['state_token'],
                'base_report_sha256': accepted['report_sha256'],
                'finding_id': 'vf-2', 'decision': 'accepted'})
            assert second.status_code == 409
            assert 'conflicts' in second.json()['detail']
    finally:
        close(context)


def test_report_identity_and_digest_changes_are_refused(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            report = dict(state['report'])
            report['source'] = {**report['source'], 'audio_sha256': 'c' * 64}
            _rewrite_report(store, lesson_id, draft_id, report)
            mismatch = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            assert mismatch['available'] is False and mismatch['report_error'] == 'identity-mismatch'
            assert mismatch['events'][0]['onset'] == 0.7
    finally:
        close(context)


def test_changed_report_digest_blocks_acceptance(tmp_path):
    context = seed(tmp_path)
    _, client, app, settings, store, mail, lesson_id, owner, draft_id = context
    try:
        with patch('apps.api.music_verification.storage_client', return_value=store):
            state = client.get(f'/api/lessons/{lesson_id}/music-analysis/verification?draft_id={draft_id}').json()
            report = dict(state['report'])
            report['runtime_seconds'] = 999
            _rewrite_report(store, lesson_id, draft_id, report)
            refused = decide(client, lesson_id, draft_id, {
                'base_proposal_sha256': state['proposal_sha256'],
                'base_state_token': state['state_token'],
                'base_report_sha256': state['report_sha256'],
                'finding_id': 'vf-1', 'decision': 'accepted'})
            assert refused.status_code == 409
            assert 'report changed' in refused.json()['detail']
    finally:
        close(context)

