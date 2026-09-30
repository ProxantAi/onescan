"""Authenticated, real-video comparison UI for Proxant Selfie."""
import json
import os
import sys
import time
from pathlib import Path

import requests
import streamlit as st
from streamlit_webrtc import WebRtcMode, webrtc_streamer

sys.path.insert(0, os.getenv("PROXANT_AUTH_HELPER_PATH", "/opt/rppg-toolbox/api"))
from proxant_oidc import render_auth_header, require_proxant_login
from capture import TimedFrameCollector, encode_recording, new_state

API_URL = os.getenv("ONESCAN_API_URL", "http://127.0.0.1:8001")
icon = Path("/opt/rppg-toolbox/assets/proxant-icon.png")
st.set_page_config(page_title="Proxant Selfie · Open Source", page_icon=str(icon) if icon.exists() else "❤️", layout="wide")
require_proxant_login(
    client_id=os.getenv("PROXANT_AUTH_CLIENT_ID", "selfie"),
    client_secret=os.environ["PROXANT_AUTH_CLIENT_SECRET"],
    redirect_uri=os.getenv("PROXANT_AUTH_REDIRECT_URI", "https://selfie.proxant.ai/"),
    issuer=os.getenv("PROXANT_AUTH_ISSUER", "https://auth.proxant.ai"),
    app_label="Proxant Selfie",
)
render_auth_header(issuer=os.getenv("PROXANT_AUTH_ISSUER", "https://auth.proxant.ai"))

st.title("Tu pulso, a través de la cámara")
st.caption("Captura real · Motores open source · Estimaciones experimentales")
st.write("Graba de 20 a 60 segundos con el rostro centrado, luz uniforme y la cabeza quieta. Puedes comparar dos motores usando exactamente el mismo video.")

with st.sidebar:
    st.header("Escaneo")
    selection = st.selectbox("Análisis", ["Comparar ambos motores", "Open-rppg", "Motor original"])
    selected = {"Comparar ambos motores": "compare", "Open-rppg": "open_rppg", "Motor original": "legacy"}[selection]
    legacy_model = st.selectbox("Modelo original", ["efficientphys", "pos", "chrom"], disabled=selected == "open_rppg")
    st.caption("Alternativa: open-rppg / FacePhys. Original: rPPG-Toolbox.")
    use_reference = st.checkbox("Tengo una medición de referencia simultánea")
    reference = st.number_input("Pulso de referencia (latidos/min)", min_value=30.0, max_value=220.0, value=72.0, step=1.0) if use_reference else None
    st.caption("Para evaluar precisión, usa el pulso medido durante el mismo video con un dispositivo de referencia.")
    try:
        health = requests.get(f"{API_URL}/health", timeout=3).json()
        ready = health.get("open_rppg_ready", False)
    except (requests.RequestException, ValueError):
        ready = False
    if ready:
        st.success("Motores disponibles")
    else:
        st.error("El motor se está iniciando o no está disponible. Intenta nuevamente en unos momentos.")

if "capture" not in st.session_state:
    st.session_state.capture = new_state()
state = st.session_state.capture
pending = None
camera, upload = st.tabs(["Grabar con la cámara", "Subir un video"])
with camera:
    st.info("Enciende la cámara, inicia la grabación y deténla después de al menos 20 segundos.")
    webrtc_streamer(
        key="onescan-camera", mode=WebRtcMode.SENDRECV,
        video_processor_factory=lambda: TimedFrameCollector(state),
        media_stream_constraints={"video": {"facingMode": "user", "width": {"ideal": 640}, "height": {"ideal": 480}, "frameRate": {"ideal": 30, "max": 30}}, "audio": False},
        async_processing=True,
    )
    a, b, c, d = st.columns(4)
    if a.button("Iniciar grabación", disabled=state["recording"]):
        with state["lock"]:
            state.update(recording=True, start=time.monotonic(), media_origin=None, frames=[])
        st.session_state.pop("result", None)
        st.rerun()
    if b.button("Detener", disabled=not state["recording"]):
        with state["lock"]:
            state["recording"] = False
        st.rerun()
    if c.button("Analizar grabación", type="primary", disabled=not ready or state["recording"] or not state["frames"]):
        try:
            with state["lock"]:
                frames = list(state["frames"])
            pending = ("camera.mp4", encode_recording(frames), "video/mp4")
        except Exception as exc:
            st.error(str(exc))
    if d.button("Limpiar", disabled=state["recording"]):
        with state["lock"]:
            state["frames"] = []
        st.session_state.pop("result", None)
        st.rerun()

    @st.fragment(run_every=1)
    def capture_status():
        with state["lock"]:
            frames = state["frames"]
            duration = frames[-1][1] - frames[0][1] if len(frames) > 1 else 0
            recording = state["recording"]
        st.caption(f"{'Grabando' if recording else 'Capturado'}: {duration:.1f} segundos")
        if duration >= 20:
            st.success("Ya tienes suficiente video para analizar.")
        elif recording:
            st.progress(min(duration / 20, 1.0))
    capture_status()

with upload:
    uploaded = st.file_uploader("Video del rostro (20–60 segundos, hasta 50 MB)", type=["mp4", "mov", "webm", "mkv", "avi"])
    if uploaded and st.button("Analizar video", type="primary", disabled=not ready):
        if uploaded.size > 50 * 1024 * 1024:
            st.error("El video no debe superar 50 MB.")
        else:
            pending = (uploaded.name, uploaded.getvalue(), uploaded.type or "video/mp4")

if pending:
    st.session_state.pop("result", None)
    with st.spinner("Analizando el rostro y la señal. Comparar ambos motores puede tardar unos minutos…"):
        try:
            form = {"selected": selected, "legacy_model": legacy_model}
            if reference is not None:
                form["reference_bpm"] = str(reference)
            response = requests.post(f"{API_URL}/analyze", files={"video": pending}, data=form, timeout=300)
            if not response.ok:
                detail = response.json().get("detail", "No se pudo completar el escaneo.")
                st.error(detail.get("message", str(detail)) if isinstance(detail, dict) else str(detail))
            else:
                st.session_state.result = response.json()
        except requests.Timeout:
            st.error("El análisis excedió el tiempo de espera. Espera a que termine el servicio antes de repetir.")
        except (requests.RequestException, ValueError):
            st.error("No se pudo contactar al motor. Intenta de nuevo.")

REASONS = {"no_face": "Mantén un solo rostro visible durante todo el escaneo.",
           "multiple_faces": "Repite el escaneo con una sola persona en cámara.",
           "poor_lighting": "Usa una luz uniforme sobre el rostro y vuelve a grabar.",
           "excessive_motion": "Mantén la cabeza quieta y vuelve a grabar.",
           "low_signal_quality": "La señal no es suficiente. Mejora la iluminación y repite el escaneo.",
           "engine_error": "Este motor no pudo completar el análisis. Puedes repetir el escaneo."}

data = st.session_state.get("result")
if data:
    st.header("Resultados")
    columns = st.columns(len(data["results"]))
    for column, item in zip(columns, data["results"]):
        with column:
            st.subheader("Open-rppg" if item["engine"] == "open-rppg" else "Motor original")
            st.caption(item["model_used"])
            if not item["accepted"]:
                st.warning(REASONS.get(item["reason"], "Repite el escaneo."))
                continue
            st.metric("Pulso estimado", f"{item['heart_rate_bpm']:.1f} latidos/min")
            hrvs = item["hrv"]
            m1, m2 = st.columns(2)
            for target, label, key in ((m1, "Variabilidad · RMSSD", "rmssd_ms"), (m2, "Variabilidad · SDNN", "sdnn_ms")):
                value = hrvs.get(key)
                target.metric(label, f"{value:.1f} ms" if value is not None else "No disponible")
            if item["bvp_waveform"]:
                st.line_chart({"Señal de pulso": item["bvp_waveform"]})
            st.caption(f"Procesamiento: {item['processing_seconds']:.1f} s")
            for warning in item["warnings"]:
                st.warning(warning)
    comparison = data["comparison"]
    if comparison["difference_bpm"] is not None:
        st.write(f"Diferencia entre motores: **{comparison['difference_bpm']:.1f} latidos/min**.")
    if comparison["reference_errors"]:
        st.table(comparison["reference_errors"])
    st.caption(comparison["note"])
    st.download_button("Descargar resultados JSON", json.dumps(data, ensure_ascii=False, indent=2), "onescan-result.json", "application/json")
    with st.expander("Calidad de la captura y detalles"):
        st.json({"video": data["video"], "capture_quality": data["capture_quality"],
                 "signals": [{"engine": item["engine"], "quality": item["quality"]} for item in data["results"]]})
