import sys
import types
from pathlib import Path

import pytest


def test_rejected_scan_does_not_render_vital_metrics(monkeypatch):
    pytest.importorskip("streamlit_webrtc")
    from streamlit.testing.v1 import AppTest
    import requests
    import streamlit_webrtc

    # Test the UI layout only. Deployed UI always uses the real OIDC helper.
    helper = types.ModuleType("proxant_oidc")
    helper.require_proxant_login = lambda **kwargs: None
    helper.render_auth_header = lambda **kwargs: None
    monkeypatch.setitem(sys.modules, "proxant_oidc", helper)
    monkeypatch.setenv("PROXANT_AUTH_CLIENT_SECRET", "test-only")
    monkeypatch.setattr(streamlit_webrtc, "webrtc_streamer", lambda **kwargs: None)
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: types.SimpleNamespace(json=lambda: {"open_rppg_ready": True}))
    app = AppTest.from_file(str(Path(__file__).parents[1] / "streamlit_app.py"), default_timeout=10)
    app.run()
    assert not app.exception
    app.session_state["result"] = {"results": [{"engine": "open-rppg", "model_used": "FacePhys.rlap", "accepted": False,
                                                "reason": "low_signal_quality", "quality": {}}],
                                   "comparison": {"difference_bpm": None, "reference_errors": [], "note": "test"},
                                   "video": {}, "capture_quality": {}}
    app.run()
    assert not app.exception
    assert len(app.metric) == 0
    assert any("señal" in warning.value for warning in app.warning)
