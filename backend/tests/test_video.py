from fractions import Fraction
from pathlib import Path

import av
import numpy as np
import pytest

from onescan_api.video import CaptureError, face_quality, inspect_video, normalize_video


def write_video(path, fps=30, seconds=20, variable=False):
    with av.open(str(path), "w") as container:
        stream = container.add_stream("mpeg4", rate=fps)
        stream.width = stream.height = 32
        stream.pix_fmt = "yuv420p"
        stream.codec_context.gop_size = 1
        stream.codec_context.time_base = Fraction(1, 30000)
        for index in range(round(fps * seconds)):
            timestamp = index / fps + (0.005 if variable and index % 2 else 0)
            value = 128 + 30 * np.sin(2 * np.pi * 1.2 * timestamp)
            image = np.full((32, 32, 3), value, dtype=np.uint8)
            frame = av.VideoFrame.from_ndarray(image, "rgb24")
            frame.pts, frame.time_base = round(timestamp * 30000), Fraction(1, 30000)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


@pytest.mark.parametrize("fps", [15, 24, 30, 60])
def test_resampling_preserves_duration_and_frequency(tmp_path, fps):
    source, target = tmp_path / "source.mp4", tmp_path / "target.mp4"
    write_video(source, fps)
    info = inspect_video(source)
    assert abs(info.duration_sec - 20) < 0.05
    normalize_video(source, target, info)
    normalized = inspect_video(target)
    assert normalized.native_fps == pytest.approx(30, abs=0.01)
    assert normalized.duration_sec == pytest.approx(20, abs=0.05)
    with av.open(str(target)) as container:
        signal = np.array([frame.to_ndarray().mean() for frame in container.decode(video=0)])
    frequency = np.fft.rfftfreq(len(signal), 1 / 30)[np.argmax(abs(np.fft.rfft(signal - signal.mean())))]
    assert frequency == pytest.approx(1.2, abs=0.06)


def test_variable_frame_timing_is_detected_and_resampled(tmp_path):
    source, target = tmp_path / "source.mp4", tmp_path / "target.mp4"
    write_video(source, variable=True)
    info = inspect_video(source)
    assert info.irregular_timing
    normalize_video(source, target, info)
    assert not inspect_video(target).irregular_timing


def test_short_video_is_rejected(tmp_path):
    source = tmp_path / "source.mp4"
    write_video(source, seconds=1)
    with pytest.raises(CaptureError, match="20 segundos"):
        inspect_video(source)


def test_no_face_is_rejected(tmp_path):
    source = tmp_path / "source.mp4"
    write_video(source)
    class EmptyDetector:
        def detect(self, image):
            return []
    quality = face_quality(source, EmptyDetector())
    assert not quality["accepted"]
    assert quality["reason"] == "no_face"


def test_capture_keeps_real_timestamps(tmp_path):
    from capture import encode_recording
    frames = [(np.full((32, 32, 3), 128, np.uint8), i / 15) for i in range(300)]
    path = tmp_path / "recording.mp4"
    path.write_bytes(encode_recording(frames))
    info = inspect_video(path)
    assert info.native_fps == pytest.approx(15, abs=0.01)
    assert info.duration_sec == pytest.approx(20, abs=0.1)
