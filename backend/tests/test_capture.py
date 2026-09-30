import asyncio
from fractions import Fraction
import time

import av
import numpy as np
import pytest

from capture import TimedFrameCollector, new_state


def frame(pts):
    value = av.VideoFrame.from_ndarray(np.full((32, 32, 3), 128, np.uint8), "rgb24")
    value.pts, value.time_base = pts, Fraction(1, 30)
    return value


def test_media_timing_survives_delayed_batches(monkeypatch):
    state = new_state()
    state.update(recording=True, start=100)
    collector = TimedFrameCollector(state)
    monkeypatch.setattr(time, "monotonic", lambda: 110)
    asyncio.run(collector.recv_queued([frame(1000), frame(1001)]))
    monkeypatch.setattr(time, "monotonic", lambda: 150)
    asyncio.run(collector.recv_queued([frame(1002), frame(1003)]))
    assert [timestamp for _, timestamp in state["frames"]] == pytest.approx([0, 1/30, 2/30, 3/30])
