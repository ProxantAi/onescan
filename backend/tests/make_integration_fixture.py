"""Synthetic fixture, not a patient recording or an accuracy benchmark.

Uses scikit-image's bundled public-domain NASA astronaut photograph.
The color modulation is controlled input; no physiological ground truth exists.
"""
from fractions import Fraction
from pathlib import Path
import argparse

import av
import cv2
import numpy as np
from skimage import data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    image = cv2.resize(data.astronaut(), (320, 320)).astype(np.float32)
    with av.open(str(args.output), "w") as container:
        stream = container.add_stream("mpeg4", rate=30)
        stream.width = stream.height = 320
        stream.pix_fmt = "yuv420p"
        stream.codec_context.bit_rate = 12_000_000
        stream.codec_context.gop_size = 1
        for index in range(600):
            modulated = image.copy()
            modulated[:, :, 1] += 5 * np.sin(2 * np.pi * 1.2 * index / 30)
            frame = av.VideoFrame.from_ndarray(np.clip(modulated, 0, 255).astype(np.uint8), "rgb24")
            frame.pts, frame.time_base = index, Fraction(1, 30)
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


if __name__ == "__main__":
    main()
