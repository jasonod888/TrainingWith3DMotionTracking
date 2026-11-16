"""Owner-only diagnostic verification report and decision records.

The draft document remains the immutable baseline. Accepted findings are stored with
their complete edit snapshots, so the working proposal can be reconstructed without the
expiring analysis archive. A state token covers the proposal and every decision; both
decision changes and final review saving must present the current token.
"""
import hashlib
import math
from scripts.piano_expression_identity import estimator_sha256, measurement_sha256
import io
import json
import zipfile
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import now
from .contracts import Contract, MusicDraftDocument
from .database import MusicDraft, MusicVerificationDecision
from .music_corrections import (EligibilityError, PreconditionError, apply_finding,
                                apply_qualified_corrections, file_sha256)
from .permissions import owned_lesson
from .storage import storage_client
from . import interactive_limit

MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_REPORT_BYTES = 4 * 1024 * 1024
MAX_EXPRESSION_PROPOSALS = 1000
_FLOAT_FIELDS = {'onset', 'duration', 'velocity'}
_EXPRESSION_APP_PATH = Path(__file__).resolve()
_EXPRESSION_ESTIMATOR_PATH = _EXPRESSION_APP_PATH.parents[2] / 'scripts' / 'piano_expression.py'
_EXPRESSION_VERIFIER_PATH = _EXPRESSION_APP_PATH.parents[2] / 'scripts' / 'piano_verifier.py'


class PreconditionError(ValueError):
    """An edit no longer matches the state it was generated from."""


class DecisionInput(Contract):
    draft_id: str = Field(min_length=1, max_length=80)
    base_proposal_sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    base_state_token: str = Field(pattern=r'^[a-f0-9]{64}$')
    base_report_sha256: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$')
    finding_id: str = Field(min_length=1, max_length=40)
    decision: Literal['accepted', 'rejected', 'cleared']


class RollbackInput(Contract):
    draft_id: str = Field(min_length=1, max_length=80)
    base_state_token: str = Field(pattern=r'^[a-f0-9]{64}$')


def _rounded(value) -> float:
    return round(float(value or 0.0), 4)


def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def proposal_sha256(events) -> str:
    """Must match scripts.piano_verifier.proposal_digest for the same events."""
    payload = [{'id': str(event.get('id')), 'onset': _rounded(event.get('onset')),
                'duration': _rounded(event.get('duration')), 'pitch': int(event.get('pitch')),
                'velocity': _rounded(event.get('velocity'))} for event in events]
    return hashlib.sha256(_canonical(payload).encode('utf-8')).hexdigest()


def report_sha256(report) -> str:
    return hashlib.sha256(_canonical(report).encode('utf-8')).hexdigest()


def _new_note(identifier, onset, duration, pitch, velocity):
    return {'id': identifier, 'onset': float(onset), 'duration': float(duration),
            'pitch': int(pitch), 'velocity': None if velocity is None else float(velocity),
            'confidence': None, 'optional': False, 'string': None, 'fret': None}


def _matches(item, before) -> bool:
    if not isinstance(before, dict):
        return False
    if 'id' in before and str(item.get('id')) != str(before['id']):
        return False
    for key, expected in before.items():
        if key == 'id':
            continue
        actual = item.get(key)
        if key in _FLOAT_FIELDS:
            if expected is None or actual is None:
                if expected is not actual:
                    return False
            elif abs(float(actual) - float(expected)) > 1e-6:
                return False
        elif actual != expected:
            return False
    return True


def _clamped_duration(onset, duration, clip_duration):
    if onset < -1e-9 or onset > clip_duration + 1e-9:
        raise ValueError('The proposed note lies outside the clip.')
    length = min(float(duration), float(clip_duration) - float(onset))
    if length <= 0.001:
        raise ValueError('The proposed note lies outside the clip.')
    return length


def apply_finding(events, finding, clip_duration, enforce_preconditions=True):
    """Apply one finding's edits with deterministic IDs.

    Raises PreconditionError when an edit's recorded ``before`` no longer matches the
    current event, and ValueError for missing events or invalid values.
    """
    result = [dict(event) for event in events]
    finding_id = str(finding.get('id', 'finding'))

    def locate(identifier):
        for item in result:
            if str(item['id']) == str(identifier):
                return item
        raise PreconditionError('Edit references an unknown event.')

    for edit in finding.get('proposed_edits') or []:
        operation = edit.get('op')
        identifiers = [str(value) for value in edit.get('event_ids') or []]
        before = edit.get('before')
        after = edit.get('after')
        if operation == 'set_onset':
            for identifier in identifiers:
                item = locate(identifier)
                if enforce_preconditions and isinstance(before, dict) and 'onset' in before:
                    if abs(float(item['onset']) - float(before['onset'])) > 1e-6:
                        raise PreconditionError('The onset changed since this suggestion was generated.')
                onset = float(after['onset'])
                if onset < 0 or onset > clip_duration + 1e-9:
                    raise ValueError('The proposed onset is outside the clip.')
                item['onset'] = onset
        elif operation == 'set_pitch':
            for identifier in identifiers:
                item = locate(identifier)
                if enforce_preconditions and isinstance(before, dict) and 'pitch' in before:
                    if int(item['pitch']) != int(before['pitch']):
                        raise PreconditionError('The pitch changed since this suggestion was generated.')
                pitch = int(after['pitch'])
                if not 0 <= pitch <= 127:
                    raise ValueError('The proposed pitch is outside the MIDI range.')
                item['pitch'] = pitch
        elif operation == 'delete_note':
            if enforce_preconditions:
                for identifier in identifiers:
                    if not _matches(locate(identifier), before if isinstance(before, dict) else {}):
                        raise PreconditionError('The note changed since this suggestion was generated.')
            else:
                for identifier in identifiers:
                    locate(identifier)
            result = [item for item in result if str(item['id']) not in identifiers]
        elif operation == 'merge':
            if len(identifiers) != 2:
                raise ValueError('A merge needs two events.')
            matches = [locate(value) for value in identifiers]
            if enforce_preconditions:
                snapshots = before if isinstance(before, list) else []
                for item in matches:
                    if not any(_matches(item, snapshot) for snapshot in snapshots):
                        raise PreconditionError('A merged event changed since this suggestion was generated.')
            onset = float(after['onset'])
            length = _clamped_duration(onset, after['duration'], clip_duration)
            merged = _new_note(f'vf-{finding_id}-m', onset, length, after['pitch'],
                               max(float(item.get('velocity') or 0.0) for item in matches))
            result = [item for item in result if str(item['id']) not in identifiers] + [merged]
        elif operation == 'split_note':
            if len(identifiers) != 1:
                raise ValueError('A split needs one event.')
            original = locate(identifiers[0])
            if enforce_preconditions and isinstance(before, dict):
                if not _matches(original, before):
                    raise PreconditionError('The split event changed since this suggestion was generated.')
            pieces = []
            for index, piece in enumerate(after):
                onset = float(piece['onset'])
                length = _clamped_duration(onset, piece['duration'], clip_duration)
                pieces.append(_new_note(f'vf-{finding_id}-{index + 1}', onset, length,
                                        piece['pitch'], original.get('velocity')))
            result = [item for item in result if str(item['id']) != identifiers[0]] + pieces
        elif operation == 'add_note':
            note = after
            onset = float(note['onset'])
            length = _clamped_duration(onset, note['duration'], clip_duration)
            result.append(_new_note(f'vf-{finding_id}-a', onset, length,
                                    note['pitch'], note.get('velocity')))
        else:
            raise ValueError('Unsupported verification edit operation.')
    result.sort(key=lambda item: (float(item['onset']), int(item['pitch']), str(item['id'])))
    return result


def validate_events(draft, events):
    """Validate the complete working proposal against the draft contract."""
    try:
        MusicDraftDocument.model_validate({**draft.document, 'events': events})
    except ValidationError as exc:
        raise ValueError('The resulting notes do not form a valid proposal.') from exc
    return events


def _decision_edits(row):
    return list((row.document or {}).get('edits') or [])


def _decision_finding(row):
    document = row.document or {}
    stored = document.get('finding')
    if isinstance(stored, dict):
        return stored
    return {'kind': document.get('kind'), 'pitch': document.get('pitch'),
            'time_range': document.get('time_range'),
            'explanation': document.get('explanation', '')}


def working_events(draft, rows):
    """Reconstruct the working proposal from automatic corrections plus decisions."""
    base = draft.working_document or draft.document
    events = [dict(event) for event in (base.get('events') or [])]
    conflicts = []
    clip = float(draft.document.get('duration') or 0.0)
    accepted = sorted((row for row in rows if row.decision == 'accepted'),
                      key=lambda row: (row.decided_at.isoformat() if row.decided_at else '',
                                       row.finding_id))
    for row in accepted:
        edits = _decision_edits(row)
        if not edits:
            conflicts.append(row.finding_id)
            continue
        try:
            events = apply_finding(events, {'id': row.finding_id, 'proposed_edits': edits}, clip)
        except PreconditionError:
            conflicts.append(row.finding_id)
        except (KeyError, TypeError, ValueError):
            return [dict(event) for event in (base.get('events') or [])], \
                [row.finding_id for row in accepted], 'invalid-proposal'
    try:
        validate_events(draft, events)
    except ValueError:
        return [dict(event) for event in (base.get('events') or [])], \
            [row.finding_id for row in accepted], 'invalid-proposal'
    return events, conflicts, None


def decisions_token(draft, rows):
    base = draft.working_document or draft.document
    payload = {'proposal_sha256': proposal_sha256(draft.document.get('events') or []),
               'working_sha256': proposal_sha256(base.get('events') or []),
               'decisions': [{'finding_id': row.finding_id, 'decision': row.decision,
                              'report_sha256': (row.document or {}).get('report_sha256'),
                              'edits': _decision_edits(row)}
                             for row in sorted(rows, key=lambda value: value.finding_id)]}
    return hashlib.sha256(_canonical(payload).encode('utf-8')).hexdigest()


def current_state_token(draft, rows):
    """Token over the baseline and decisions; independent of archive availability."""
    return decisions_token(draft, rows)


def read_verification_report(data):
    """Parse and validate a retained verification report from analysis.zip bytes."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if 'verification.json' not in archive.namelist():
                return None, 'no-verification'
            if archive.getinfo('verification.json').file_size > MAX_REPORT_BYTES:
                return None, 'report-too-large'
            report = json.loads(archive.read('verification.json'))
    except (KeyError, ValueError, zipfile.BadZipFile, OSError):
        return None, 'invalid-report'
    if (not isinstance(report, dict) or report.get('schema_version') != 1
            or not isinstance(report.get('findings'), list)
            or not isinstance((report.get('source') or {}).get('proposal_sha256'), str)
            or len(report['findings']) > 1000):
        return None, 'invalid-report'
    return report, None


def automatic_working_document(document, report):
    """Apply only policy-qualified edits to a copy of the draft.

    Returns ``(working_document, history)`` or ``(None, [])``. Eligibility and
    preconditions are checked independently of the report's self-declared labels.
    """
    if report.get('mode') != 'qualified':
        return None, []
    if (report.get('source') or {}).get('proposal_sha256') != proposal_sha256(
            document.get('events') or []):
        return None, []
    clip = float(document.get('duration') or 0.0)
    try:
        events, history, _policy = apply_qualified_corrections(
            document.get('events') or [], report, clip)
    except (EligibilityError, PreconditionError, KeyError, TypeError, ValueError):
        return None, []
    if not history:
        return None, []
    working = {**document, 'events': events}
    try:
        MusicDraftDocument.model_validate(working)
    except ValidationError:
        return None, []
    return working, history


def read_expression_report(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if 'expression.json' not in archive.namelist():
                return None
            if archive.getinfo('expression.json').file_size > MAX_REPORT_BYTES:
                return None
            report = json.loads(archive.read('expression.json'))
    except (KeyError, ValueError, zipfile.BadZipFile, OSError):
        return None
    if (not isinstance(report, dict) or report.get('schema_version') != 2
            or report.get('schema') != 'piano-expression-report-2'
            or not isinstance(report.get('candidates'), list)
            or not isinstance(report.get('working_sha256'), str)):
        return None
    return report


def automatic_expression_document(document, expression):
    """Apply qualified phase-4 proposals bound to the displayed working notes."""
    if not expression or expression.get('mode') != 'qualified':
        return None, []
    if expression.get('schema_version') != 2 or expression.get('schema') != 'piano-expression-report-2':
        return None, []
    if expression.get('working_sha256') != proposal_sha256(document.get('events') or []):
        return None, []
    policy = expression.get('policy') or {}
    if policy.get('policy_version') != 'piano-expression-1':
        return None, []
    if policy.get('status') != 'qualified':
        return None, []
    policy_body = {key: value for key, value in policy.items()
                   if key not in ('policy_sha256', 'enabled_categories')}
    if policy.get('policy_sha256') != hashlib.sha256(_canonical(policy_body).encode()).hexdigest():
        return None, []
    implementation = policy.get('implementation') or {}
    if implementation.get('application_code_sha256') != file_sha256(_EXPRESSION_APP_PATH):
        return None, []
    if implementation.get('estimator_code_sha256') != estimator_sha256(_EXPRESSION_ESTIMATOR_PATH.parent):
        return None, []
    if implementation.get('verifier_code_sha256') != file_sha256(_EXPRESSION_VERIFIER_PATH):
        return None, []
    if implementation.get('settings_sha256') != expression.get('settings_sha256'):
        return None, []
    source = expression.get('source') or {}
    if source.get('working_sha256') not in (None, expression.get('working_sha256')):
        return None, []
    if source.get('audio_sha256') != (document.get('provenance') or {}).get('audio_sha256'):
        return None, []
    for key in ('weights_sha256', 'decoder_sha256', 'model', 'model_version', 'decoder'):
        if not isinstance(implementation.get(key), str) or implementation[key] != source.get(key):
            return None, []
    enabled = set(policy.get('enabled_categories') or [])
    if not enabled.intersection({'audible_duration', 'relative_dynamics'}):
        return None, []
    candidates = expression.get('candidates') or []
    if len(candidates) > MAX_EXPRESSION_PROPOSALS:
        return None, []
    clip = float(document.get('duration') or 0.0)
    events = [dict(event) for event in document.get('events') or []]
    by_id = {str(event.get('id')): event for event in events}
    history = []
    for index, candidate in enumerate(candidates, 1):
        attribute = candidate.get('attribute')
        if attribute not in enabled or attribute not in ('audible_duration', 'relative_dynamics'):
            continue
        category = (policy.get('categories') or {}).get(attribute) or {}
        if category.get('enabled') is not True or category.get('implemented') is not True \
                or candidate.get('scope') not in category.get('scopes', ['isolated']):
            continue
        target, units, field = (('audible_end_seconds', 'seconds', 'duration') if attribute == 'audible_duration'
                                else ('reference_velocity', 'normalized_midi_velocity', 'velocity'))
        if candidate.get('target_kind') != target or candidate.get('units') != units:
            continue
        if candidate.get('decision') != 'change' or candidate.get('application') != 'automatic':
            continue
        if candidate.get('status') != 'qualified' or candidate.get('proposal_status') != 'suggested':
            continue
        if candidate.get('correction_status') != 'qualified' or candidate.get('ambiguous'):
            continue
        event = by_id.get(str(candidate.get('event_id')))
        if event is None or candidate.get('baseline') != event.get(field):
            continue
        value = candidate.get('proposed')
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            continue
        if attribute == 'audible_duration':
            if value <= .001 or value > clip - float(event['onset']) + 1e-6:
                continue
            event['notation_duration'] = event.get('notation_duration') or event.get('duration')
        else:
            calibration = expression.get('calibration') or {}
            calibration_body = {key: item for key, item in calibration.items() if key != 'calibration_id'}
            calibration_id = hashlib.sha256(_canonical(calibration_body).encode()).hexdigest()
            calibration_sha = hashlib.sha256(_canonical(calibration).encode()).hexdigest()
            interval = candidate.get('candidate_interval')
            velocity_bounds = calibration.get('velocity_bounds', {}).get(str(event['pitch']))
            if (not 0 < value <= 1 or calibration.get('calibration_id') != calibration_id
                    or candidate.get('calibration_id') != calibration_id
                    or implementation.get('calibration_sha256') != calibration_sha
                    or expression.get('calibration_sha256') != calibration_sha
                    or calibration.get('measurement_sha256') != measurement_sha256(implementation['settings_sha256'])
                    or calibration.get('domain') != expression.get('calibration_domain')
                    or candidate.get('calibration_domain') != calibration.get('domain')
                    or calibration.get('reference_kind') != 'captured_midi_velocity'
                    or str(event['pitch']) not in calibration.get('pitch_offsets', {})
                    or not isinstance(interval, list) or len(interval) != 2
                    or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in interval)
                    or not 0 < interval[0] <= value <= interval[1] <= 1
                    or not isinstance(velocity_bounds, list) or len(velocity_bounds) != 2
                    or interval[0] * 127 < velocity_bounds[0] or interval[1] * 127 > velocity_bounds[1]
                    or interval[1] - interval[0] > 16 / 127):
                continue
        event[field] = float(value)
        history.append({'source': 'automatic-expression', 'finding_id': f'expr-{index}',
                        'event_id': str(event['id']), 'attribute': attribute,
                        'kind': attribute, 'applied_at': now().isoformat(),
                        'before': candidate.get('baseline'), 'value': float(value), 'edits': [],
                        'expression_version': expression.get('version'),
                        'policy_sha256': policy.get('policy_sha256'),
                        'report_sha256': report_sha256(expression), 'reverted_at': None})
    if not history:
        return None, []
    working = {**document, 'events': events}
    try:
        MusicDraftDocument.model_validate(working)
    except ValidationError:
        return None, []
    return working, history


def decisions_applied(events, rows, clip_duration):
    """Whether submitted notes include every accepted decision's effect.

    Manual edits to unrelated notes remain allowed; edits to an affected property
    without first undoing the suggestion are refused.
    """
    by_id = {str(event.get('id')): event for event in events}
    for row in sorted((item for item in rows if item.decision == 'accepted'),
                      key=lambda item: (item.decided_at.isoformat() if item.decided_at else '',
                                        item.finding_id)):
        edits = _decision_edits(row)
        if not edits:
            return False
        for edit in edits:
            operation = edit.get('op')
            identifiers = [str(value) for value in edit.get('event_ids') or []]
            after = edit.get('after') or {}
            if operation == 'set_onset':
                for identifier in identifiers:
                    item = by_id.get(identifier)
                    if item is None or abs(float(item.get('onset')) - float(after['onset'])) > 1e-4:
                        return False
            elif operation == 'set_pitch':
                for identifier in identifiers:
                    item = by_id.get(identifier)
                    if item is None or int(item.get('pitch')) != int(after['pitch']):
                        return False
            elif operation == 'delete_note':
                if any(identifier in by_id for identifier in identifiers):
                    return False
            elif operation == 'add_note':
                item = by_id.get(f'vf-{row.finding_id}-a')
                expected_duration = min(float(after['duration']), float(clip_duration) - float(after['onset']))
                if (item is None or int(item.get('pitch')) != int(after['pitch'])
                        or abs(float(item.get('onset')) - float(after['onset'])) > 1e-4
                        or abs(float(item.get('duration')) - expected_duration) > 1e-4):
                    return False
            elif operation == 'merge':
                item = by_id.get(f'vf-{row.finding_id}-m')
                expected_duration = min(float(after['duration']), float(clip_duration) - float(after['onset']))
                if (item is None or any(identifier in by_id for identifier in identifiers)
                        or int(item.get('pitch')) != int(after['pitch'])
                        or abs(float(item.get('onset')) - float(after['onset'])) > 1e-4
                        or abs(float(item.get('duration')) - expected_duration) > 1e-4):
                    return False
            elif operation == 'split_note':
                if any(identifier in by_id for identifier in identifiers):
                    return False
                pieces = after if isinstance(after, list) else []
                for index, piece in enumerate(pieces):
                    item = by_id.get(f'vf-{row.finding_id}-{index + 1}')
                    if (item is None or int(item.get('pitch')) != int(piece['pitch'])
                            or abs(float(item.get('onset')) - float(piece['onset'])) > 1e-4):
                        return False
            else:
                return False
    return True


def _load_report(settings, lesson_id, draft_id):
    """Return (report, digest, None) or (None, None, reason) for the analysis artifact."""
    key = f'lessons/{lesson_id}/{draft_id}-analysis.zip'
    try:
        obj = storage_client(settings).get_object(Bucket=settings.storage_bucket, Key=key)
    except Exception:
        return None, None, 'missing-artifact'
    body = obj['Body']
    try:
        chunks, total = [], 0
        for chunk in body.iter_chunks(1024 * 1024):
            total += len(chunk)
            if total > MAX_ARCHIVE_BYTES:
                return None, None, 'artifact-too-large'
            chunks.append(chunk)
        data = b''.join(chunks)
    finally:
        body.close()
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if 'verification.json' not in archive.namelist():
                return None, None, 'no-verification'
            if archive.getinfo('verification.json').file_size > MAX_REPORT_BYTES:
                return None, None, 'report-too-large'
            raw = archive.read('verification.json')
        report = json.loads(raw)
    except (KeyError, ValueError, zipfile.BadZipFile, OSError):
        return None, None, 'invalid-report'
    if (not isinstance(report, dict) or report.get('schema_version') != 1
            or not isinstance(report.get('findings'), list)
            or not isinstance((report.get('source') or {}).get('proposal_sha256'), str)
            or len(report['findings']) > 1000):
        return None, None, 'invalid-report'
    for finding in report['findings']:
        if (not isinstance(finding, dict) or not isinstance(finding.get('id'), str)
                or not isinstance(finding.get('kind'), str)
                or not isinstance(finding.get('time_range'), list)
                or len(finding['time_range']) != 2
                or not isinstance(finding.get('proposed_edits'), list)
                or len(finding['proposed_edits']) > 20):
            return None, None, 'invalid-report'
    return report, report_sha256(report), None


def report_identity_matches(draft, report):
    """Bind a report to the exact audio and clip it was computed from."""
    source = report.get('source') or {}
    provenance = (draft.document or {}).get('provenance') or {}
    audio = provenance.get('audio_sha256')
    if not isinstance(audio, str) or source.get('audio_sha256') != audio:
        return False
    clip = draft.document.get('duration')
    if source.get('duration') is not None and clip is not None:
        try:
            if abs(float(source['duration']) - float(clip)) > 1e-3:
                return False
        except (TypeError, ValueError):
            return False
    return True


def _latest_draft(session, lesson_id, draft_id):
    statement = select(MusicDraft).where(MusicDraft.lesson_id == lesson_id).order_by(
        MusicDraft.created_at.desc(), MusicDraft.id.desc())
    newest = session.scalar(statement)
    if not newest:
        raise HTTPException(404, 'No draft reference is available.')
    if draft_id and newest.id != draft_id:
        raise HTTPException(409, 'A newer draft is available. Reopen the review.')
    return newest


def _decisions(session, draft_id):
    return list(session.scalars(select(MusicVerificationDecision).where(
        MusicVerificationDecision.draft_id == draft_id)).all())


def state(draft, report, digest, report_error, rows):
    current = proposal_sha256(draft.document.get('events') or [])
    report_hash = (report.get('source') or {}).get('proposal_sha256') if report else None
    stale = bool(report and current != report_hash)
    events, conflicts, invalid = working_events(draft, rows)
    decisions_view = []
    for row in rows:
        decisions_view.append({'finding_id': row.finding_id, 'decision': row.decision,
                               'decided_at': row.decided_at.isoformat() if row.decided_at else None,
                               'report_sha256': (row.document or {}).get('report_sha256'),
                               'correction_status': (row.document or {}).get('correction_status'),
                               'correction_policy_sha256': (row.document or {}).get('correction_policy_sha256'),
                               'edits': _decision_edits(row), 'finding': _decision_finding(row)})
    decisions_view.sort(key=lambda item: item['finding_id'])
    automatic = [dict(item) for item in (draft.correction_history or [])
                 if not item.get('reverted_at')]
    return {'schema_version': 1, 'available': report is not None,
            'draft_id': draft.id, 'lesson_id': draft.lesson_id,
            'proposal_sha256': current, 'report_proposal_sha256': report_hash,
            'report_sha256': digest, 'stale': stale,
            'report_error': report_error, 'invalid_working': invalid,
            'working_corrected': bool(draft.working_document),
            'automatic_corrections': automatic,
            'decisions': decisions_view, 'events': events, 'conflicts': conflicts,
            'state_token': decisions_token(draft, rows),
            'report': report}


def install_music_verification(app, settings, identity, db):
    router = APIRouter(prefix='/api/lessons')

    @router.get('/{lesson_id}/music-analysis/verification')
    def verification(lesson_id: str, draft_id: str | None = None,
                     account=Depends(identity), session: Session = Depends(db)):
        """Owner report, decisions and working proposal. Missing evidence is not a 404 for accepted work."""
        owned_lesson(session, lesson_id, account.id)
        draft = _latest_draft(session, lesson_id, draft_id)
        if draft.owner_id != account.id or draft.subject != 'piano':
            raise HTTPException(404, 'Verification is unavailable for this draft.')
        if draft.status != 'draft':
            raise HTTPException(409, 'This draft has already been reviewed.')
        rows = _decisions(session, draft.id)
        report, digest, reason = _load_report(settings, lesson_id, draft.id)
        if report is not None and not report_identity_matches(draft, report):
            report, digest, reason = None, None, 'identity-mismatch'
        return state(draft, report, digest, reason, rows)

    @router.post('/{lesson_id}/music-draft/corrections/rollback')
    def rollback_corrections(lesson_id: str, body: RollbackInput,
                             account=Depends(identity), session: Session = Depends(db)):
        """Restore the exact displayed draft while retaining the automatic history."""
        owned_lesson(session, lesson_id, account.id)
        draft = session.scalar(select(MusicDraft).where(
            MusicDraft.id == body.draft_id, MusicDraft.lesson_id == lesson_id,
            MusicDraft.owner_id == account.id).with_for_update())
        if not draft or draft.subject != 'piano':
            raise HTTPException(404, 'Corrections are unavailable for this draft.')
        newest = _latest_draft(session, lesson_id, None)
        if newest.id != draft.id:
            raise HTTPException(409, 'A newer draft is available. Reopen the review.')
        if draft.status != 'draft':
            raise HTTPException(409, 'This draft is no longer open for review.')
        decisions = _decisions(session, draft.id)
        if decisions:
            raise HTTPException(409, 'Undo verification decisions before restoring the original draft.')
        if current_state_token(draft, decisions) != body.base_state_token:
            raise HTTPException(409, 'The working notes changed. Reopen the draft before restoring.')
        if not draft.working_document:
            raise HTTPException(409, 'This draft has no applied automatic corrections.')
        draft.working_document = None
        history = [dict(item) for item in (draft.correction_history or [])]
        for item in history:
            if not item.get('reverted_at'):
                item['reverted_at'] = now().isoformat()
        draft.correction_history = history
        session.commit()
        return {'rolled_back': True, 'draft_id': draft.id,
                'state_token': current_state_token(draft, []),
                'correction_history': history}

    @router.post('/{lesson_id}/music-draft/verification-decision')
    def decide(lesson_id: str, body: DecisionInput,
               account=Depends(identity), session: Session = Depends(db)):
        """Accept, reject or undo one finding under the current working-state token."""
        owned_lesson(session, lesson_id, account.id)
        draft = session.scalar(select(MusicDraft).where(
            MusicDraft.id == body.draft_id, MusicDraft.lesson_id == lesson_id,
            MusicDraft.owner_id == account.id).with_for_update())
        if not draft:
            raise HTTPException(404, 'Draft unavailable.')
        newest = _latest_draft(session, lesson_id, draft.id)
        if newest.id != draft.id or draft.status != 'draft':
            raise HTTPException(409, 'This draft is no longer open for review.')
        if draft.subject != 'piano':
            raise HTTPException(404, 'Verification is unavailable for this draft.')
        limit_error = interactive_limit.write_error(
            len(draft.document.get('events') or []), interactive_limit.INTERACTIVE_LIMIT_APPROVED)
        if limit_error:
            raise HTTPException(422, limit_error)
        current = proposal_sha256(draft.document.get('events') or [])
        if current != body.base_proposal_sha256:
            raise HTTPException(409, 'The proposal changed after this report was generated. Reopen verification.')

        rows = {row.finding_id: row for row in _decisions(session, draft.id)}
        report, digest, reason = _load_report(settings, lesson_id, draft.id)
        if report is not None and not report_identity_matches(draft, report):
            report, digest, reason = None, None, 'identity-mismatch'
        if decisions_token(draft, list(rows.values())) != body.base_state_token:
            raise HTTPException(409, 'Verification decisions changed in another tab. Reopen verification.')
        finding = None
        if body.decision != 'cleared':
            if report is None:
                raise HTTPException(409, 'Verification evidence is unavailable. Accepted changes can still be undone.')
            if digest is None or body.base_report_sha256 != digest:
                raise HTTPException(409, 'The verification report changed. Reopen verification before deciding.')
            if current != (report.get('source') or {}).get('proposal_sha256'):
                raise HTTPException(409, 'The proposal changed after this report was generated. Reopen verification.')
            finding = next((item for item in report['findings'] if item['id'] == body.finding_id), None)
            if finding is None:
                raise HTTPException(404, 'This finding is no longer part of the report.')
            if any(item.get('finding_id') == body.finding_id and not item.get('reverted_at')
                   for item in (draft.correction_history or [])):
                raise HTTPException(422, 'This correction was already applied automatically. Restore the original notes to undo it.')
            if body.decision == 'accepted':
                if finding.get('status') != 'suggested' or finding.get('correction_status') == 'withheld':
                    raise HTTPException(422, 'This finding has no qualified correction to accept.')
                if report.get('mode') == 'qualified' and finding.get('correction_status') != 'qualified':
                    raise HTTPException(422, 'This finding is not a qualified correction.')
                if not finding.get('proposed_edits'):
                    raise HTTPException(422, 'This finding has no supported correction to accept.')

        if body.decision == 'cleared':
            if body.finding_id in rows:
                session.delete(rows.pop(body.finding_id))
        else:
            row = rows.get(body.finding_id)
            if row is None:
                row = MusicVerificationDecision(id=uuid4().hex, draft_id=draft.id, lesson_id=lesson_id,
                                                finding_id=body.finding_id, reviewer_id=account.id,
                                                decided_at=now(), proposal_sha256=current, document={})
                session.add(row)
                rows[body.finding_id] = row
            row.decision = body.decision
            row.reviewer_id = account.id
            row.decided_at = now()
            row.proposal_sha256 = current
            row.document = {'kind': finding['kind'], 'pitch': finding.get('pitch'),
                            'time_range': finding['time_range'],
                            'explanation': finding.get('explanation', ''),
                            'finding': {'kind': finding['kind'], 'status': finding.get('status'),
                                        'pitch': finding.get('pitch'),
                                        'time_range': finding['time_range'],
                                        'explanation': finding.get('explanation', '')},
                            'edits': finding.get('proposed_edits', []),
                            'report_sha256': digest,
                            'correction_status': finding.get('correction_status'),
                            'correction_policy_sha256': (report.get('correction_policy') or {}).get('policy_sha256'),
                            'audio_sha256': (report.get('source') or {}).get('audio_sha256')}

        if body.decision == 'accepted':
            events, conflicts, invalid = working_events(draft, list(rows.values()))
            if invalid:
                session.rollback()
                raise HTTPException(422, 'The resulting notes do not form a valid proposal inside this clip.')
            if conflicts:
                session.rollback()
                raise HTTPException(409, 'This suggestion conflicts with another accepted change. Undo it first.')
            try:
                validate_events(draft, events)
            except ValueError as exc:
                session.rollback()
                raise HTTPException(422, str(exc)) from exc
        session.commit()
        return state(draft, report, digest, reason, _decisions(session, draft.id))

    app.include_router(router)
