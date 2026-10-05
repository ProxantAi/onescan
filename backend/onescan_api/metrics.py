"""Experimental pulse intervals and respiration from full-resolution BVP only."""
import math

import heartpy as hp
import numpy as np
from scipy import signal

MIN_RESPIRATION_SECONDS = 45
MIN_INTERVAL_COVERAGE = 0.8


def lnrmssd(value):
    try:
        number = float(value)
        return round(math.log(number), 4) if math.isfinite(number) and number > 0 else None
    except (TypeError, ValueError):
        return None


def empty_metrics(reason="full_resolution_signal_unavailable"):
    return {"heartbeats": [], "respiration": {"rate_bpm": None, "status": reason},
            "interval_quality": {"status": reason}}


def intervals_from_peaks(peaks, mask, timestamps):
    """Keep chronological peak pairs; never join across a rejected interval."""
    if len(mask) != len(peaks) - 1:
        raise ValueError("Interval mask does not match detected peaks")
    beats, runs, run = [], [], []
    for index, (a, b) in enumerate(zip(peaks[:-1], peaks[1:])):
        if not (0 <= a < b <= len(timestamps) - 1):
            raise ValueError("Peak position is outside the signal")
        start, end = np.interp([a, b], np.arange(len(timestamps)), timestamps)
        duration = (end - start) * 1000
        if mask[index] or not 60000 / 220 <= duration <= 2000:
            if run:
                runs.append(run)
                run = []
            continue
        beat = {"start_location_sec": round(float(start), 4),
                "end_location_sec": round(float(end), 4), "duration_ms": round(float(duration), 2)}
        beats.append(beat)
        run.append(beat)
    if run:
        runs.append(run)
    return beats, runs


def respiration_from_intervals(runs):
    """Estimate respiratory modulation of pulse intervals, not chest motion."""
    result = {"rate_bpm": None, "status": "insufficient_contiguous_intervals",
              "method": "pulse_interval_modulation_periodogram", "experimental": True,
              "supported_range_bpm": [6, 24], "minimum_duration_sec": MIN_RESPIRATION_SECONDS}
    if not runs:
        return result
    run = max(runs, key=lambda x: x[-1]["end_location_sec"] - x[0]["start_location_sec"])
    times = np.array([(x["start_location_sec"] + x["end_location_sec"]) / 2 for x in run])
    intervals = np.array([x["duration_ms"] for x in run])
    if len(times) < 30 or times[-1] - times[0] < MIN_RESPIRATION_SECONDS:
        return result
    # The uniform 4 Hz grid does not improve the resolution of the camera.
    grid = np.arange(times[0], times[-1], .25)
    modulation = signal.detrend(np.interp(grid, times, intervals))
    std = float(np.std(modulation))
    freq, power = signal.periodogram(modulation, fs=4, window="hann")
    band = np.flatnonzero((freq >= .1) & (freq <= .4))
    peak = int(band[np.argmax(power[band])])
    # Evaluate only the search band. This is an operational score, not accuracy.
    total = float(np.sum(power[band]))
    near_peak = band[np.abs(band - peak) <= 1]
    concentration = float(np.sum(power[near_peak])) / total if total > 0 else 0
    result["quality"] = {"rr_modulation_std_ms": round(std, 3),
                         "spectral_concentration": round(concentration, 4),
                         "minimum_modulation_std_ms": 3, "minimum_spectral_concentration": .5,
                         "analyzed_duration_sec": round(len(grid) / 4, 3),
                         "frequency_resolution_bpm": round(60 * 4 / len(grid), 3)}
    if std < 3 or concentration < .5 or peak in (band[0], band[-1]):
        result["status"] = "respiratory_modulation_not_clear"
    else:
        result.update(rate_bpm=round(float(freq[peak] * 60), 1), status="estimated")
    return result


def analyze_intervals(bvp, timestamps, heart_rate_bpm):
    output = empty_metrics("intervals_not_computable")
    values, times = np.asarray(bvp, dtype=float), np.asarray(timestamps, dtype=float)
    if (values.ndim != 1 or times.ndim != 1 or len(values) != len(times) or len(times) < 3
            or not np.all(np.isfinite(values)) or not np.all(np.isfinite(times))
            or np.any(np.diff(times) <= 0)):
        return output
    times = times - times[0]
    fs = 1 / float(np.median(np.diff(times)))
    if fs < 15 or np.max(np.abs(np.diff(times) * fs - 1)) > .1 or np.std(values) < 1e-8:
        return output
    try:
        working, _ = hp.process(values, fs, high_precision=True, clean_rr=True,
                                bpmmin=30, bpmmax=220)
        beats, runs = intervals_from_peaks(working["peaklist"], working["RR_masklist"], times)
    except Exception:
        # An optional metric failure must not suppress an otherwise valid pulse.
        return output
    duration = float(times[-1] + 1 / fs)
    coverage = sum(x["duration_ms"] for x in beats) / (duration * 1000)
    interval_bpm = 60000 / np.mean([x["duration_ms"] for x in beats]) if beats else None
    agreement = interval_bpm is not None and abs(interval_bpm - heart_rate_bpm) <= max(5, heart_rate_bpm * .1)
    enough = len(beats) >= 5 and coverage >= MIN_INTERVAL_COVERAGE and agreement
    output["interval_quality"] = {"status": "accepted" if enough else "interval_quality_insufficient",
                                  "accepted_intervals": len(beats),
                                  "rejected_intervals": len(working["RR_masklist"]) - len(beats),
                                  "coverage_fraction": round(coverage, 4),
                                  "minimum_coverage_fraction": MIN_INTERVAL_COVERAGE,
                                  "signal_duration_sec": round(duration, 4), "sample_rate_hz": round(fs, 3),
                                  "matches_pulse_estimate": bool(agreement),
                                  "method": "heartpy_1.2.7_peak_pairs", "experimental": True}
    if enough:
        output["heartbeats"] = beats
        output["respiration"] = respiration_from_intervals(runs)
    else:
        output["respiration"]["status"] = "interval_quality_insufficient"
    return output
