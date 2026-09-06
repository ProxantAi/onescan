/**
 * Proxant Auth (OIDC + PKCE) gate for OneScan static SPA.
 */
const AUTH = {
  issuer: "https://auth.proxant.ai",
  clientId: "onescan",
  redirectUri: `${window.location.origin}/`,
  storageKey: "proxant_onescan_auth",
  pkceKey: "proxant_onescan_pkce",
};

function b64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

async function makePkce() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(raw);
  const challenge = b64url(await sha256(verifier));
  return { verifier, challenge };
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(AUTH.storageKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.access_token || !data?.user) return null;
    if (data.expires_at && Date.now() > data.expires_at) {
      sessionStorage.removeItem(AUTH.storageKey);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function saveSession(tokens, user) {
  const expires_at = Date.now() + (tokens.expires_in || 3600) * 1000 - 30_000;
  sessionStorage.setItem(
    AUTH.storageKey,
    JSON.stringify({ ...tokens, user, expires_at }),
  );
}

function clearSession() {
  sessionStorage.removeItem(AUTH.storageKey);
  sessionStorage.removeItem(AUTH.pkceKey);
}

async function startLogin() {
  const pkce = await makePkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(
    AUTH.pkceKey,
    JSON.stringify({ verifier: pkce.verifier, state }),
  );
  const redirectUri = AUTH.redirectUri;
  const q = new URLSearchParams({
    client_id: AUTH.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${AUTH.issuer}/oauth/authorize?${q}`;
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  if (!code && !error) return false;

  if (error) {
    clearSession();
    alert(`Login rechazado: ${error}`);
    history.replaceState({}, "", window.location.pathname);
    return true;
  }

  const pkceRaw = sessionStorage.getItem(AUTH.pkceKey);
  const pkce = pkceRaw ? JSON.parse(pkceRaw) : null;
  if (!pkce || pkce.state !== state) {
    alert("State OAuth inválido. Vuelve a iniciar sesión.");
    clearSession();
    history.replaceState({}, "", window.location.pathname);
    return true;
  }

  const redirectUri = AUTH.redirectUri;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: AUTH.clientId,
    code_verifier: pkce.verifier,
  });

  const tokenRes = await fetch(`${AUTH.issuer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    alert(`No se pudo completar el login: ${detail}`);
    clearSession();
    history.replaceState({}, "", window.location.pathname);
    return true;
  }
  const tokens = await tokenRes.json();
  const userRes = await fetch(`${AUTH.issuer}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = userRes.ok
    ? await userRes.json()
    : { name: "Usuario", email: "" };
  saveSession(tokens, user);
  sessionStorage.removeItem(AUTH.pkceKey);
  history.replaceState({}, "", window.location.pathname);
  return true;
}

function mountUserMenu(user) {
  const helpBtn = document.querySelector('.appbar__icon[aria-label="Ayuda"]');
  if (!helpBtn || document.getElementById("proxant-user-menu")) return;

  const wrap = document.createElement("div");
  wrap.id = "proxant-user-menu";
  wrap.style.cssText =
    "position:relative;display:flex;align-items:center;margin-left:auto;";
  wrap.innerHTML = `
    <button type="button" id="proxant-user-btn" style="
      border:1px solid #dbe3f0;background:#fff;color:#0f172a;font:600 13px Inter,system-ui,sans-serif;
      border-radius:10px;padding:6px 10px;cursor:pointer;max-width:9.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      ${user.name || user.email || "Cuenta"}
    </button>
    <div id="proxant-user-dropdown" hidden style="
      position:absolute;right:0;top:calc(100% + 6px);width:220px;background:#fff;border:1px solid #e2e8f0;
      border-radius:12px;box-shadow:0 8px 24px rgba(15,23,42,.12);z-index:50;overflow:hidden;font:14px Inter,system-ui,sans-serif">
      <div style="padding:10px 12px;border-bottom:1px solid #f1f5f9">
        <div style="font-weight:600;color:#0f172a">${user.name || "—"}</div>
        <div style="font-size:12px;color:#64748b">${user.email || ""}</div>
      </div>
      <a href="${AUTH.issuer}/account" target="_blank" rel="noopener" style="display:block;padding:10px 12px;color:#334155;text-decoration:none">Mi cuenta</a>
      <button type="button" id="proxant-logout" style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:#fff;color:#334155;cursor:pointer">Cerrar sesión</button>
    </div>`;
  helpBtn.replaceWith(wrap);

  const btn = wrap.querySelector("#proxant-user-btn");
  const dd = wrap.querySelector("#proxant-user-dropdown");
  btn.addEventListener("click", () => {
    dd.hidden = !dd.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) dd.hidden = true;
  });
  wrap.querySelector("#proxant-logout").addEventListener("click", () => {
    clearSession();
    window.location.reload();
  });
}

function showLoginGate() {
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(ellipse at top,#dbe7ff 0%,transparent 50%),linear-gradient(180deg,#f7f9fd,#eef3fb);
      font-family:Inter,system-ui,sans-serif;padding:24px">
      <div style="width:100%;max-width:380px;background:#fff;border:1px solid #dbe3f0;border-radius:16px;padding:28px;text-align:center">
        <img src="./assets/img/proxant-logo.png" alt="Proxant" style="height:48px;margin-bottom:16px" onerror="this.style.display='none'"/>
        <h1 style="margin:0 0 8px;font-size:1.35rem;color:#0f172a">Inicia sesión</h1>
        <p style="margin:0 0 20px;color:#64748b;font-size:.9rem">Inicia sesión con tu cuenta Proxant Auth</p>
        <button id="proxant-login-btn" type="button" style="
          width:100%;background:#1D46AD;color:#fff;border:0;border-radius:10px;padding:12px 16px;
          font-weight:600;font-size:.95rem;cursor:pointer">Iniciar sesión</button>
      </div>
    </div>`;
  document.getElementById("proxant-login-btn").addEventListener("click", () => {
    startLogin();
  });
}

export async function requireProxantAuth() {
  await handleCallback();
  const session = loadSession();
  if (session?.user) {
    // Wait a tick so DOM from index.html exists when app.js continues
    queueMicrotask(() => mountUserMenu(session.user));
    // Also try after short delay (DOM ready)
    setTimeout(() => mountUserMenu(session.user), 50);
    return session;
  }
  showLoginGate();
  return null;
}
