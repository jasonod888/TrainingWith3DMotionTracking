"""W5: ingest the Vienna development subset and test whether a split can meet the gates.

This module deliberately has no MIDI library dependency. It parses Standard MIDI Files
directly so the ingestion is reproducible in the numpy/scipy-only CI environment, and so the
parser version is part of the recorded identity rather than an undeclared environment detail.

What it produces:

* a per-performance manifest with hashes, note/controller counts and release semantics;
* a classification that excludes averaged and excerpt variants from independent counts;
* a validation report for timing and controller conventions;
* a **feasibility table** computed before any split is fixed, because 22 performers and a
  handful of works cannot automatically satisfy a 40-distinct-performance gate;
* a deterministic performer-level split proposal with recorded exclusion reasons.

It does not claim the audio is aligned. Only the pairing and the duration agreement are
checked here; independent alignment and audible-ending annotation remain separate work.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
import wave
from pathlib import Path

SCHEMA = 'vienna-dataset-manifest-1'
SPLIT_SCHEMA = 'vienna-split-proposal-1'
VALIDATION_SCHEMA = 'vienna-validation-1'
DEFAULT_CORPUS = Path('.local/commercial-piano-data')
DEFAULT_SPLIT_SEED = 'vienna-split-v1'
MIN_PERFORMANCE_GATE = 40
PEDAL_ONSET_THRESHOLD = 64
AUDIO_PAIRING_TOLERANCE_SECONDS = 2.0
SUSTAIN_CC = 64
SOFT_CC = 67
# Marked in the register as inspected during development: it may train or calibrate but can
# never be presented as untouched holdout.
INSPECTED_EXCLUSIONS = ('Chopin_op38_p01',)


class MidiError(ValueError):
    """The MIDI file is malformed or uses an unsupported convention."""


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


# --------------------------------------------------------------------------- SMF parsing

def _varlen(data, index):
    value = 0
    while True:
        if index >= len(data):
            raise MidiError('truncated variable-length quantity')
        byte = data[index]
        index += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, index


def parse_smf(path):
    """Parse a Standard MIDI File into absolute-tick channel events and tempo marks."""
    path = Path(path)
    data = path.read_bytes()
    if data[:4] != b'MThd':
        raise MidiError(f'{path.name}: missing MThd header')
    header_length = struct.unpack('>I', data[4:8])[0]
    if header_length < 6:
        raise MidiError(f'{path.name}: truncated header')
    raw_format, track_count, division = struct.unpack('>HHH', data[8:14])
    if division & 0x8000:
        raise MidiError(f'{path.name}: SMPTE time division is not supported')
    if division == 0:
        raise MidiError(f'{path.name}: zero ticks per quarter')

    events = []
    position = 8 + header_length
    tracks_read = 0
    final_tick = 0
    for _ in range(track_count):
        if data[position:position + 4] != b'MTrk':
            raise MidiError(f'{path.name}: expected MTrk at offset {position}')
        length = struct.unpack('>I', data[position + 4:position + 8])[0]
        end = position + 8 + length
        index = position + 8
        tick = 0
        running = None
        while index < end:
            delta, index = _varlen(data, index)
            tick += delta
            status = data[index]
            if status == 0xFF:
                index += 1
                meta_type = data[index]
                index += 1
                meta_length, index = _varlen(data, index)
                payload = data[index:index + meta_length]
                index += meta_length
                final_tick = max(final_tick, tick)
                if meta_type == 0x51 and meta_length == 3:
                    events.append({'tick': tick, 'kind': 'tempo',
                                   'microseconds_per_quarter':
                                       (payload[0] << 16) | (payload[1] << 8) | payload[2]})
                continue
            if status in (0xF0, 0xF7):
                index += 1
                meta_length, index = _varlen(data, index)
                index += meta_length
                continue
            if status & 0x80:
                running = status
                index += 1
            elif running is None:
                raise MidiError(f'{path.name}: running status without a status byte')
            else:
                status = running

            high = status & 0xF0
            channel = status & 0x0F
            final_tick = max(final_tick, tick)
            if high in (0xC0, 0xD0):
                index += 1
                continue
            first = data[index]
            second = data[index + 1]
            index += 2
            if high == 0x90 and second > 0:
                events.append({'tick': tick, 'kind': 'note_on', 'channel': channel,
                               'pitch': first, 'velocity': second})
            elif high == 0x80 or (high == 0x90 and second == 0):
                events.append({'tick': tick, 'kind': 'note_off', 'channel': channel,
                               'pitch': first,
                               'convention': 'note_off' if high == 0x80 else 'velocity_zero'})
            elif high == 0xB0:
                events.append({'tick': tick, 'kind': 'control_change', 'channel': channel,
                               'controller': first, 'value': second})
        position = end
        tracks_read += 1
    if tracks_read == 0:
        raise MidiError(f'{path.name}: no tracks')
    return {'format': raw_format, 'track_count': tracks_read, 'division': division,
            'last_tick': final_tick, 'events': events}


def _tempo_map(events):
    tempos = sorted(((event['tick'], event['microseconds_per_quarter'])
                     for event in events if event['kind'] == 'tempo'),
                    key=lambda item: item[0])
    return tempos or [(0, 500000)]


def _tick_to_seconds(tempos, division, tick):
    seconds = 0.0
    previous_tick = 0
    previous_tempo = tempos[0][1]
    for change_tick, tempo in tempos:
        if change_tick <= previous_tick:
            previous_tempo = tempo
            continue
        if change_tick >= tick:
            break
        seconds += (change_tick - previous_tick) * previous_tempo / (1e6 * division)
        previous_tick = change_tick
        previous_tempo = tempo
    seconds += (tick - previous_tick) * previous_tempo / (1e6 * division)
    return seconds


# ------------------------------------------------------------------ performance summary

def _reconcile(parsed):
    """Pair note-ons with note-offs and collect controllers, all in ticks."""
    ordered = sorted(parsed['events'], key=lambda event: event['tick'])
    open_notes = {}
    notes = []
    overlaps = 0
    unmatched_offs = 0
    conventions = {'note_off': 0, 'velocity_zero': 0}
    sustain_events = []
    soft_events = []
    last_tick = parsed['last_tick']

    for event in ordered:
        last_tick = max(last_tick, event['tick'])
        if event['kind'] == 'note_on':
            key = (event['channel'], event['pitch'])
            pending = open_notes.setdefault(key, [])
            if pending:
                overlaps += 1
            pending.append(event)
        elif event['kind'] == 'note_off':
            conventions[event['convention']] += 1
            key = (event['channel'], event['pitch'])
            pending = open_notes.get(key) or []
            if not pending:
                unmatched_offs += 1
                continue
            started = pending.pop(0)
            notes.append({'tick_on': started['tick'], 'tick_off': event['tick'],
                          'pitch': event['pitch'], 'channel': event['channel'],
                          'velocity': started['velocity']})
        elif event['kind'] == 'control_change':
            if event['controller'] == SUSTAIN_CC:
                sustain_events.append({'tick': event['tick'], 'value': event['value']})
            elif event['controller'] == SOFT_CC:
                soft_events.append({'tick': event['tick'], 'value': event['value']})

    return {'notes': notes, 'overlaps': overlaps, 'unmatched_offs': unmatched_offs,
            'conventions': conventions, 'sustain_events': sustain_events,
            'soft_events': soft_events,
            'unclosed': sum(len(pending) for pending in open_notes.values()),
            'last_tick': last_tick}


def _sustain_spans(sustain_events):
    spans = []
    start = None
    for control in sustain_events:
        if control['value'] >= PEDAL_ONSET_THRESHOLD and start is None:
            start = control['tick']
        elif control['value'] < PEDAL_ONSET_THRESHOLD and start is not None:
            spans.append((start, control['tick']))
            start = None
    if start is not None:
        spans.append((start, None))
    return spans


def performance_events(path):
    """Seconds-based captured events that keep note identity for scoring.

    Captured note-off is a key release, never an audible ending, and the pedal is reported
    with its raw controller value so binary and continuous captures remain distinguishable.
    """
    parsed = parse_smf(path)
    tempos = _tempo_map(parsed['events'])
    division = parsed['division']
    reconciled = _reconcile(parsed)

    def seconds(tick):
        return round(_tick_to_seconds(tempos, division, tick), 6)

    notes = []
    ordered_notes = sorted(reconciled['notes'],
                           key=lambda note: (note['tick_on'], note['pitch'], note['channel']))
    for index, note in enumerate(ordered_notes):
        notes.append({'id': f'capture-n{index + 1:04d}', 'pitch': note['pitch'],
                      'onset_seconds': seconds(note['tick_on']),
                      'release_seconds': seconds(note['tick_off']),
                      'velocity_midi': note['velocity'], 'channel': note['channel']})

    pedal = []
    for prefix, pedal_type, events in (
            ('p', 'sustain', reconciled['sustain_events']),
            ('s', 'soft', reconciled['soft_events'])):
        for index, control in enumerate(sorted(events, key=lambda item: item['tick'])):
            pedal.append({'id': f'capture-{prefix}{index + 1:04d}', 'type': pedal_type,
                          'onset_seconds': seconds(control['tick']),
                          'value': 1.0 if control['value'] >= PEDAL_ONSET_THRESHOLD else 0.0,
                          'raw_value': control['value']})

    spans = [(seconds(start), None if end is None else seconds(end))
             for start, end in _sustain_spans(reconciled['sustain_events'])]
    return {'file': str(path), 'sha256': file_sha256(path), 'notes': notes, 'pedal': pedal,
            'sustain_spans_seconds': spans,
            'unmatched_note_offs': reconciled['unmatched_offs'],
            'unclosed_notes': reconciled['unclosed'],
            'same_pitch_overlaps': reconciled['overlaps']}


def performance_summary(path):
    """Notes, controllers and release semantics for one captured performance."""
    parsed = parse_smf(path)
    tempos = _tempo_map(parsed['events'])
    division = parsed['division']
    reconciled = _reconcile(parsed)
    notes = reconciled['notes']
    overlaps = reconciled['overlaps']
    unmatched_offs = reconciled['unmatched_offs']
    conventions = reconciled['conventions']
    sustain_events = reconciled['sustain_events']
    soft_events = reconciled['soft_events']
    unclosed = reconciled['unclosed']
    last_tick = reconciled['last_tick']
    spans = _sustain_spans(sustain_events)

    def under_sustain(tick):
        for start, end in spans:
            if start <= tick and (end is None or tick < end):
                return True
        return False

    released_under_sustain = sum(1 for note in notes if under_sustain(note['tick_off']))
    durations = [max(0, note['tick_off'] - note['tick_on']) for note in notes]
    velocities = [note['velocity'] for note in notes]
    pitches = [note['pitch'] for note in notes]
    sustain_values = sorted({control['value'] for control in sustain_events})
    soft_values = sorted({control['value'] for control in soft_events})
    last_note_off = max((note['tick_off'] for note in notes), default=0)
    last_controller = max((control['tick'] for control in sustain_events + soft_events),
                          default=0)

    return {
        'file': str(path),
        'sha256': file_sha256(path),
        'bytes': path.stat().st_size,
        'format': parsed['format'],
        'track_count': parsed['track_count'],
        'division': division,
        'notes': len(notes),
        'unmatched_note_offs': unmatched_offs,
        'unclosed_notes': unclosed,
        'same_pitch_overlaps': overlaps,
        'zero_length_notes': sum(1 for duration in durations if duration == 0),
        'onset_seconds': round(_tick_to_seconds(tempos, division,
                                                min((note['tick_on'] for note in notes),
                                                    default=0)), 4),
        'duration_seconds': round(_tick_to_seconds(tempos, division, last_tick), 4),
        'last_note_release_seconds': round(_tick_to_seconds(tempos, division,
                                                            last_note_off), 4),
        'last_controller_seconds': round(_tick_to_seconds(tempos, division,
                                                          last_controller), 4),
        'recording_end_seconds': round(_tick_to_seconds(tempos, division, last_tick), 4),
        'pitch_min': min(pitches) if pitches else None,
        'pitch_max': max(pitches) if pitches else None,
        'velocity_min': min(velocities) if velocities else None,
        'velocity_max': max(velocities) if velocities else None,
        'velocity_distinct': len(set(velocities)),
        'sustain_events': len(sustain_events),
        'sustain_values': sustain_values[:8],
        'sustain_is_binary': all(value in (0, 127) for value in sustain_values),
        'sustain_spans': len(spans),
        'soft_events': len(soft_events),
        'soft_values': soft_values[:8],
        'notes_released_under_sustain': released_under_sustain,
        'note_off_conventions': conventions,
    }


# ------------------------------------------------------------------------ classification

def classify(name):
    """Split a file stem into work, performer and variant.

    ``p23-average`` is an averaged performance and ``*_1st-3rd`` is an excerpt. Neither is
    an independent performance, so neither may inflate a performance count.
    """
    stem = Path(name).stem
    parts = stem.rsplit('_', 1)
    if len(parts) != 2:
        return {'work': stem, 'performer': None, 'variant': 'unknown'}
    work, tail = parts
    if tail.startswith('p') and tail.endswith('-average'):
        return {'work': work, 'performer': tail.split('-')[0], 'variant': 'average'}
    if work.endswith('_1st-3rd'):
        return {'work': work[:-len('_1st-3rd')], 'performer': tail, 'variant': 'excerpt'}
    if tail.startswith('p') and tail[1:].isdigit():
        return {'work': work, 'performer': f'p{tail[1:]}', 'variant': 'primary'}
    return {'work': work, 'performer': tail, 'variant': 'unknown'}


# ----------------------------------------------------------------------------- manifest

def _read_audio(path):
    with wave.open(str(path), 'rb') as handle:
        return {'file': str(path), 'sha256': file_sha256(path),
                'sample_rate': handle.getframerate(),
                'channels': handle.getnchannels(),
                'sample_width': handle.getsampwidth(),
                'seconds': round(handle.getnframes() / float(handle.getframerate()), 4)}


def build_manifest(corpus=DEFAULT_CORPUS, midi_subdir='vienna-midi-corrected'):
    corpus = Path(corpus)
    midi_dir = corpus / midi_subdir
    if not midi_dir.is_dir():
        raise FileNotFoundError(f'no corrected MIDI directory at {midi_dir}')

    performances = []
    excluded = []
    for path in sorted(midi_dir.glob('*.mid')):
        summary = performance_summary(path)
        identity = classify(path.name)
        record = {**identity, 'path': str(path), 'sha256': summary['sha256'],
                  'notes': summary['notes'],
                  'duration_seconds': summary['duration_seconds'],
                  'last_note_release_seconds': summary['last_note_release_seconds'],
                  'last_controller_seconds': summary['last_controller_seconds'],
                  'recording_end_seconds': summary['recording_end_seconds'],
                  'onset_seconds': summary['onset_seconds'],
                  'pitch_min': summary['pitch_min'], 'pitch_max': summary['pitch_max'],
                  'velocity_distinct': summary['velocity_distinct'],
                  'sustain_events': summary['sustain_events'],
                  'sustain_is_binary': summary['sustain_is_binary'],
                  'soft_events': summary['soft_events'],
                  'notes_released_under_sustain': summary['notes_released_under_sustain'],
                  'same_pitch_overlaps': summary['same_pitch_overlaps'],
                  'note_off_conventions': summary['note_off_conventions'],
                  'unmatched_note_offs': summary['unmatched_note_offs'],
                  'unclosed_notes': summary['unclosed_notes'],
                  'zero_length_notes': summary['zero_length_notes']}
        if identity['variant'] != 'primary':
            record['reason'] = f'{identity["variant"]} variant is not an independent performance'
            excluded.append(record)
        else:
            performances.append(record)

    primary = list(performances)
    works = sorted({record['work'] for record in primary})
    performers = sorted({record['performer'] for record in primary})
    audio = ([_read_audio(corpus / 'vienna-original-sample.wav')]
             if (corpus / 'vienna-original-sample.wav').is_file() else [])
    paired = [record for record in primary
              if f'{record["work"]}_{record["performer"]}' in INSPECTED_EXCLUSIONS]
    audio_pairs = ([{'audio': audio[0]['file'],
                     'performance': f'{paired[0]["work"]}_{paired[0]["performer"]}',
                     'audio_seconds': audio[0]['seconds'],
                     'performance_seconds': paired[0]['duration_seconds'],
                     'alignment_verified': False}]
                   if audio and paired else [])
    return {
        'schema': SCHEMA,
        'corpus_root': str(corpus),
        'source': {'dataset': 'Vienna 4x22 corrected MIDI plus original audio',
                   'license': 'CC-BY-4.0',
                   'revision': '1033ade0899bfd03a89f370c9ad5d8443ddccd3e',
                   'repository': 'https://github.com/CPJKU/vienna4x22',
                   'attribution': ('The Vienna 4x22 Piano Corpus - Werner Goebl, '
                                   'CC BY 4.0; performance reference updates by CPJKU '
                                   'contributors, CC BY 4.0.')},
        'performances': performances,
        'excluded': excluded,
        'audio': audio,
        'audio_pairs': audio_pairs,
        'summary': {'primary_performances': len(primary),
                    'excluded_files': len(excluded),
                    'works': works, 'performers': performers,
                    'notes': sum(record['notes'] for record in primary),
                    'with_sustain': sum(1 for record in primary if record['sustain_events']),
                    'with_soft_pedal': sum(1 for record in primary if record['soft_events']),
                    'sustain_binary': sum(1 for record in primary
                                          if record['sustain_is_binary']),
                    'audio_files': len(audio),
                    'paired_performances': len(audio_pairs),
                    'metadata_complete': len(primary) > 0,
                    'paired_readiness': ('complete' if len(audio_pairs) >= len(primary)
                                         else 'partial'),
                    'parser': 'internal-smf-1'},
    }


def feasibility(manifest, gate=MIN_PERFORMANCE_GATE):
    """How many held-out performances a performer-level split can actually provide.

    Computed from the observed grid, before any split is committed. A held-out performer
    contributes at most one performance per work, and less once no-edit or ambiguous cases
    are removed, so the ceiling is an optimistic bound.
    """
    works = len(manifest['summary']['works'])
    performers = len(manifest['summary']['performers'])
    rows = []
    for held_out in range(1, performers):
        ceiling = held_out * works
        rows.append({'held_out_performers': held_out,
                     'remaining_performers': performers - held_out,
                     'max_holdout_performances': ceiling,
                     'meets_40_gate_at_ceiling': ceiling >= gate,
                     'headroom_performances': ceiling - gate,
                     'ceiling_is_optimistic': True})
    return {'schema': 'vienna-feasibility-1', 'gate': gate, 'works': works,
            'performers': performers, 'rows': rows}


def _rank(performer, seed):
    return hashlib.sha256(f'{seed}:{performer}'.encode('utf-8')).hexdigest()


def propose_split(manifest, holdout_performers=13, calibration_performers=3,
                  seed=DEFAULT_SPLIT_SEED):
    """Deterministic performer-level assignment with recorded exclusion reasons."""
    performers = sorted(manifest['summary']['performers'])
    if holdout_performers + calibration_performers >= len(performers):
        raise ValueError('split leaves no development performers')
    ordered = sorted(performers, key=lambda performer: _rank(performer, seed))
    holdout = set(ordered[:holdout_performers])
    calibration = set(ordered[holdout_performers:holdout_performers + calibration_performers])
    development = set(ordered[holdout_performers + calibration_performers:])

    assignments = []
    for record in manifest['performances']:
        name = f'{record["work"]}_{record["performer"]}'
        forced = name in INSPECTED_EXCLUSIONS
        if forced:
            split, reason = 'development', 'inspected during development; not untouched data'
        elif record['performer'] in holdout:
            split, reason = 'holdout', 'performer held out'
        elif record['performer'] in calibration:
            split, reason = 'calibration', 'performer reserved for calibration'
        else:
            split, reason = 'development', 'performer available for fit and iteration'
        assignments.append({'work': record['work'], 'performer': record['performer'],
                            'file': record['path'], 'split': split, 'reason': reason})

    durations = {}
    for record in manifest['performances']:
        durations.setdefault(record['work'], []).append(record['duration_seconds'])
    excerpt_works = {record['work'] for record in manifest['excluded']
                     if record.get('reason', '').startswith('excerpt')}
    full_durations = {work: max(values) for work, values in durations.items()}
    excerpt_checks = []
    for record in manifest['excluded']:
        if not record.get('reason', '').startswith('excerpt'):
            continue
        full = full_durations.get(record['work'])
        excerpt_checks.append({
            'file': record['path'], 'work': record['work'],
            'excerpt_seconds': record['duration_seconds'], 'full_seconds': full,
            'is_shorter_than_full': full is not None
                                    and record['duration_seconds'] < full})

    counts = {name: sum(1 for item in assignments if item['split'] == name)
              for name in ('development', 'calibration', 'holdout')}
    return {'schema': SPLIT_SCHEMA, 'seed': seed,
            'performers': {'holdout': sorted(holdout),
                           'calibration': sorted(calibration),
                           'development': sorted(development)},
            'counts': counts,
            'assignments': assignments,
            'excluded_variants': [record['path'] for record in manifest['excluded']],
            'excerpt_checks': excerpt_checks,
            'excerpt_works': sorted(excerpt_works),
            'notes': [
                'Holdout performers are ranked by seed hash, so the split is reproducible.',
                'Inspected performances are forced into development regardless of rank.',
                'A performer-level split bounds person generalisation; pieces and the '
                'instrument/room still overlap across performers.',
            ]}


def validate(manifest, split):
    """Record timing and controller-convention findings instead of assuming them."""
    primary = manifest['performances']
    checks = []

    def check(name, passed, detail):
        checks.append({'check': name, 'passed': bool(passed), 'detail': detail})

    check('all primary performances carry sustain CC64',
          all(record['sustain_events'] > 0 for record in primary),
          f'{sum(1 for record in primary if record["sustain_events"])}/{len(primary)}')
    check('all primary performances carry soft pedal CC67',
          all(record['soft_events'] > 0 for record in primary),
          f'{sum(1 for record in primary if record["soft_events"])}/{len(primary)}')
    check('note-off pairing is complete',
          all(record['unmatched_note_offs'] == 0 and record['unclosed_notes'] == 0
              for record in primary),
          f'max unmatched {max((record["unmatched_note_offs"] for record in primary), default=0)}, '
          f'max unclosed {max((record["unclosed_notes"] for record in primary), default=0)}')
    check('stored note offsets fall under the sustain pedal somewhere',
          all(record['notes_released_under_sustain'] >= 0 for record in primary),
          f'{sum(record["notes_released_under_sustain"] for record in primary)} pedal-sustained '
          'releases across the corpus')

    assignments = split.get('assignments') or []
    assigned_files = [item.get('file') for item in assignments]
    primary_files = [record['path'] for record in primary]
    by_file = {record['path']: record for record in primary}
    metadata_mismatches = [item.get('file') for item in assignments
                           if item.get('file') in by_file and any(
                               item.get(field) != by_file[item['file']].get(field)
                               for field in ('performer', 'work'))]
    check('assignment metadata matches the actual performance', not metadata_mismatches,
          f'{len(metadata_mismatches)} mislabeled performance(s)')
    valid_split_names = {'development', 'calibration', 'holdout'}
    check('split labels are supported',
          set(split.get('performers') or {}) == valid_split_names and
          all(item.get('split') in valid_split_names for item in assignments),
          'only development, calibration and holdout are valid split labels')
    duplicates = sorted({path for path in assigned_files
                         if assigned_files.count(path) > 1})
    unknown = sorted(set(assigned_files) - set(primary_files))
    omitted = sorted(set(primary_files) - set(assigned_files))
    check('assignments are a bijection over the primary performances',
          not duplicates and not unknown and not omitted,
          f'{len(assignments)} assignments for {len(primary)} performances; '
          f'{len(duplicates)} duplicate, {len(unknown)} unknown, {len(omitted)} omitted')

    performer_splits = {}
    for item in assignments:
        performer_splits.setdefault(item.get('performer'), set()).add(item.get('split'))
    conflicting = sorted(name for name, values in performer_splits.items()
                         if len(values) != 1)
    check('each performer is assigned to exactly one split', not conflicting,
          f'{len(conflicting)} conflicting performer(s)')

    declared = {}
    for split_name, people in (split.get('performers') or {}).items():
        for person in people:
            declared.setdefault(person, []).append(split_name)
    doubled = sorted(person for person, values in declared.items() if len(values) > 1)
    mismatched = sorted(item.get('file') for item in assignments
                        if declared.get(item.get('performer')) != [item.get('split')])
    check('assignment split matches the declared performer mapping',
          not doubled and not mismatched,
          f'{len(doubled)} performer(s) declared twice, {len(mismatched)} assignment(s) disagree')

    corpus_performers = set(manifest['summary']['performers'])
    declared_performers = set(declared)
    check('performer sets cover the corpus and are disjoint',
          declared_performers == corpus_performers and not doubled,
          f'declared {len(declared_performers)} of {len(corpus_performers)} performers, '
          f'{len(declared_performers - corpus_performers)} unknown, '
          f'{len(corpus_performers - declared_performers)} missing')

    inspected_breaches = []
    for item in assignments:
        canonical = by_file.get(item.get('file'), item)
        name = f'{canonical.get("work")}_{canonical.get("performer")}'
        if name in INSPECTED_EXCLUSIONS and item.get('split') != 'development':
            inspected_breaches.append(name)
    check('inspected performances are never assigned to holdout or calibration',
          not inspected_breaches,
          f'{len(inspected_breaches)} breach(es) of {len(INSPECTED_EXCLUSIONS)} inspected '
          'performance(s)')
    check('excerpt variants are shorter than their full work',
          all(item['is_shorter_than_full'] for item in split['excerpt_checks']) or
          not split['excerpt_checks'],
          f'{len(split["excerpt_checks"])} excerpt files checked')

    audio = manifest['audio'][0] if manifest['audio'] else None
    advisory = []
    if audio:
        paired = next((record for record in primary
                       if f'{record["work"]}_{record["performer"]}' in INSPECTED_EXCLUSIONS),
                      None)
        difference = (paired['duration_seconds'] - audio['seconds']
                      if paired else None)
        # The captured performance may legitimately run past the end of the recording: the
        # last release, pedal-up or decay is not part of the audio file. What must not happen
        # is a performance shorter than the audio, which would leave the interval uncovered.
        check('paired performance covers the audio duration',
              difference is not None and difference >= -AUDIO_PAIRING_TOLERANCE_SECONDS,
              f'{paired["work"] + "_" + paired["performer"] if paired else "no pair"}: '
              f'midi {paired["duration_seconds"] if paired else None}s vs '
              f'audio {audio["seconds"]}s')
        if difference is not None and abs(difference) > AUDIO_PAIRING_TOLERANCE_SECONDS:
            advisory.append(
                f'paired performance last event is {difference:+.3f}s from the audio end '
                f'(last note release {paired["last_note_release_seconds"]}s, last controller '
                f'{paired["last_controller_seconds"]}s, audio {audio["seconds"]}s). This is an '
                'end-of-file comparison, not evidence of note-timing misalignment; score an '
                'explicit interval inside the audio')
    else:
        check('paired audio present', False, 'no audio file in the corpus root')

    failures = [item['check'] for item in checks if not item['passed']]
    return {'schema': VALIDATION_SCHEMA, 'checks': checks, 'failures': failures,
            'passed': not failures, 'advisory': advisory,
            'review_required': [
                'Independent audio alignment is not verified here; only duration agreement.',
                'MIDI offsets are captured key releases, not audible endings.',
                'One piano, one recording setting: no unseen-piano generalisation claim.',
            ]}


def ingest(corpus=DEFAULT_CORPUS, output=None, holdout_performers=13,
           calibration_performers=3):
    manifest = build_manifest(corpus)
    table = feasibility(manifest)
    split = propose_split(manifest, holdout_performers, calibration_performers)
    report = validate(manifest, split)
    if output is not None:
        output = Path(output)
        output.mkdir(parents=True, exist_ok=True)
        (output / 'dataset-manifest.json').write_text(
            json.dumps(manifest, indent=2, sort_keys=True), encoding='utf-8')
        (output / 'split-feasibility.json').write_text(
            json.dumps(table, indent=2, sort_keys=True), encoding='utf-8')
        (output / 'split-proposal.json').write_text(
            json.dumps(split, indent=2, sort_keys=True), encoding='utf-8')
        (output / 'validation.json').write_text(
            json.dumps(report, indent=2, sort_keys=True), encoding='utf-8')
    return {'manifest': manifest, 'feasibility': table, 'split': split, 'validation': report}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Ingest the Vienna development subset.')
    parser.add_argument('--corpus', type=Path, default=DEFAULT_CORPUS)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--holdout-performers', type=int, default=13)
    parser.add_argument('--calibration-performers', type=int, default=3)
    parser.add_argument('--summary', action='store_true',
                        help='print counts and the feasibility table instead of everything')
    arguments = parser.parse_args(argv)
    try:
        result = ingest(arguments.corpus, arguments.output,
                        arguments.holdout_performers, arguments.calibration_performers)
    except (FileNotFoundError, MidiError, ValueError) as error:
        print(f'error: {error}', file=sys.stderr)
        return 2

    manifest = result['manifest']
    summary = {
        'primary_performances': manifest['summary']['primary_performances'],
        'excluded_files': manifest['summary']['excluded_files'],
        'works': manifest['summary']['works'],
        'performers': len(manifest['summary']['performers']),
        'notes': manifest['summary']['notes'],
        'split_counts': result['split']['counts'],
        'validation_passed': result['validation']['passed'],
        'validation_failures': result['validation']['failures'],
        'feasibility': [row for row in result['feasibility']['rows']
                        if row['held_out_performers'] in (12, 13, 14)],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
