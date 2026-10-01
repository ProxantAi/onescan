import base64
import sys
import types
from pathlib import Path
import pytest


def ui(monkeypatch, event=None):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest
    import streamlit.components.v1 as components
    import requests
    helper = types.ModuleType("proxant_oidc")
    helper.require_proxant_login = lambda **kwargs: {"name": "Test"}
    monkeypatch.setitem(sys.modules, "proxant_oidc", helper)
    monkeypatch.setenv("PROXANT_AUTH_CLIENT_SECRET", "test-only")
    rendered = []
    def component(**kwargs):
        rendered.append(kwargs)
        return event
    monkeypatch.setattr(components, "declare_component", lambda *args, **kwargs: component)
    monkeypatch.setattr(requests, "get", lambda *args, **kwargs: types.SimpleNamespace(ok=True, json=lambda: {"open_rppg_ready": True}))
    return AppTest.from_file(str(Path(__file__).parents[1] / "streamlit_app.py"), default_timeout=10), rendered


def test_rejected_result_is_forwarded_without_vital_metrics(monkeypatch):
    app, rendered = ui(monkeypatch)
    app.session_state["result"] = {"success": False, "results": [{"engine": "open-rppg", "accepted": False, "reason": "low_signal_quality", "heart_rate_bpm": None}]}
    app.run()
    assert not app.exception
    assert len(app.metric) == 0
    assert rendered[-1]["result"]["results"][0]["heart_rate_bpm"] is None


def test_browser_event_is_analyzed_once_across_reruns(monkeypatch):
    import requests
    event = {"id": "scan-one", "action": "analyze", "video": base64.b64encode(b"real-video-bytes").decode(), "mime": "video/webm;codecs=vp8"}
    app, rendered = ui(monkeypatch, event)
    calls = []
    def post(*args, **kwargs):
        calls.append(kwargs)
        return types.SimpleNamespace(ok=True, json=lambda: {"success": False, "results": [], "capture_quality": {"reason": "no_face"}})
    monkeypatch.setattr(requests, "post", post)
    app.run(); app.run()
    assert not app.exception
    assert len(calls) == 1
    assert calls[0]["files"]["video"] == ("capture.webm", b"real-video-bytes", "video/webm")
    assert rendered[-1]["response_id"] == "scan-one"
    assert rendered[-1]["result"]["capture_quality"]["reason"] == "no_face"


def test_invalid_browser_event_never_reaches_api(monkeypatch):
    import requests
    app, rendered = ui(monkeypatch, {"id": "invalid", "action": "analyze", "video": "broken%%"})
    monkeypatch.setattr(requests, "post", lambda *a, **k: pytest.fail("Malformed captures must not reach inference"))
    app.run()
    assert not app.exception
    assert rendered[-1]["result"]["error"]["code"] == "invalid_video"


def test_authentication_blocks_camera_component(monkeypatch):
    import streamlit as st
    app, rendered = ui(monkeypatch)
    sys.modules['proxant_oidc'].require_proxant_login = lambda **kwargs: st.stop()
    app.run()
    assert not app.exception
    assert rendered == []
