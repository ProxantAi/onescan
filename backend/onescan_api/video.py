"""Bounded decoding and timestamp-based normalization shared by both engines."""
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
import math

import av
import cv2
import numpy as np

MIN_SECONDS = 20
MAX_SECONDS = 60
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
TARGET_FPS = 30


class CaptureError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass
class VideoInfo:
    duration_sec: float
    native_fps: float
    frame_count: int
    width: int
    height: int
    irregular_timing: bool
    normalized_fps: int = TARGET_FPS


def _frames(path: Path):
    with av.open(str(path)) as container:
        if not container.streams.video:
            raise CaptureError("invalid_video", "El archivo no contiene video.")
        stream = container.streams.video[0]
        rate = float(stream.average_rate or 0)
        for index, frame in enumerate(container.decode(stream)):
            if frame.width * frame.height > 4096 * 2160:
                raise CaptureError("resolution_too_large", "Usa un video de hasta 4K.")
            timestamp = frame.time
            if timestamp is None:
                if not math.isfinite(rate) or rate <= 0:
                    raise CaptureError("invalid_timing", "El video no tiene tiempos de captura válidos.")
                timestamp = index / rate
            yield frame, float(timestamp)


def inspect_video(path: Path) -> VideoInfo:
    timestamps = []
    width = height = 0
    for frame, timestamp in _frames(path):
        if not math.isfinite(timestamp):
            raise CaptureError("invalid_timing", "El video contiene tiempos inválidos.")
        if timestamps and timestamp <= timestamps[-1]:
            raise CaptureError("invalid_timing", "Los tiempos del video deben avanzar sin duplicarse.")
        timestamps.append(timestamp)
        width, height = frame.width, frame.height
        if len(timestamps) > 18000 or timestamp - timestamps[0] > MAX_SECONDS + 0.5:
            raise CaptureError("video_too_long", "Graba un video de entre 20 y 60 segundos.")
    if len(timestamps) < 2:
        raise CaptureError("video_too_short", "Graba al menos 20 segundos.")
    intervals = np.diff(timestamps)
    median_interval = float(np.median(intervals))
    # A median interval can bias alternating/variable-rate videos. Overall
    # capture rate comes from the real elapsed time, not a nominal FPS header.
    mean_interval = float(np.mean(intervals))
    fps = 1 / mean_interval
    duration = timestamps[-1] - timestamps[0] + median_interval
    if duration < MIN_SECONDS - 0.05:
        raise CaptureError("video_too_short", "Graba al menos 20 segundos.")
    if duration > MAX_SECONDS + 0.1:
        raise CaptureError("video_too_long", "El video debe durar como máximo 60 segundos.")
    if fps < 15 or float(np.max(intervals)) > 0.5:
        raise CaptureError("capture_too_slow", "La cámara perdió demasiados cuadros. Repite con mejor iluminación.")
    return VideoInfo(
        duration_sec=round(duration, 4), native_fps=round(fps, 3),
        frame_count=len(timestamps), width=width, height=height,
        irregular_timing=bool(np.std(intervals) > mean_interval * 0.1),
    )


def _image(frame):
    image = frame.to_ndarray(format="rgb24")
    rotation = -getattr(frame, "rotation", 0) % 360
    if rotation in (90, 180, 270):
        image = np.rot90(image, k=rotation // 90)
    height, width = image.shape[:2]
    scale = min(1, 640 / max(height, width))
    target = (max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2))
    return cv2.resize(image, target, interpolation=cv2.INTER_AREA)


def normalize_video(source: Path, target: Path, info: VideoInfo) -> None:
    """Use original PTS; 15/30/60 FPS videos retain the same duration and pulse."""
    iterator = iter(_frames(source))
    first, origin = next(iterator)
    previous_image = _image(first)
    previous_time = 0.0
    height, width = previous_image.shape[:2]
    with av.open(str(target), mode="w") as container:
        stream = container.add_stream("mpeg4", rate=TARGET_FPS)
        stream.width, stream.height = width, height
        stream.pix_fmt = "yuv420p"
        stream.codec_context.bit_rate = 12_000_000
        stream.codec_context.gop_size = 1
        frame_index = 0

        def emit(image):
            nonlocal frame_index
            output = av.VideoFrame.from_ndarray(image, format="rgb24")
            output.pts = frame_index
            output.time_base = Fraction(1, TARGET_FPS)
            for packet in stream.encode(output):
                container.mux(packet)
            frame_index += 1

        for frame, timestamp in iterator:
            current_time = timestamp - origin
            current_image = _image(frame)
            while frame_index / TARGET_FPS <= current_time and frame_index / TARGET_FPS < info.duration_sec:
                sample_time = frame_index / TARGET_FPS
                emit(previous_image if sample_time - previous_time <= current_time - sample_time else current_image)
            previous_time, previous_image = current_time, current_image
        while frame_index / TARGET_FPS < info.duration_sec - 1e-6:
            emit(previous_image)
        for packet in stream.encode():
            container.mux(packet)


def face_quality(path: Path, detector) -> dict:
    """Sample throughout the clip, not just its first frame."""
    sampled = present = exposed = 0
    multiple = False
    centers = []
    for index, (frame, _) in enumerate(_frames(path)):
        if index % TARGET_FPS:
            continue
        image = _image(frame)
        detections = detector.detect(image)
        sampled += 1
        if len(detections) > 1:
            multiple = True
        if len(detections) != 1:
            continue
        box = np.asarray(detections[0][0]).reshape(-1)
        # BlazeFace returns absolute xyxy coordinates after padding removal.
        x1, y1, x2, y2 = box[:4].astype(int)
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(image.shape[1], x2), min(image.shape[0], y2)
        roi = image[y1:y2, x1:x2]
        if roi.size == 0:
            continue
        present += 1
        centers.append(((x1 + x2) / (2 * image.shape[1]), (y1 + y2) / (2 * image.shape[0])))
        brightness = float(cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY).mean())
        exposed += int(25 <= brightness <= 230)
    coverage = present / max(1, sampled)
    exposure = exposed / max(1, present)
    motion = float(np.max(np.ptp(np.array(centers), axis=0))) if centers else 0.0
    reason = None
    if multiple:
        reason = "multiple_faces"
    elif coverage < 0.8:
        reason = "no_face"
    elif exposure < 0.8:
        reason = "poor_lighting"
    elif motion > 0.25:
        reason = "excessive_motion"
    return {"accepted": reason is None, "reason": reason, "face_coverage": round(coverage, 3),
            "well_lit_fraction": round(exposure, 3), "motion_range": round(motion, 3)}
