from pathlib import Path
p = Path('scripts/music_kong_adapter.py')
t = p.read_text(encoding='utf-8')
t = t.replace("    if not events:\n        raise ValueError('Kong produced no notes inside the clip.')",
"""    if not events:
        raise ValueError('Kong produced no notes inside the clip.')
    pedal = []
    for span in result.get('est_pedal_events') or []:
        start = max(0.0, float(span['onset_time']))
        end = min(duration, float(span['offset_time']))
        if end > start:
            pedal.append({'onset': round(start, 6), 'offset': round(end, 6),
                          'type': 'sustain'})""")
t = t.replace("             'guitar_chords': [], 'provenance': provenance,",
"             'guitar_chords': [], 'provenance': provenance, 'pedal': pedal,")
t = t.replace("                          'Pedal predictions are not represented in this lesson revision.']}",
"                          'Sustain pedal spans are model estimates, not captured controller truth.']}")
t = t.replace("    sidecar = {'schema': 'piano-model-native-1', 'variant': 'kong-draft',",
"""    for index, span in enumerate(draft.get('pedal') or []):
        performance.add_pedal(document, pedal_id=f'pedal-{index}-on', pedal_type='sustain',
                              onset_seconds=span['onset'], value=1.0,
                              provenance={'kind': 'model_estimated', 'model': 'kong'})
        performance.add_pedal(document, pedal_id=f'pedal-{index}-off', pedal_type='sustain',
                              onset_seconds=span['offset'], value=0.0,
                              provenance={'kind': 'model_estimated', 'model': 'kong'})
    sidecar = {'schema': 'piano-model-native-1', 'variant': 'kong-draft',""")
p.write_text(t, encoding='utf-8')
print('adapter patched')
