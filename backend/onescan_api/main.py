"""Loopback-only API, consumed by the authenticated Streamlit application."""
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from tempfile import TemporaryDirectory
import logging
import threading
from typing import Literal

import av

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from .engines import OpenRppgEngine, analyze_legacy, comparison, result
from .video import CaptureError, MAX_UPLOAD_BYTES, face_quality, inspect_video, normalize_video

logger = logging.getLogger(__name__)
engine = None
load_error = None
processing_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global engine, load_error
    try:
        engine = await run_in_threadpool(OpenRppgEngine)
    except Exception:
        logger.exception("open-rppg initialization failed")
        load_error = "No se pudo cargar el motor open-rppg. Revisa los logs del servicio."
    yield


app = FastAPI(title="OneScan Open Source", version="0.2.0", lifespan=lifespan)


@app.middleware("http")
async def upload_limit(request, call_next):
    length = request.headers.get("content-length")
    if length:
        try:
            oversized = int(length) > MAX_UPLOAD_BYTES + 1024 * 1024
        except ValueError:
            return JSONResponse({"detail": "Invalid content-length"}, status_code=400)
        if oversized:
            return JSONResponse({"detail": "El video no debe superar 50 MB."}, status_code=413)
    return await call_next(request)


@app.get("/health")
def health():
    return {"status": "ok" if engine is not None else "degraded", "open_rppg_ready": engine is not None,
            "open_model": "FacePhys.rlap", "legacy_backend": "rPPG-Toolbox", "busy": processing_lock.locked(),
            "error": load_error}


def analyze(path, selected, legacy_model, reference):
    try:
        info = inspect_video(path)
        normalized = path.parent / "normalized.mp4"
        normalize_video(path, normalized, info)
        if engine is None:
            raise HTTPException(503, detail=load_error or "El motor se está iniciando.")
        quality = face_quality(normalized, engine.detector)
        outputs = []
        providers = []
        if selected in ("compare", "open_rppg"):
            providers.append(("open-rppg", "FacePhys.rlap", lambda: engine.analyze(normalized)))
        if selected in ("compare", "legacy"):
            providers.append(("rPPG-Toolbox", legacy_model, lambda: analyze_legacy(normalized, legacy_model)))
        for name, model, provider in providers:
            if not quality["accepted"]:
                output = result(name, model)
                output["reason"] = quality["reason"]
            else:
                try:
                    output = provider()
                except Exception:
                    logger.exception("Engine failed: %s", name)
                    output = result(name, model)
                    output["reason"] = "engine_error"
                    output["warnings"] = ["El motor no pudo completar el análisis. Repite o revisa el servicio."]
            outputs.append(output)
        return {"success": any(output["accepted"] for output in outputs), "source": "camera_video",
                "video": asdict(info), "capture_quality": quality, "results": outputs,
                "variability_window": {"duration_sec": info.duration_sec,
                                       "status": "experimental_short_window" if info.duration_sec < 45 else "experimental",
                                       "note": "Variabilidad de pulso de cámara (PRV); no equivale automáticamente a HRV de ECG."},
                "comparison": comparison(outputs, reference),
                "unavailable_metrics": ["blood_pressure", "spo2", "hba1c"],
                "validation_status": "experimental_not_clinically_validated"}
    except CaptureError as exc:
        raise HTTPException(422, detail={"code": exc.code, "message": str(exc)}) from exc
    except (av.error.FFmpegError, ValueError, StopIteration) as exc:
        raise HTTPException(422, detail={"code": "invalid_video", "message": "No se pudo leer el video. Usa MP4, MOV o WebM."}) from exc
    finally:
        processing_lock.release()


@app.post("/analyze")
async def analyze_video(video: UploadFile = File(...),
                        selected: Literal["compare", "open_rppg", "legacy"] = Form("compare"),
                        legacy_model: Literal["efficientphys", "pos", "chrom"] = Form("efficientphys"),
                        reference_bpm: float | None = Form(None, ge=30, le=220)):
    if not processing_lock.acquire(blocking=False):
        raise HTTPException(429, detail="Hay un escaneo en proceso. Intenta de nuevo cuando termine.")
    delegated = False
    try:
        with TemporaryDirectory(prefix="onescan-") as directory:
            path = Path(directory) / "upload.video"
            size = 0
            with path.open("wb") as target:
                while chunk := await video.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, detail="El video no debe superar 50 MB.")
                    target.write(chunk)
            if not size:
                raise HTTPException(422, detail="Selecciona un video.")
            delegated = True
            return await run_in_threadpool(analyze, path, selected, legacy_model, reference_bpm)
    finally:
        await video.close()
        if not delegated:
            processing_lock.release()
