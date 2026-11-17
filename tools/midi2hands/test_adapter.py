#!/usr/bin/env python3
"""Fast no-network adapter tests. Run with PYTHONDONTWRITEBYTECODE=1."""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import adapter  # noqa: E402


def event(identifier: str, pitch: int, onset: float, duration: float | None = 0.5,
          source_index: int = 0) -> dict:
    return {"id": identifier, "pitch": pitch, "onset": onset, "duration": duration,
            "source_index": source_index}


class AdapterTests(unittest.TestCase):
    def test_prediction_mapping_keeps_raw_and_corrected_labels(self):
        self.assertEqual(adapter.prediction_for_score(0.1), (0, "left", "right"))
        self.assertEqual(adapter.prediction_for_score(0.9), (1, "right", "left"))
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.prediction_for_score(float("nan"))
        self.assertEqual(caught.exception.code, "inference_failed")

    def test_compact_fingerprint_matches_canonical_cross_language_recipe(self):
        fingerprint = adapter.hand_fingerprint([
            {"id": "b", "pitch": 84, "onset": 2.0, "duration": 0.5},
            {"id": "a", "pitch": 36, "onset": 0.0, "duration": 0.5},
        ])
        self.assertEqual(fingerprint,
                         "ph1:aee25c5a75f2386b134e4e8ee826d9eed222a35c65dcc003a46a7fc432445803")
        self.assertRegex(fingerprint, r"^ph1:[0-9a-f]{64}$")

    def test_window_normalization_padding_and_prior_outputs(self):
        events = [event("a", 36, 2.0, 1.0), event("b", 84, 3.0, 1.0)]
        window = [{"pitch": None}, events[0], events[1], {"pitch": None}]
        rows = adapter._preprocess_window(window, [1], window_size=4)
        self.assertEqual(rows.shape, (4, 4))
        self.assertEqual(rows[0, -1], 1.0)
        self.assertEqual(rows[1, -1], -1.0)
        self.assertAlmostEqual(float(rows[1, 0]), (36 - 21) / 88.0, places=6)
        self.assertAlmostEqual(float(rows[1, 1]), 2.0 / 4.0, places=6)
        self.assertAlmostEqual(float(rows[2, 1]), 3.0 / 4.0, places=6)

    def test_duplicate_invalid_and_out_of_domain_events_are_not_invented(self):
        valid, invalid = adapter._normalise_events([
            event("ok", 60, 1.0),
            {"id": "bad", "pitch": 60, "onset": math.nan, "duration": 1},
            event("dup", 60, 1.0, source_index=2),
            event("dup", 61, 1.1, source_index=3),
        ])
        self.assertEqual([item["id"] for item in valid], ["ok", "dup"])
        self.assertEqual([item["reason"] for item in invalid],
                         ["invalid-timing-or-pitch", "duplicate-id"])

    def test_report_preserves_source_order_ids_and_partial_predictions(self):
        payload = {"events": [
            {"id": "high", "pitch": 84, "onset": 2, "duration": 0.5},
            {"id": "outside", "pitch": 10, "onset": 1, "duration": 0.5},
            {"id": "low", "pitch": 36, "onset": 0, "duration": 0.5},
        ]}
        fake = {
            "predictions": {
                "low": {"id": "low", "source_index": 2, "status": "predicted",
                        "hand": "left", "raw_score": 0.99},
                "high": {"id": "high", "source_index": 0, "status": "predicted",
                         "hand": "right", "raw_score": 0.01},
            },
            "load_ms": 1.0, "inference_ms": 2.0, "window_size": 64,
            "providers": ["CPUExecutionProvider"], "valid_count": 2,
        }
        with mock.patch.object(adapter, "infer", return_value=fake):
            report = adapter.run(payload, b"not-used", "test")
        self.assertEqual([note["id"] for note in report["notes"]],
                         ["high", "outside", "low"])
        self.assertEqual(report["notes"][1]["status"], "out_of_domain")
        self.assertEqual(report["notes"][1]["hand"], None)
        self.assertEqual(report["summary"]["left"], 1)
        self.assertEqual(report["summary"]["right"], 1)

    def test_missing_prediction_is_reported_not_fabricated(self):
        payload = {"events": [{"id": "a", "pitch": 60, "onset": 1, "duration": 0.5}]}
        fake = {"predictions": {}, "load_ms": 0, "inference_ms": 0,
                "window_size": 64, "providers": ["CPUExecutionProvider"], "valid_count": 0}
        with mock.patch.object(adapter, "infer", return_value=fake):
            report = adapter.run(payload, b"not-used", "test")
        self.assertEqual(report["notes"][0]["status"], "missing_prediction")
        self.assertEqual(report["notes"][0]["hand"], None)

    def test_model_hash_and_size_failures_are_clear(self):
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.load_model_bytes(None, allow_download=False)
        self.assertEqual(caught.exception.code, "model_unavailable")
        with mock.patch("pathlib.Path.read_bytes", return_value=b"small"):
            with self.assertRaises(adapter.AdapterError) as bad:
                adapter.load_model_bytes("model.onnx", allow_download=False)
        self.assertEqual(bad.exception.code, "model_invalid")


if __name__ == "__main__":
    unittest.main()
