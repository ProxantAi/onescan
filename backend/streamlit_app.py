"""Proxant-authenticated mobile UI; camera preview and recording stay in-browser."""
import os
import sys
from pathlib import Path
import requests
import streamlit as st
import streamlit.components.v1 as components
from ui_bridge import BrowserCaptureError, decode_capture, failure

sys.path.insert(0, os.getenv("PROXANT_AUTH_HELPER_PATH", "/opt/rppg-toolbox/api"))
from proxant_oidc import require_proxant_login

API_URL = os.getenv("ONESCAN_API_URL", "http://127.0.0.1:8001")
ROOT = Path(__file__).resolve().parent
st.set_page_config(page_title="Proxant Selfie", page_icon="❤️", layout="wide")
st.markdown("""<style>
html,body,[data-testid="stAppViewContainer"],.stApp{background:#e9eef5;color:#0f1b33}
[data-testid="stHeader"],[data-testid="stToolbar"],#MainMenu,footer{display:none}
[data-testid="stMainBlockContainer"]{padding:0!important;max-width:100%!important}
[data-testid="stVerticalBlock"]{gap:0}
[data-testid="stElementContainer"]:has(iframe){margin:0}
iframe{display:block;border:0}
</style>""", unsafe_allow_html=True)
user = require_proxant_login(
    client_id=os.getenv("PROXANT_AUTH_CLIENT_ID", "selfie"),
    client_secret=os.environ["PROXANT_AUTH_CLIENT_SECRET"],
    redirect_uri=os.getenv("PROXANT_AUTH_REDIRECT_URI", "https://selfie.proxant.ai/"),
    issuer=os.getenv("PROXANT_AUTH_ISSUER", "https://auth.proxant.ai"),
    app_label="Proxant Selfie",
)

@st.cache_data(ttl=15)
def api_ready():
    try:
        response = requests.get(f"{API_URL}/health", timeout=3)
        return response.ok and response.json().get("open_rppg_ready", False)
    except (requests.RequestException, ValueError):
        return False

capture_app = components.declare_component("selfie_mobile", path=str(ROOT / "frontend"))
event = capture_app(
    ready=api_ready(), user_name=str((user or {}).get("name") or "Mi cuenta"),
    result=st.session_state.get("result"), response_id=st.session_state.get("response_id"),
    default=None, key="selfie-mobile-app",
)
if isinstance(event, dict) and isinstance(event.get("id"), str) and event["id"] and len(event["id"]) <= 100 and event["id"] != st.session_state.get("handled_event"):
    event_id = str(event.get("id", ""))[:100]
    st.session_state.handled_event = event_id
    action = event.get("action")
    if action == "logout":
        for key in ("proxant_user", "proxant_tokens", "proxant_oauth_url", "result", "response_id"):
            st.session_state.pop(key, None)
        st.query_params.clear()
        st.rerun()
    elif action == "reset":
        st.session_state.pop("result", None)
        st.session_state.pop("response_id", None)
        st.rerun()
    elif action == "analyze":
        try:
            video, form = decode_capture(event)
            response = requests.post(f"{API_URL}/analyze", files={"video": video}, data=form, timeout=300)
            if response.ok:
                data = response.json()
            else:
                detail = response.json().get("detail", "No se pudo completar el análisis.")
                data = failure(detail.get("code", "analysis_error"), detail.get("message", "Intenta de nuevo.")) if isinstance(detail, dict) else failure("busy" if response.status_code == 429 else "unavailable" if response.status_code >= 500 else "invalid_video", str(detail))
        except BrowserCaptureError as exc:
            data = failure("invalid_video", str(exc))
        except requests.Timeout:
            data = failure("timeout", "El análisis está tardando demasiado. Espera un momento antes de repetir.")
        except (requests.RequestException, ValueError):
            data = failure("unavailable", "No se pudo contactar al análisis. Intenta nuevamente en unos momentos.")
        st.session_state.result = data
        st.session_state.response_id = event_id
        st.rerun()
