"""WebRTC capture keeps actual frame timestamps instead of inventing 30 FPS."""
from fractions import Fraction
import io
import threading
import time

import av
import cv2
import numpy as np
try:
    from streamlit_webrtc import VideoProcessorBase
except ModuleNotFoundError:
    # Timestamp/encoding tests do not need the optional Streamlit UI runtime.
    VideoProcessorBase = object


class TimedFrameCollector(VideoProcessorBase):
    def __init__(self, state):
        self.state = state

    def save(self, frame):
        with self.state["lock"]:
            if self.state["recording"]:
                elapsed = _elapsed(frame, self.state)
                if elapsed <= 60.1 and len(self.state["frames"]) < 7200:
                    if not self.state["frames"] or elapsed > self.state["frames"][-1][1]:
                        self.state["frames"].append((_bounded_image(frame), elapsed))
                else:
                    self.state["recording"] = False

    def recv(self, frame):
        self.save(frame)
        return frame

    async def recv_queued(self, frames):
        # Preserve media PTS across all batches, independent of network jitter.
        if not frames:
            return frames
        with self.state["lock"]:
            if self.state["recording"]:
                for frame in frames:
                    elapsed = _elapsed(frame, self.state)
                    if 0 <= elapsed <= 60.1 and len(self.state["frames"]) < 7200:
                        if not self.state["frames"] or elapsed > self.state["frames"][-1][1]:
                            self.state["frames"].append((_bounded_image(frame), elapsed))
                if elapsed >= 60:
                    self.state["recording"] = False
        return frames


def new_state():
    return {"lock": threading.Lock(), "recording": False, "start": 0.0, "media_origin": None, "frames": []}


def _elapsed(frame, state):
    if frame.time is None:
        return time.monotonic() - state["start"]
    if state["media_origin"] is None:
        state["media_origin"] = frame.time
    return frame.time - state["media_origin"]


def _bounded_image(frame):
    image = frame.to_ndarray(format="rgb24")
    height, width = image.shape[:2]
    scale = min(1, 320 / max(width, height))
    return cv2.resize(image, (max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)))


def encode_recording(frames):
    if len(frames) < 2:
        raise ValueError("No hay suficientes cuadros. Enciende la cámara y vuelve a grabar.")
    buffer = io.BytesIO()
    height, width = frames[0][0].shape[:2]
    with av.open(buffer, "w", format="mp4") as container:
        stream = container.add_stream("mpeg4", rate=30)
        stream.width, stream.height = width // 2 * 2, height // 2 * 2
        stream.pix_fmt = "yuv420p"
        stream.codec_context.bit_rate = 12_000_000
        stream.codec_context.gop_size = 1
        stream.time_base = Fraction(1, 30000)
        stream.codec_context.time_base = Fraction(1, 30000)
        origin = frames[0][1]
        last_pts = -1
        for image, timestamp in frames:
            pts = round((timestamp - origin) * 30000)
            if pts <= last_pts:
                continue
            frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(image[:stream.height, :stream.width]), "rgb24")
            frame.pts, frame.time_base = pts, Fraction(1, 30000)
            for packet in stream.encode(frame):
                container.mux(packet)
            last_pts = pts
        for packet in stream.encode():
            container.mux(packet)
    return buffer.getvalue()
