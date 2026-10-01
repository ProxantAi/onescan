"""Validate browser recordings before forwarding to the private analysis API."""
import base64
import binascii
import math

MAX_BYTES = 50 * 1024 * 1024
ALLOWED_MIME = {"video/webm", "video/mp4", "video/quicktime", "video/x-matroska", "video/x-msvideo"}

class BrowserCaptureError(ValueError):
    pass

def decode_capture(event):
    encoded = event.get("video", "")
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
        raise BrowserCaptureError("El video no debe superar 50 MB.")
    try:
        video = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise BrowserCaptureError("No se pudo leer la grabación. Intenta de nuevo.") from exc
    if not video or len(video) > MAX_BYTES:
        raise BrowserCaptureError("Selecciona una grabación válida de hasta 50 MB.")
    mime = str(event.get("mime", "video/webm")).split(";", 1)[0]
    if mime not in ALLOWED_MIME:
        raise BrowserCaptureError("Usa un video MP4, MOV, WebM, MKV o AVI.")
    extension = {"video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/x-msvideo": "avi"}[mime]
    selected = event.get("selected", "compare")
    model = event.get("legacy_model", "efficientphys")
    if selected not in {"compare", "open_rppg", "legacy"} or model not in {"efficientphys", "pos", "chrom"}:
        raise BrowserCaptureError("Selecciona un método de análisis válido.")
    form = {"selected": selected, "legacy_model": model}
    reference = event.get("reference_bpm")
    if reference is not None:
        try:
            reference = float(reference)
        except (TypeError, ValueError) as exc:
            raise BrowserCaptureError("La referencia debe estar entre 30 y 220 latidos/min.") from exc
        if not math.isfinite(reference) or not 30 <= reference <= 220:
            raise BrowserCaptureError("La referencia debe estar entre 30 y 220 latidos/min.")
        form["reference_bpm"] = str(reference)
    return (f"capture.{extension}", video, mime), form

def failure(code, message):
    return {"success": False, "results": [], "error": {"code": code, "message": message}}
