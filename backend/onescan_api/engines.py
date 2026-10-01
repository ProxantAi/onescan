"""Adapters preserve provenance and never invent absent measurements."""
import math
import os
import sys
import time
from pathlib import Path

import httpx
import numpy as np

OPEN_MODEL = "FacePhys.rlap"
LEGACY_URL = os.environ.get("LEGACY_RPPG_URL", "http://127.0.0.1:8000")
MIN_SQI = float(os.environ.get("ONESCAN_MIN_SQI", "0.5"))
MIN_LEGACY_SNR = float(os.environ.get("ONESCAN_MIN_LEGACY_SNR", "0"))


def finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, 4) if math.isfinite(number) else None


def result(engine, model):
    return {"engine": engine, "model_used": model, "accepted": False, "reason": None,
            "heart_rate_bpm": None, "hrv": {}, "quality": {}, "bvp_waveform": [],
            "processing_seconds": None, "warnings": []}


def gate(output, quality_ok, causes=None):
    hr = finite(output.get("heart_rate_bpm"))
    rejected = list(causes or [])
    if not quality_ok and not rejected:
        rejected.append("signal_below_threshold")
    if hr is None:
        rejected.append("pulse_not_computable")
    elif not 30 <= hr <= 220:
        rejected.append("pulse_out_of_supported_range")
    output["quality"]["rejection_causes"] = rejected
    if not quality_ok or hr is None or not 30 <= hr <= 220:
        output.update(accepted=False, reason="low_signal_quality", heart_rate_bpm=None, hrv={})
    else:
        output.update(accepted=True, heart_rate_bpm=hr)
    return output


class OpenRppgEngine:
    def __init__(self):
        source = os.environ.get("OPEN_RPPG_PATH")
        if source:
            sys.path.insert(0, source)
        from rppg import Model
        self.model = Model(OPEN_MODEL)
        self.initial_state = self.model.state
        # Bound upstream face-detection thread pools on shared CPU hosts.
        self.model.face_detection_threads = 2
        self.model.face_resampling_threads = 2

    @property
    def detector(self):
        return self.model.detector

    def analyze(self, path: Path):
        output = result("open-rppg", OPEN_MODEL)
        started = time.perf_counter()
        # Recurrent inference state belongs to one scan, never to the next person.
        self.model.state = self.initial_state
        values = self.model.process_video(str(path)) or {}
        if finite(values.get("hr")) is None:
            # Upstream couples HR and HRV in one try block. Missing pulse-rate
            # variability must not hide an otherwise computable heart rate.
            values = self.model.hr(return_hrv=False) or values
            output["warnings"].append("No se pudo estimar la variabilidad en este escaneo.")
        signal, _ = self.model.bvp()
        statistics = dict(self.model.statistic)
        sqi = finite(values.get("SQI"))
        hrv = values.get("hrv") or {}
        output.update(heart_rate_bpm=finite(values.get("hr")),
                      hrv={"rmssd_ms": finite(hrv.get("rmssd")), "sdnn_ms": finite(hrv.get("sdnn")),
                           "pnn50_percent": finite(100 * float(hrv["pnn50"])) if finite(hrv.get("pnn50")) is not None else None},
                      quality={"sqi": sqi, "minimum_sqi": MIN_SQI, "frame_statistics": statistics},
                      processing_seconds=round(time.perf_counter() - started, 3))
        if len(signal):
            indices = np.linspace(0, len(signal) - 1, min(512, len(signal))).astype(int)
            output["bvp_waveform"] = [finite(signal[index]) for index in indices]
        missing_fraction = statistics.get("null", 0) / max(1, statistics.get("frames", 0))
        output["quality"]["missing_face_fraction"] = round(missing_fraction, 4)
        causes = []
        if sqi is None:
            causes.append("sqi_not_computable")
        elif sqi < MIN_SQI:
            causes.append("sqi_below_threshold")
        if missing_fraction > 0.2:
            causes.append("face_tracking_gaps")
        return gate(output, not causes, causes)


def analyze_legacy(path: Path, model: str):
    output = result("rPPG-Toolbox", model)
    started = time.perf_counter()
    with path.open("rb") as video, httpx.Client(timeout=180) as client:
        response = client.post(f"{LEGACY_URL.rstrip('/')}/analyze", params={"model": model},
                               files={"video": ("scan.mp4", video, "video/mp4")})
        response.raise_for_status()
        values = response.json()
    snr = finite((values.get("signal_quality") or {}).get("snr_db"))
    metrics = values.get("hrv") or {}
    pnn50 = finite(metrics.get("pnn50"))
    output.update(model_used=values.get("model_used", model),
                  heart_rate_bpm=finite((values.get("heart_rate") or {}).get("bpm")),
                  hrv={"rmssd_ms": finite(metrics.get("rmssd_ms")), "sdnn_ms": finite(metrics.get("sdnn_ms")),
                       # NeuroKit already returns pNN50 as a percentage;
                       # HeartPy (the open-rppg adapter) returns a fraction.
                       "pnn50_percent": pnn50},
                  quality={"snr_db": snr, "minimum_snr_db": MIN_LEGACY_SNR},
                  bvp_waveform=[finite(value) for value in values.get("bvp_waveform", [])],
                  processing_seconds=round(time.perf_counter() - started, 3),
                  warnings=values.get("warnings", []))
    # Deliberately omit the old experimental blood-pressure formula.
    causes = ["snr_not_computable"] if snr is None else ["snr_below_threshold"] if snr < MIN_LEGACY_SNR else []
    return gate(output, not causes, causes)


def comparison(results, reference_bpm=None):
    accepted = [item for item in results if item["accepted"]]
    errors = []
    if reference_bpm is not None:
        errors = [{"engine": item["engine"], "absolute_error_bpm": round(abs(item["heart_rate_bpm"] - reference_bpm), 3)}
                  for item in accepted]
    return {"reference_bpm": reference_bpm, "reference_errors": errors,
            "difference_bpm": round(abs(accepted[0]["heart_rate_bpm"] - accepted[1]["heart_rate_bpm"]), 3)
            if len(accepted) == 2 else None,
            "note": "La coincidencia entre motores no demuestra precisión. Usa una medición de referencia simultánea."}
