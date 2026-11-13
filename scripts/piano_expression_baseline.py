"""Frozen pre-plan expression estimators used only to reproduce the old audit."""
import numpy as np

try:
    import piano_verifier as verifier
except ImportError:
    from scripts import piano_verifier as verifier


def _activity(analysis, pitch, seconds):
    frame = verifier._frame_index(analysis, float(seconds))
    index = int(np.clip(int(pitch) - verifier.MIDI_MIN, 0, verifier.MIDI_MAX - verifier.MIDI_MIN))
    signal = sum(float(analysis.Y[frame, indices] @ weights) ** 2
                 for _k, _f, indices, weights in analysis.partials[index])
    floor = sum(float(analysis.noise[indices] @ weights) ** 2
                for _k, _f, indices, weights in analysis.partials[index])
    return float(10.0 * np.log10((signal + 1e-12) / (floor + 1e-12)))


def estimate_duration(analysis, note, clip, events):
    onset = float(note['onset'])
    existing = float(note.get('duration') or 0.0)
    max_end = min(clip - 0.05, onset + min(8.0, max(2.0, existing * 2.0 + 1.0)))
    later = [float(other['onset']) for other in events
             if int(other['pitch']) == int(note['pitch'])
             and float(other['onset']) > onset + 0.05]
    if later:
        max_end = min(max_end, min(later) - 0.04)
    if max_end <= onset + 0.08:
        return None
    start = _activity(analysis, note['pitch'], onset)
    if start < 6.0:
        return None
    peak = max(_activity(analysis, note['pitch'], onset + value)
               for value in np.arange(0.0, 0.12, 0.02))
    threshold = max(6.0, peak - 20.0)
    last_above = None
    below_start = None
    observed_release = False
    for value in np.arange(onset + 0.06, max_end + 1e-6, 0.04):
        if _activity(analysis, note['pitch'], float(value)) >= threshold:
            last_above = float(value)
            below_start = None
        else:
            if last_above is not None and below_start is None:
                below_start = float(value)
            if below_start is not None and float(value) - below_start >= 0.15:
                observed_release = True
                break
    if not observed_release or last_above is None:
        return None
    end = last_above + 0.04
    if end >= clip - 0.03:
        return None
    duration = round(end - onset, 3)
    if duration < 0.08 or abs(duration - existing) < 0.06:
        return None
    return duration


def estimate_dynamics(analysis, events):
    isolated = []
    for note in events:
        onset = float(note['onset'])
        end = onset + float(note.get('duration') or 0.0)
        overlaps = [other for other in events if other is not note
                    and float(other['onset']) < end + 0.05
                    and float(other['onset']) + float(other.get('duration') or 0.0) > onset - 0.05]
        if overlaps:
            continue
        db = _activity(analysis, note['pitch'], onset)
        if db >= 6.0:
            isolated.append((note, db))
    if len(isolated) < 2:
        return {}
    levels = sorted(db for _note, db in isolated)
    median = levels[len(levels) // 2]
    proposals = {}
    for note, db in isolated:
        delta = db - median
        if abs(delta) < 3.0:
            continue
        existing = note.get('velocity')
        base = 0.5 if existing is None else float(existing)
        value = round(min(1.0, max(0.05, base * (10.0 ** (delta / 20.0)))), 3)
        if abs(value - base) >= 0.08:
            proposals[str(note['id'])] = (value, round(db, 2), round(delta, 2))
    return proposals
