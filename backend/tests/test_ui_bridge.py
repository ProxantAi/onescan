import base64
import pytest
from ui_bridge import BrowserCaptureError, decode_capture

def capture(**extra):
    return {"video": base64.b64encode(b"video").decode(), "mime": "video/webm;codecs=vp8", **extra}

def test_preserves_browser_video_without_pixel_downsampling():
    video, form = decode_capture(capture(reference_bpm=72))
    assert video == ("capture.webm", b"video", "video/webm")
    assert form == {"selected": "compare", "legacy_model": "efficientphys", "reference_bpm": "72.0"}

@pytest.mark.parametrize("extra", [{"video": "not-base64%%"}, {"video": ""}, {"mime": "text/html"}, {"selected": "invalid"}, {"reference_bpm": float("nan")}, {"reference_bpm": 221}])
def test_rejects_invalid_payloads(extra):
    with pytest.raises(BrowserCaptureError):
        decode_capture(capture(**extra))

def test_rejects_oversized_data_before_decoding(monkeypatch):
    import ui_bridge
    monkeypatch.setattr(ui_bridge, "MAX_BYTES", 3)
    with pytest.raises(BrowserCaptureError):
        decode_capture(capture(video="a"*100))
