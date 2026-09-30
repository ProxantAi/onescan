from fastapi.testclient import TestClient
import pytest

from onescan_api import main
from onescan_api.video import VideoInfo
from types import SimpleNamespace


@pytest.fixture
def client():
    # Exercise request handling without loading a neural model in unit tests.
    return TestClient(main.app)


def test_invalid_file_returns_422_and_releases_busy_lock(client):
    response = client.post("/analyze", files={"video": ("bad.mp4", b"not video", "video/mp4")})
    assert response.status_code == 422
    assert not main.processing_lock.locked()


def test_busy_scan_returns_429(client):
    main.processing_lock.acquire()
    try:
        response = client.post("/analyze", files={"video": ("test.mp4", b"x", "video/mp4")})
        assert response.status_code == 429
    finally:
        main.processing_lock.release()


def test_bad_model_is_rejected(client):
    response = client.post("/analyze", files={"video": ("test.mp4", b"x", "video/mp4")}, data={"legacy_model": "unknown"})
    assert response.status_code == 422
    assert not main.processing_lock.locked()


def test_huge_request_is_rejected_before_decode(client):
    response = client.post("/analyze", content=b"x", headers={"content-length": str(100 * 1024 * 1024)})
    assert response.status_code == 413


def test_rejected_capture_never_reaches_either_engine(client, monkeypatch):
    def forbidden(*args):
        raise AssertionError("Inference must not run for rejected captures")
    monkeypatch.setattr(main, "engine", SimpleNamespace(detector=None, analyze=forbidden))
    monkeypatch.setattr(main, "analyze_legacy", forbidden)
    monkeypatch.setattr(main, "inspect_video", lambda path: VideoInfo(20, 30, 600, 320, 320, False))
    monkeypatch.setattr(main, "normalize_video", lambda *args: None)
    monkeypatch.setattr(main, "face_quality", lambda *args: {"accepted": False, "reason": "no_face"})
    response = client.post("/analyze", files={"video": ("test.mp4", b"x", "video/mp4")})
    assert response.status_code == 200
    assert not response.json()["success"]
    assert all(item["reason"] == "no_face" and item["heart_rate_bpm"] is None for item in response.json()["results"])
    assert not main.processing_lock.locked()
