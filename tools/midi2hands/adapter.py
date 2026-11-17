#!/usr/bin/env python3
"""Direct performance-note adapter for the pinned midi2hands ONNX model.

This intentionally bypasses MIDI round-tripping: input occurrences keep their IDs and
source timing, and the output labels/prediction scores map back by ID. The model is a
generative sequence model, so valid notes are processed in stable chronological order.
The upstream `inference` function returns the original events plus y_pred; its original
`.hand` fields are not predictions. This adapter consumes y_pred explicitly.

Model: https://github.com/pianoviz/midi2hands commit
78e546b520144b301de5e793ceb83be61356a65d, MIT licence, model.onnx 252047 bytes,
sha256 6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import struct
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Iterable

import numpy as np

UPSTREAM_COMMIT = "78e546b520144b301de5e793ceb83be61356a65d"
MODEL_URL = (
    "https://raw.githubusercontent.com/pianoviz/midi2hands/"
    f"{UPSTREAM_COMMIT}/src/midi2hands/models/onnex/model.onnx"
)
MODEL_SHA256 = "6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd"
MODEL_BYTES = 252047
UPSTREAM_LICENSE = "MIT"
SUPPORTED_PITCH_MIN = 21
SUPPORTED_PITCH_MAX = 108
WINDOW_FALLBACK = 64
FEATURE_COUNT = 4


class AdapterError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _f64_hex(value: float) -> str:
    return struct.pack(">d", float(value)).hex()


def hand_fingerprint(performance: Iterable[Any]) -> str:
    """Must match the TS `ph1:` canonical identity exactly."""
    rows: list[tuple[bytes, str]] = []
    count = 0
    for note in performance:
        if not isinstance(note, dict) or not isinstance(note.get("id"), str):
            raise AdapterError("invalid_input", "Fingerprint input has an occurrence without an ID.")
        identifier = note["id"]
        id_bytes = identifier.encode("utf-8")
        duration = note.get("duration")
        row = (f"{len(id_bytes)}:{identifier}\t{int(note['pitch'])}\t"
               f"{_f64_hex(float(note['onset']))}\t"
               f"{'null' if duration is None else _f64_hex(float(duration))}\n")
        rows.append((id_bytes, row))
        count += 1
    rows.sort(key=lambda item: (item[0], item[1]))
    canonical = f"piano-hand-v1\n{count}\n" + "".join(row for _, row in rows)
    return "ph1:" + _sha256(canonical.encode("utf-8"))


def load_model_bytes(model_path: str | None, allow_download: bool) -> tuple[bytes, str]:
    if model_path:
        try:
            data = Path(model_path).read_bytes()
        except OSError as error:
            raise AdapterError("model_unavailable", f"Could not read model: {error}") from error
        source = f"file:{Path(model_path).name}"
    elif allow_download:
        try:
            with urllib.request.urlopen(MODEL_URL, timeout=60) as response:
                data = response.read()
        except Exception as error:
            raise AdapterError("model_unavailable",
                               f"Pinned model download failed: {error}") from error
        source = MODEL_URL
    else:
        raise AdapterError("model_unavailable",
                           "No --model path supplied and --allow-download was not enabled.")
    if len(data) != MODEL_BYTES:
        raise AdapterError("model_invalid",
                           f"Model size {len(data)} does not match pinned {MODEL_BYTES}.")
    digest = _sha256(data)
    if digest != MODEL_SHA256:
        raise AdapterError("model_invalid",
                           f"Model sha256 {digest} does not match pinned {MODEL_SHA256}.")
    return data, source


def _read_events(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("events", "performance", "notes"):
            if isinstance(payload.get(key), list):
                return payload[key]
        raise AdapterError("invalid_input", "Input object has no events/performance/notes array.")
    if isinstance(payload, list):
        return payload
    raise AdapterError("invalid_input", "Input must be a performance array or an object with one.")


def _normalise_events(raw_events: Iterable[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    valid: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_events):
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"]:
            invalid.append({"source_index": index, "id": None, "status": "invalid",
                            "reason": "missing-id", "hand": None, "raw_score": None})
            continue
        occurrence_id = raw["id"]
        if occurrence_id in seen:
            invalid.append({"source_index": index, "id": occurrence_id, "status": "invalid",
                            "reason": "duplicate-id", "hand": None, "raw_score": None})
            continue
        seen.add(occurrence_id)
        onset = raw.get("onset")
        duration = raw.get("duration")
        pitch = raw.get("pitch")
        if (not isinstance(onset, (int, float)) or not math.isfinite(onset) or onset < 0
                or not isinstance(pitch, (int, float)) or not isinstance(pitch, int)
                or not (0 <= pitch <= 127)
                or (duration is not None and (not isinstance(duration, (int, float))
                                              or not math.isfinite(duration) or duration <= 0))):
            invalid.append({"source_index": index, "id": occurrence_id, "status": "invalid",
                            "reason": "invalid-timing-or-pitch", "hand": None, "raw_score": None})
            continue
        valid.append({
            "id": occurrence_id, "source_index": index, "onset": float(onset),
            "duration": None if duration is None else float(duration), "pitch": int(pitch),
        })
    return valid, invalid


def _event_feature(event: dict[str, Any]) -> list[float]:
    # The upstream MIDI preprocessing normalises start/end by the window's later end.
    # Seconds are directly usable because the normalisation is scale-invariant. A
    # missing duration is only a model-window fallback; source data is never changed.
    end = event["onset"] + (event["duration"] if event["duration"] is not None else 0.25)
    return [float(event["pitch"]), event["onset"], end, -1.0]


def _preprocess_window(window_events: list[dict[str, Any]], previous_predictions: list[int],
                       window_size: int) -> np.ndarray:
    rows = np.asarray([_event_feature(event) if event.get("pitch") is not None
                       else [-1.0, -1.0, -1.0, -1.0] for event in window_events],
                      dtype=np.float32)
    if rows.shape != (window_size, FEATURE_COUNT):
        raise AdapterError("model_invalid", "The model window does not match 64×4 features.")
    non_pad = np.where(rows[:, 0] != -1)[0]
    if non_pad.size:
        max_end = float(np.max(rows[non_pad, 2]))
        if not math.isfinite(max_end) or max_end <= 0:
            raise AdapterError("invalid_input", "A performance window has no positive end time.")
        rows[non_pad, 1:3] = rows[non_pad, 1:3] / max_end
        rows[non_pad, 0] = (rows[non_pad, 0] - SUPPORTED_PITCH_MIN) / 88.0
    rows[:, -1] = -1.0
    prior = previous_predictions[-(window_size // 2):]
    if prior:
        rows[:len(prior), -1] = np.asarray(prior, dtype=np.float32)
    return rows


def prediction_for_score(score: float) -> tuple[int, str, str]:
    if not math.isfinite(score):
        raise AdapterError("inference_failed", "The model returned a non-finite score.")
    label = 0 if score < 0.5 else 1
    # Upstream converts 0=left and 1=right, but the pinned training data's track
    # convention is reversed: the upstream test MIDI's track 0 is named "Rechts"
    # (right) and the code labels every track except 1 "left". The model therefore
    # learned 0=right/1=left in musical terms. Keep raw/code labels visible.
    upstream_label = "left" if label == 0 else "right"
    musical_hand = "right" if label == 0 else "left"
    return label, upstream_label, musical_hand


def infer(events: list[dict[str, Any]], model_bytes: bytes) -> dict[str, Any]:
    try:
        import onnxruntime as ort
    except Exception as error:
        raise AdapterError("runtime_unavailable",
                           f"onnxruntime is unavailable: {error}") from error

    load_started = time.perf_counter()
    try:
        session = ort.InferenceSession(model_bytes, providers=["CPUExecutionProvider"])
    except Exception as error:
        raise AdapterError("model_invalid", f"ONNX session could not start: {error}") from error
    load_ms = (time.perf_counter() - load_started) * 1000.0

    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1 or len(outputs) != 1:
        raise AdapterError("model_invalid", "The pinned model must expose one input and one output.")
    shape = inputs[0].shape
    if len(shape) != 3 or shape[0] != 1 or shape[2] != FEATURE_COUNT:
        raise AdapterError("model_invalid", f"Unexpected model input shape: {shape}.")
    window_size = shape[1] if isinstance(shape[1], int) and shape[1] > 0 else WINDOW_FALLBACK
    if window_size % 2:
        raise AdapterError("model_invalid", "The model window must be even.")
    half = window_size // 2

    ordered = sorted(events, key=lambda event: (event["onset"], event["pitch"], event["id"]))
    ordered = [event for event in ordered
               if SUPPORTED_PITCH_MIN <= event["pitch"] <= SUPPORTED_PITCH_MAX]
    predictions_by_id: dict[str, dict[str, Any]] = {}
    previous_predictions: list[int] = []
    started = time.perf_counter()
    for index, event in enumerate(ordered):
        window_events: list[dict[str, Any]] = []
        for offset in range(-half, half):
            source = index + offset
            window_events.append(ordered[source] if 0 <= source < len(ordered) else {"pitch": None})
        rows = _preprocess_window(window_events, previous_predictions, window_size)
        try:
            result = session.run([outputs[0].name], {inputs[0].name: rows[None, :, :]})
            flat = np.asarray(result[0]).reshape(-1)
            if flat.size != 1:
                raise AdapterError("inference_failed",
                                   f"Expected one score, received {flat.size} values.")
            score = float(flat[0])
        except AdapterError:
            raise
        except Exception as error:
            raise AdapterError("inference_failed", f"ONNX inference failed: {error}") from error
        label, upstream_label, musical_hand = prediction_for_score(score)
        predictions_by_id[event["id"]] = {
            "id": event["id"], "source_index": event["source_index"],
            "status": "predicted", "hand": musical_hand,
            "prediction": label, "upstream_label": upstream_label, "raw_score": score,
        }
        previous_predictions.append(label)
    inference_ms = (time.perf_counter() - started) * 1000.0
    return {
        "predictions": predictions_by_id,
        "load_ms": load_ms,
        "inference_ms": inference_ms,
        "window_size": window_size,
        "half_window": half,
        "valid_count": len(predictions_by_id),
        "model_input": inputs[0].name,
        "model_output": outputs[0].name,
        "providers": session.get_providers(),
    }


def run(payload: Any, model_bytes: bytes, model_source: str) -> dict[str, Any]:
    raw_events = _read_events(payload)
    try:
        fingerprint = hand_fingerprint(raw_events)
    except (AdapterError, TypeError, ValueError, KeyError):
        fingerprint = None
    events, invalid = _normalise_events(raw_events)
    result = infer(events, model_bytes)
    notes: list[dict[str, Any]] = []
    valid_ids = {event["id"] for event in events}
    for event in events:
        if not (SUPPORTED_PITCH_MIN <= event["pitch"] <= SUPPORTED_PITCH_MAX):
            notes.append({"id": event["id"], "source_index": event["source_index"],
                          "status": "out_of_domain", "hand": None, "raw_score": None,
                          "reason": "outside-midi-21-108"})
        else:
            notes.append(result["predictions"].get(event["id"], {
                "id": event["id"], "source_index": event["source_index"],
                "status": "missing_prediction", "hand": None, "raw_score": None,
                "reason": "model-omitted-occurrence",
            }))
    notes.extend(invalid)
    # Source order is deliberate: IDs, not list positions, are the durable identity.
    notes.sort(key=lambda item: item.get("source_index", 0))
    total_events = len(notes)
    return {
        "schema_version": 1,
        "adapter": "midi2hands-direct-note-adapter-v1",
        "ok": True,
        "performance_fingerprint": fingerprint,
        "upstream": {"commit": UPSTREAM_COMMIT, "license": UPSTREAM_LICENSE,
                     "url": "https://github.com/pianoviz/midi2hands"},
        "artifact": {"url": MODEL_URL, "source": model_source, "sha256": MODEL_SHA256,
                     "bytes": MODEL_BYTES, "window_size": result["window_size"],
                     "features": FEATURE_COUNT},
        "runtime": {
            "python": platform.python_version(), "numpy": np.__version__,
            "onnxruntime": __import__("onnxruntime").__version__,
            "providers": result["providers"], "model_load_ms": round(result["load_ms"], 3),
            "inference_ms": round(result["inference_ms"], 3), "events": total_events,
            "predicted": result["valid_count"],
            "out_of_domain": sum(1 for note in notes if note["status"] == "out_of_domain"),
            "invalid": len(invalid),
        },
        "score_kind": "uncalibrated_raw_model_output_threshold_0.5",
        "label_mapping": {
            "raw_0": "right", "raw_1": "left",
            "upstream_interface_0": "left", "upstream_interface_1": "right",
            "reason": "Pinned training MIDI track convention is reversed relative to upstream NoteEvent labels; raw/code labels are preserved per note.",
        },
        "notes": notes,
        "summary": {
            "left": sum(1 for note in notes if note["hand"] == "left"),
            "right": sum(1 for note in notes if note["hand"] == "right"),
            "unassigned": sum(1 for note in notes if note["hand"] is None),
            "valid_ids": len(valid_ids),
        },
        "warnings": [
            "Model predictions are estimates, not verified pianist ground truth.",
            "Raw scores are uncalibrated and are not probabilities.",
            "Musical hands apply the documented pinned-artifact label correction; raw and upstream labels remain in the report.",
        ],
    }


def failure(code: str, message: str) -> dict[str, Any]:
    return {"schema_version": 1, "adapter": "midi2hands-direct-note-adapter-v1",
            "ok": False, "error": {"code": code, "message": message}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run pinned midi2hands CPU inference on performance events.")
    parser.add_argument("--input", required=True, help="Draft/performance JSON; no MIDI round-trip.")
    parser.add_argument("--model", help="Optional local model.onnx path; hash is always verified.")
    parser.add_argument("--allow-download", action="store_true",
                        help="Download the pinned model URL if --model is absent.")
    parser.add_argument("--summary", action="store_true", help="Print summary without per-note rows.")
    args = parser.parse_args(argv)
    try:
        if args.input == "-":
            payload = json.loads(sys.stdin.read())
            source_count = len(payload.get("events", [])) if isinstance(payload, dict) else len(payload)
        else:
            payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
            source_count = len(payload.get("events", [])) if isinstance(payload, dict) else len(payload)
        model_bytes, source = load_model_bytes(args.model, args.allow_download)
        report = run(payload, model_bytes, source)
    except AdapterError as error:
        print(json.dumps(failure(error.code, str(error)), separators=(",", ":")))
        return 2
    except Exception as error:
        print(json.dumps(failure("adapter_error", str(error)), separators=(",", ":")))
        return 2
    if args.summary:
        report = {key: value for key, value in report.items() if key != "notes"}
        report["notes"] = f"{source_count} source rows omitted"
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
