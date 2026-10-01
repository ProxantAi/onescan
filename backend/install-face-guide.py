"""Fetch pinned browser assets before serving frontend; no runtime CDN requests."""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent / "frontend/vendor/mediapipe"
PACKAGE_URL = "https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz"
PACKAGE_SHA = "ee318eaa3d42230aa10910d114faf2a488c577c4e4d33c7cb04126924aca505f"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
MODEL_SHA = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
FILES = ["vision_bundle.mjs", "wasm/vision_wasm_internal.js", "wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_nosimd_internal.js", "wasm/vision_wasm_nosimd_internal.wasm"]

def fetch(url, expected):
    with urllib.request.urlopen(url, timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError(f"Asset integrity mismatch: {url}")
    return data

def install():
    archive = tarfile.open(fileobj=io.BytesIO(fetch(PACKAGE_URL, PACKAGE_SHA)), mode="r:gz")
    assets = {name: archive.extractfile(f"package/{name}").read() for name in FILES}
    assets["face_landmarker.task"] = fetch(MODEL_URL, MODEL_SHA)
    for name, data in assets.items():
        target = ROOT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(target)
    (ROOT / "MANIFEST.json").write_text(json.dumps({"package":"@mediapipe/tasks-vision", "version":"1.0.1", "package_sha256":PACKAGE_SHA, "model_version":1, "files":{name:hashlib.sha256(data).hexdigest() for name,data in assets.items()}}, indent=2)+"\n")
    print(f"Installed {len(assets)} verified assets in {ROOT}")

if __name__ == "__main__":
    install()
