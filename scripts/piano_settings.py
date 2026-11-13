"""Pure verifier defaults and merge helper, importable without audio dependencies."""
DEFAULT_SETTINGS = {
    'analysis': {
        'low_split_hz': 700.0,
        'low_fft': 8192,
        'full_fft': 2048,
        'hop': 256,
        'min_bin_hz': 25.0,
        'max_bin_hz': 6000.0,
        'noise_percentile': 15,
        'attack_fft': 1024,
        'attack_hop': 128,
        'attack_min_hz': 900.0,
        'attack_max_hz': 8000.0,
    },
    'tuning': {'max_cents': 40.0, 'min_partial_hz': 80.0, 'max_partial_hz': 2500.0},
    'templates': {
        'max_partials': 24,
        'inharmonicity': 0.0004,
        'attack_tilt': 0.72,
        'sustain_tilt': 1.05,
        'attack_rolloff_hz': 6500.0,
        'sustain_rolloff_hz': 3200.0,
        'velocity_tilt': 0.35,
        'sustain_decay_scale': 1.0,
    },
    'decomposition': {
        'attack_tau_s': 0.030,
        'sustain_attack_s': 0.012,
        'ridge': 1e-9,
        'sweeps': 90,
        'context_before_s': 2.0,
        'envelope_smear_frames': 8,
        'max_atoms': 160,
        'max_frames': 720,
    },
    'regions': {
        'cluster_gap_s': 0.35,
        'before_s': 0.45,
        'after_s': 1.10,
        'max_regions': 80,
        'max_region_seconds': 8.0,
        'max_region_notes': 80,
        'max_window_notes': 240,
    },
    'checks': {
        'attack_tolerance_s': 0.060,
        'unmatched_attack_min_novelty': 0.22,
        'onset_step_s': 0.020,
        'onset_min_shift_s': 0.060,
        'onset_min_attack': 0.50,
        'attack_lag_s': 0.045,
        'repetition_min_gap_s': 0.120,
        'repetition_end_margin_s': 0.050,
        'repetition_min_novelty': 0.90,
        'repetition_min_broadband': 0.55,
        'duplicate_gap_s': 0.160,
        'duplicate_second_attack': 0.35,
        'duplicate_attack_ratio': 0.50,
        'missing_unexplained': 0.35,
        'missing_fundamental': 0.35,
        'missing_min_snr_db': 3.0,
        'candidate_limit': 4,
    },
    'scoring': {
        'add_gain': 0.55,
        'shift_gain': 0.30,
        'repetition_min_gain': 0.15,
        'substitute_gain': 0.45,
        'delete_max_gain': 0.18,
        'merge_max_gain': 1.50,
        'margin': 0.12,
    },
    'insertion': {
        'min_gain': 1.00,
        'min_fundamental': 0.50,
        'min_attack_sharp': 2.00,
        'min_attack': 0.20,
        'min_decoder_onset': 0.65,
        'competing_ratio': 0.75,
    },
    'limits': {'max_findings': 400, 'budget_seconds': 100.0, 'max_events': 20000,
               'max_audio_seconds': 600.0, 'max_region_matrix': 2000000},
}


def merge_settings(base, override):
    result = {key: (dict(value) if isinstance(value, dict) else value)
              for key, value in base.items()}
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = merge_settings(result[key], value)
        else:
            result[key] = value
    return result
