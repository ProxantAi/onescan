"""Opt-in full filtered BVP for OneScan; existing clients keep a reduced trace.

Call with the original rPPG-Toolbox repository root. Both exact source edits are
compiled/checked before either is written, with reversible backups.
"""
import argparse
from pathlib import Path
import shutil


def patches(root):
    return {
        root / "api/main.py": [
            ("from api.pipeline.biomarkers import (", "from api.pipeline.biomarkers import (\n    _prepare_bvp_for_metrics,"),
            ("    video: UploadFile = File(..., description=\"Selfie video (20–60 s, face visible)\"),",
             "    video: UploadFile = File(..., description=\"Selfie video (20–60 s, face visible)\"),\n    include_full_bvp: bool = Query(False, description=\"Include filtered BVP for interval analysis\"),"),
            ("        bvp_waveform=downsample_bvp_for_response(bvp),",
             "        bvp_waveform=downsample_bvp_for_response(bvp),\n        bvp_full=_prepare_bvp_for_metrics(bvp, fs).tolist() if include_full_bvp else None,")],
        root / "api/models/schemas.py": [
            ('    bvp_waveform: List[float] = Field(..., description="Downsampled BVP/rPPG signal")',
             '    bvp_waveform: List[float] = Field(..., description="Downsampled BVP/rPPG signal")\n    bvp_full: Optional[List[float]] = Field(None, description="Opt-in full filtered BVP at video.target_fps")')],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    args = parser.parse_args()
    writes = []
    for path, edits in patches(args.root).items():
        original = path.read_text()
        source = original
        for old, new in edits:
            if old == new or new in source:
                continue
            if source.count(old) != 1:
                raise SystemExit(f"Unexpected original source in {path}; inspect before patching")
            source = source.replace(old, new)
        if source != original:
            compile(source, str(path), "exec")
            backup = path.with_suffix(".py.before-onescan-full-signal")
            if backup.exists():
                raise SystemExit(f"Backup already exists: {backup}")
            writes.append((path, source, backup))
    for path, source, backup in writes:
        shutil.copy2(path, backup)
        path.write_text(source)
        print(f"Patched {path}; backup {backup}")
    if not writes:
        print("Full-signal support is already installed")


if __name__ == "__main__":
    main()
