import math

import numpy as np
import pytest

from onescan_api.metrics import analyze_intervals, intervals_from_peaks, lnrmssd, respiration_from_intervals
from onescan_api.engines import gate, result


@pytest.mark.parametrize("value", [None, "bad", float("nan"), float("inf"), 0, -1])
def test_log_rmssd_missing_or_nonpositive_is_unavailable(value):
    assert lnrmssd(value) is None


def test_log_rmssd_uses_ms_input_and_is_dimensionless():
    assert lnrmssd(30) == pytest.approx(math.log(30), abs=1e-4)


def test_rejected_interval_is_not_bridged_and_fractional_peaks_keep_time():
    times = 12 + np.arange(120) / 30
    beats, runs = intervals_from_peaks([5.5, 29.5, 53.5, 77.5, 101.5], [0, 1, 0, 0], times)
    assert len(beats) == 3
    assert [len(run) for run in runs] == [1, 2]
    assert beats[0]["start_location_sec"] == pytest.approx(12 + 5.5 / 30, abs=1e-4)
    assert all(x["duration_ms"] == 800 for x in beats)


def known_respiratory_intervals(seconds=60):
    beats, t = [], 0
    while t < seconds:
        interval = .8 + .06 * np.sin(2 * np.pi * .2 * t)
        beats.append({"start_location_sec": t, "end_location_sec": t + interval,
                      "duration_ms": interval * 1000})
        t += interval
    return beats


def test_respiration_recovers_known_modulation_with_documented_resolution():
    estimate = respiration_from_intervals([known_respiratory_intervals()])
    assert estimate["status"] == "estimated"
    assert estimate["rate_bpm"] == pytest.approx(12, abs=estimate["quality"]["frequency_resolution_bpm"])
    assert estimate["experimental"]


def test_short_disjoint_or_unmodulated_intervals_do_not_produce_respiration():
    short = known_respiratory_intervals(25)
    assert respiration_from_intervals([short, short])["rate_bpm"] is None
    constant = [{"start_location_sec": i * .8, "end_location_sec": (i+1)*.8,
                 "duration_ms": 800} for i in range(75)]
    estimate = respiration_from_intervals([constant])
    assert estimate["rate_bpm"] is None
    assert estimate["status"] == "respiratory_modulation_not_clear"


def test_real_heartpy_processing_uses_full_resolution_and_relative_timestamps():
    times = np.arange(1800) / 30
    peaks = np.array([x["start_location_sec"] for x in known_respiratory_intervals()])
    waveform = sum(np.exp(-((times - peak) / .07)**2) for peak in peaks)
    estimate = analyze_intervals(waveform, times + 1234, 75)
    assert estimate["interval_quality"]["status"] == "accepted"
    assert len(estimate["heartbeats"]) > 60
    assert 0 <= estimate["heartbeats"][0]["start_location_sec"] < 1
    assert estimate["respiration"]["rate_bpm"] == pytest.approx(12, abs=2)


def test_bad_timestamps_or_ambiguous_peak_rate_never_report_intervals():
    times = np.arange(600) / 30
    signal = np.sin(times * 2 * np.pi * 1.2)
    assert not analyze_intervals(signal, times, 180)["heartbeats"]
    times[10] = times[9]
    assert not analyze_intervals(signal, times, 72)["heartbeats"]


def test_engine_rejection_clears_every_optional_vital_and_trace():
    output = result("test", "test")
    output.update(heart_rate_bpm=72, hrv={"rmssd_ms":30,"lnrmssd":lnrmssd(30)},
                  heartbeats=[{"duration_ms":800}], respiration={"rate_bpm":12}, bvp_waveform=[1,2])
    gate(output, False)
    assert output["hrv"] == {} and output["heartbeats"] == [] and output["bvp_waveform"] == []
    assert output["respiration"]["rate_bpm"] is None
