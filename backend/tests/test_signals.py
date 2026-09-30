from onescan_api.engines import comparison, gate, result

import types
import numpy as np

from onescan_api import engines


def test_poor_signal_suppresses_vitals():
    output = result("test", "model")
    output.update(heart_rate_bpm=72, hrv={"rmssd_ms": 30})
    assert gate(output, False)["heart_rate_bpm"] is None
    assert not output["accepted"]
    assert output["hrv"] == {}


def test_nan_is_not_accepted():
    output = result("test", "model")
    output["heart_rate_bpm"] = float("nan")
    assert not gate(output, True)["accepted"]


def test_agreement_does_not_claim_accuracy_and_reference_errors_are_explicit():
    outputs = []
    for name, hr in (("first", 70), ("second", 74)):
        output = result(name, "model")
        output.update(accepted=True, heart_rate_bpm=hr)
        outputs.append(output)
    assert comparison(outputs)["difference_bpm"] == 4
    assert comparison(outputs)["reference_errors"] == []
    measured = comparison(outputs, 73)
    assert [error["absolute_error_bpm"] for error in measured["reference_errors"]] == [3, 1]
    outputs[1]["accepted"] = False
    assert comparison(outputs, 73)["difference_bpm"] is None
    assert len(comparison(outputs, 73)["reference_errors"]) == 1


def test_legacy_pnn50_percentage_is_not_multiplied(tmp_path, monkeypatch):
    video = tmp_path / "video.mp4"
    video.write_bytes(b"test")
    class Client:
        def __init__(self, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, *args, **kwargs):
            return types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: {
                "heart_rate": {"bpm": 72}, "signal_quality": {"snr_db": 10},
                "hrv": {"pnn50": 25}, "model_used": "efficientphys"})
    monkeypatch.setattr(engines.httpx, "Client", Client)
    assert engines.analyze_legacy(video, "efficientphys")["hrv"]["pnn50_percent"] == 25


def test_open_model_starts_fresh_for_each_scan_and_converts_fraction():
    seen = []
    class Model:
        state = "initial"
        statistic = {"frames": 600, "null": 0}
        def process_video(self, path):
            seen.append(self.state)
            self.state = "previous_patient"
            return {"hr": 72, "SQI": 0.9, "hrv": {"pnn50": 0.25}}
        def bvp(self):
            return np.sin(np.arange(600)), np.arange(600) / 30
    engine = object.__new__(engines.OpenRppgEngine)
    engine.model = Model()
    engine.initial_state = "initial"
    for _ in range(2):
        output = engine.analyze("test.mp4")
        assert output["accepted"]
        assert output["hrv"]["pnn50_percent"] == 25
    assert seen == ["initial", "initial"]
