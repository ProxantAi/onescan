import { APP_CONFIG } from "../../app-config.js";

const urlParams = new URLSearchParams(window.location.search);
const API_KEY = urlParams.get("apiKey") || APP_CONFIG.API_KEY;
const USER_ID = APP_CONFIG.USER_ID || "";

// Modo de funcionamiento:
//  - Por defecto: SIMULADO. Usa la cámara real (videoselfie) pero no depende de
//    un backend; genera resultados plausibles localmente.
//  - Con ?real=1 en la URL: usa el motor de videobiometría real.
const REAL_MODE = urlParams.has("real");
// Duración de la medición en segundos (configurable con ?dur=).
const SIM_DURATION = Math.max(6, Number(urlParams.get("dur")) || 30);

let engine = null;
let initialized = false;
let simState = null;

const $ = (id) => document.getElementById(id);
const RING_LEN = 2 * Math.PI * 19; // circunferencia del anillo de score

// ---------------------------------------------------------------------------
// Iconos y definición de métricas (igual al diseño de la app)
// ---------------------------------------------------------------------------
const ICONS = {
  heart: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 20s-6-3.7-8.5-7.3C2 10.4 3.2 7.5 6 7.5c1.7 0 2.8.9 3.9 2.3C11 8.4 12 7.5 12 7.5s1 .9 2.1 2.3C16.2 8.4 17.3 7.5 19 7.5c2.8 0 4 2.9 2.5 5.2C19 16.3 12 20 12 20z" fill="${c}"/></svg>`,
  pulse: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M3 12h3l2-5 3.5 10L15 9l1.5 3H21" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  drop: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17"><path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z" fill="${c}"/></svg>`,
  wind: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M3 8h9a2.3 2.3 0 1 0-2.3-2.3M3 16h13a2.3 2.3 0 1 1-2.3 2.3M3 12h7" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`,
  bars: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M6 20v-7M12 20V6M18 20v-5" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  voice: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M4 12h1.5M8 9v6M11.5 5.5v13M15 9v6M18.5 11v2" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`,
  hexa: (c) =>
    `<svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M12 3l7 4v8l-7 4-7-4V7l7-4z" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M12 8v4l3 1.5" stroke="${c}" stroke-width="2" stroke-linecap="round"/></svg>`,
};

const METRICS = [
  { key: "hr", label: "Frecuencia<br>Cardíaca", unit: "lpm", color: "#FF5C6C", icon: "heart" },
  { key: "hrv", label: "Variabilidad<br>(HRV)", unit: "ms", color: "#2D9CDB", icon: "pulse" },
  { key: "bp", label: "Presión<br>Arterial", unit: "mmHg", color: "#F2994A", icon: "drop" },
  { key: "resp", label: "Frecuencia<br>Respiratoria", unit: "rpm", color: "#EC6A9C", icon: "wind" },
  { key: "spo2", label: "Saturación<br>de Oxígeno", unit: "%", color: "#2BA8E0", icon: "drop" },
  { key: "stress", label: "Estrés<br>Simpático", unit: "Índice", color: "#13B6A2", icon: "bars", tag: "Bajo" },
  { key: "voice", label: "Análisis<br>de Voz", unit: "Estado", color: "#7C6CF0", icon: "voice", tag: "Óptimo" },
  { key: "hba1c", label: "HbA1c*", unit: "%", color: "#9B6CF0", icon: "hexa", tag: "Óptimo" },
];

const rand = (min, max) => Math.random() * (max - min) + min;
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const stripBr = (s) => s.replace(/<br>/g, " ");

// ---------------------------------------------------------------------------
// Navegación entre pantallas + tabbar
// ---------------------------------------------------------------------------
const SCREEN_TO_TAB = { landing: "landing", scan: "scan", results: "results" };
function showScreen(name) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("screen--active"));
  $("screen-" + name).classList.add("screen--active");
  document.querySelector(".app__body").scrollTop = 0;
  setActiveTab(SCREEN_TO_TAB[name]);
}
function setActiveTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.dataset.tab === tab && !t.classList.contains("tab--cta"));
  });
}

function showSetupError(text) {
  $("setup-error-text").innerHTML = text;
  $("setup-error").classList.add("is-visible");
}

// ---------------------------------------------------------------------------
// Render de tiles e ítems de resumen
// ---------------------------------------------------------------------------
function renderLandingList() {
  const sample = [
    { m: METRICS[0], v: "Normal" },
    { m: METRICS[2], v: "Normal" },
    { m: METRICS[7], v: "Óptimo" },
  ];
  $("landing-list").innerHTML = sample
    .map(
      ({ m, v }) => `
      <li>
        <span class="chip" style="background:${rgba(m.color, 0.14)};color:${m.color}">
          ${ICONS[m.icon](m.color)}
        </span>
        ${stripBr(m.label)}
        <span class="tag">${v}</span>
      </li>`
    )
    .join("");
}

function buildMetricTiles() {
  $("metrics-grid").innerHTML = METRICS.map(
    (m) => `
    <div class="tile" id="tile-${m.key}">
      <span class="tile__icon" style="background:${rgba(m.color, 0.14)};color:${m.color}">
        ${ICONS[m.icon](m.color)}
      </span>
      <span class="tile__label">${m.label}</span>
      <span class="tile__value" id="tileval-${m.key}" style="opacity:.35">–</span>
      <span class="tile__unit">${m.unit}</span>
      <span class="tile__tag">${m.tag || "Normal"}</span>
    </div>`
  ).join("");
}

function fillTile(key, value) {
  const v = $("tileval-" + key);
  if (v) {
    v.textContent = value;
    v.style.opacity = "1";
  }
  $("tile-" + key)?.classList.add("is-filled");
}

function valueFor(key, r) {
  switch (key) {
    case "hr": return r.hr;
    case "hrv": return r.hrv;
    case "bp": return r.bp;
    case "resp": return r.resp;
    case "spo2": return r.spo2;
    case "stress": return r.stress;
    case "voice": return r.voice;
    case "hba1c": return r.hba1c;
    default: return "–";
  }
}

function renderSummary(r) {
  // anillos de score
  const off = RING_LEN * (1 - r.score / 100);
  $("score-num").textContent = r.score;
  $("score-num-2").textContent = r.score;
  $("ring-fg").style.strokeDashoffset = off;
  $("ring-fg-2").style.strokeDashoffset = off;
  $("summary-status").textContent = "Óptimo";

  $("result-list").innerHTML = METRICS.map((m) => {
    const val = valueFor(m.key, r);
    const unit = m.unit === "Estado" || m.unit === "Índice" ? "" : m.unit;
    return `
      <li>
        <span class="chip" style="background:${rgba(m.color, 0.14)};color:${m.color}">
          ${ICONS[m.icon](m.color)}
        </span>
        <span class="rl-label">${stripBr(m.label)}</span>
        <span class="rl-right">
          <span class="rl-value">${val}${unit ? `<small>${unit}</small>` : ""}</span>
          <span class="tag">${m.tag || "Normal"}</span>
        </span>
      </li>`;
  }).join("");
}

function genResults() {
  const hr = Math.round(rand(68, 78));
  const sys = Math.round(rand(116, 124));
  const dia = Math.round(rand(72, 80));
  return {
    hr,
    hrv: Math.round(rand(40, 58)),
    bp: `${sys}/${dia}`,
    resp: Math.round(rand(14, 17)),
    spo2: Math.round(rand(96, 99)),
    stress: Math.round(rand(26, 40)),
    voice: "Bien",
    hba1c: rand(5.2, 5.6).toFixed(1),
    score: Math.round(rand(85, 92)),
  };
}

// ---------------------------------------------------------------------------
// MEDICIÓN SIMULADA — videoselfie real + métricas generadas localmente
// ---------------------------------------------------------------------------
async function startSimCamera() {
  const video = $("sim-video");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    simState.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => {});
  } catch (e) {
    console.warn("Cámara no disponible; se continúa sin video.");
  }
}

async function startSimulatedMeasurement() {
  if (simState) stopCamera(); // reinicio limpio si ya había una medición
  const cam = $("camera-frame");
  cam.classList.add("camera--sim");
  cam.classList.remove("camera--locked", "camera--measuring");
  buildMetricTiles();

  $("status-value").textContent = "Midiendo…";
  $("status-hint").textContent = "Mantente quieto unos segundos.";
  $("metrics-mode").classList.remove("is-final");
  $("metrics-mode").lastChild.textContent = "En tiempo real";
  $("score-num").textContent = "--";
  $("ring-fg").style.strokeDashoffset = RING_LEN;
  $("btn-summary").disabled = true;
  $("scan-timer").textContent = formatTime(SIM_DURATION);

  showScreen("scan");
  setActiveTab("scan");

  simState = {
    results: genResults(),
    timers: [],
    revealed: {},
    startTs: 0,
    currentHr: 0,
  };

  await startSimCamera();
  if (!simState) return;

  // pequeño retardo: "detectando rostro"
  const t = setTimeout(() => {
    $("camera-frame").classList.add("camera--locked");
    beginSimMeasuring();
  }, 1400);
  simState.timers.push(t);
}

function formatTime(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return `00:${s.toString().padStart(2, "0")}`;
}

// orden de aparición de las métricas durante el escaneo (en fracción de avance)
const REVEAL_AT = {
  hr: 0.1,
  hrv: 0.25,
  bp: 0.38,
  resp: 0.5,
  spo2: 0.62,
  stress: 0.74,
  voice: 0.85,
  hba1c: 0.94,
};

function beginSimMeasuring() {
  if (!simState) return;
  simState.startTs = performance.now();
  $("camera-frame").classList.add("camera--measuring");
  startFaceMesh();
  startPpg();
  const durMs = SIM_DURATION * 1000;
  const r = simState.results;

  const tick = () => {
    if (!simState) return;
    const elapsed = performance.now() - simState.startTs;
    const p = Math.min(1, elapsed / durMs);

    $("scan-timer").textContent = formatTime((durMs - elapsed) / 1000);

    // FC en vivo: ruido inicial que converge al valor final
    const noise = (1 - p) * 8;
    const live = r.hr + (Math.random() - 0.5) * 2 * noise + Math.sin(elapsed / 480) * (1 - p) * 3;
    simState.currentHr = live;
    if (p > 0.1) {
      const hrEl = $("tileval-hr");
      if (hrEl) {
        hrEl.textContent = Math.round(live);
        hrEl.style.opacity = "1";
      }
      $("tile-hr")?.classList.add("is-filled");
    }

    // revelar las demás métricas progresivamente
    for (const [key, at] of Object.entries(REVEAL_AT)) {
      if (key !== "hr" && p >= at && !simState.revealed[key]) {
        simState.revealed[key] = true;
        fillTile(key, valueFor(key, r));
      }
    }

    if (p >= 1) return finishSimMeasurement();
    simState.timers.push(setTimeout(tick, 200));
  };
  tick();
}

function finishSimMeasurement() {
  if (!simState) return;
  const r = simState.results;
  fillTile("hr", r.hr);
  $("scan-timer").textContent = "00:00";
  $("metrics-mode").classList.add("is-final");
  $("metrics-mode").lastChild.textContent = "Resultado";
  $("status-value").textContent = "Óptimo";
  $("status-hint").textContent = "Sigue con tus buenos hábitos.";

  const off = RING_LEN * (1 - r.score / 100);
  $("score-num").textContent = r.score;
  requestAnimationFrame(() => ($("ring-fg").style.strokeDashoffset = off));

  $("btn-summary").disabled = false;
  // Detenemos las animaciones de escaneo pero dejamos la cámara encendida
  // para que el usuario siga viéndose mientras revisa el resultado.
  $("camera-frame").classList.remove("camera--measuring");
  stopSimAnim();
}

// Cancela timers y bucles de animación (mesh + PPG), sin apagar la cámara.
function stopSimAnim() {
  if (!simState) return;
  simState.timers.forEach(clearTimeout);
  simState.timers = [];
  if (simState.rafMesh) cancelAnimationFrame(simState.rafMesh);
  if (simState.rafPpg) cancelAnimationFrame(simState.rafPpg);
  simState.rafMesh = simState.rafPpg = null;
}

// Apaga por completo la cámara y las animaciones.
function stopCamera() {
  stopSimAnim();
  const stream = simState?.stream;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const video = $("sim-video");
  if (video.pause) video.pause();
  video.srcObject = null;
}

// ---------------------------------------------------------------------------
// Malla facial animada (efecto de escaneo sobre el rostro)
// ---------------------------------------------------------------------------
function startFaceMesh() {
  const canvas = $("face-mesh");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320;
  const H = canvas.clientHeight || 420;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // centro y radios del óvalo (coinciden con el SVG guía: cx150 cy178 rx96 ry126 en 300x400)
  const cx = W * 0.5;
  const cy = H * (178 / 400);
  const rx = W * (96 / 300);
  const ry = H * (126 / 400);

  // puntos de la malla, distribuidos en anillos concéntricos dentro del óvalo
  const RINGS = 6;
  const rings = [];
  for (let i = 1; i <= RINGS; i++) {
    const f = i / RINGS;
    const n = 4 + i * 3;
    const arr = [];
    for (let k = 0; k < n; k++) {
      arr.push({ a: (k / n) * Math.PI * 2 + i * 0.4, f });
    }
    rings.push(arr);
  }

  const t0 = performance.now();
  const draw = (now) => {
    if (!simState) return;
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    // posición de la línea de barrido (de arriba a abajo del óvalo)
    const scanY = cy - ry + (Math.sin(t * 1.6) * 0.5 + 0.5) * 2 * ry;

    const pos = rings.map((ring) =>
      ring.map((p) => {
        const j = 1 + Math.sin(t * 2.2 + p.a * 3) * 0.02;
        return {
          x: cx + Math.cos(p.a) * rx * p.f * j,
          y: cy + Math.sin(p.a) * ry * p.f * j,
          a: p.a,
        };
      })
    );

    // líneas de la malla
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(70,220,205,0.16)";
    for (let i = 0; i < pos.length; i++) {
      const ring = pos[i];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      if (i > 0) {
        const inner = pos[i - 1];
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k];
          const idx = Math.round((a.a / (Math.PI * 2)) * inner.length) % inner.length;
          const b = inner[(idx + inner.length) % inner.length];
          if (b) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    // nodos (más brillantes cerca de la línea de barrido)
    for (const ring of pos) {
      for (const p of ring) {
        const prox = 1 - Math.min(1, Math.abs(p.y - scanY) / (ry * 0.45));
        const g = Math.max(0, prox);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2 + 2 * g, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,235,215,${0.3 + 0.6 * g})`;
        ctx.fill();
      }
    }

    simState.rafMesh = requestAnimationFrame(draw);
  };
  simState.rafMesh = requestAnimationFrame(draw);
}

// ---------------------------------------------------------------------------
// Pletismografía (PPG) en tiempo real debajo del video
// ---------------------------------------------------------------------------
function ppgWave(t) {
  const systolic = Math.exp(-Math.pow((t - 0.18) / 0.1, 2));
  const dicrotic = 0.32 * Math.exp(-Math.pow((t - 0.46) / 0.12, 2));
  return systolic + dicrotic - 0.14;
}

function startPpg() {
  const canvas = $("ppg-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 400;
  const H = canvas.clientHeight || 64;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const N = Math.max(160, Math.floor(W));
  const data = new Array(N).fill(H / 2);
  let phase = 0;
  let last = performance.now();

  const draw = (now) => {
    if (!simState) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const hr = simState.currentHr > 0 ? simState.currentHr : 72;
    phase += (hr / 60) * dt;
    data.push(H / 2 - ppgWave(phase % 1) * (H * 0.34));
    if (data.length > N) data.shift();

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#34e3c4";
    ctx.shadowColor = "rgba(52,227,196,0.8)";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / N) * W;
      i === 0 ? ctx.moveTo(x, data[i]) : ctx.lineTo(x, data[i]);
    }
    ctx.stroke();
    simState.rafPpg = requestAnimationFrame(draw);
  };
  simState.rafPpg = requestAnimationFrame(draw);
}

// ---------------------------------------------------------------------------
// MEDICIÓN REAL (motor de videobiometría, modo ?real=1)
// ---------------------------------------------------------------------------
async function loadEngine() {
  try {
    const mod = await import("../../shenai-sdk/index.mjs");
    engine = await mod.default();
    window.__engine = engine;
    return true;
  } catch (e) {
    showSetupError(
      "No se pudo cargar el <strong>motor de análisis</strong>.<br/><br/>" +
        "Coloca los binarios del motor en esta carpeta como <code>shenai-sdk</code> " +
        "y recarga la página, o usa el modo demostración (sin <code>?real=1</code>)."
    );
    return false;
  }
}

function startRealMeasurement() {
  if (!engine) return;
  if (!API_KEY) {
    showSetupError(
      "Falta la <strong>clave de activación</strong>.<br/><br/>" +
        "Edita <code>app-config.js</code> y coloca tu clave, o agrégala a la URL " +
        "como <code>?apiKey=TU_CLAVE</code>."
    );
    return;
  }

  const cam = $("camera-frame");
  cam.classList.add("camera--real");
  buildMetricTiles();
  showScreen("scan");
  setActiveTab("scan");

  const settings = {
    language: "es",
    hideShenaiLogo: true,
    showUserInterface: true,
    showFacePositioningOverlay: true,
    showVisualWarnings: true,
    enableSummaryScreen: false,
    enableStartAfterSuccess: false,
    measurementPreset: engine.MeasurementPreset.THIRTY_SECONDS_ALL_METRICS,
    onboardingMode: engine.OnboardingMode.HIDDEN,
    eventCallback: (event) => {
      if (event === "MEASUREMENT_FINISHED" || event === "MEASUREMENT_COMPLETED") {
        let res = null;
        try {
          res = engine.getMeasurementResults();
        } catch (e) {
          /* sin resultados */
        }
        const mapped = mapRealResults(res);
        renderSummary(mapped);
        showScreen("results");
      }
    },
    onCameraError: () =>
      showSetupError("No se pudo acceder a la cámara. Concede el permiso y usa https o localhost."),
  };

  const done = (result) => {
    if (result === engine.InitializationResult.OK) {
      initialized = true;
    } else {
      showSetupError("Error de activación: <strong>" + result.toString() + "</strong>.");
    }
  };

  if (initialized) {
    engine.setOperatingMode(engine.OperatingMode.POSITIONING);
  } else {
    engine.initialize(API_KEY, USER_ID, settings, done);
  }
}

function mapRealResults(res) {
  const r = res || {};
  const fmt = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "–");
  const bp =
    typeof r.systolic_blood_pressure_mmhg === "number" && typeof r.diastolic_blood_pressure_mmhg === "number"
      ? `${fmt(r.systolic_blood_pressure_mmhg)}/${fmt(r.diastolic_blood_pressure_mmhg)}`
      : "–";
  return {
    hr: fmt(r.heart_rate_bpm),
    hrv: fmt(r.hrv_sdnn_ms),
    bp,
    resp: fmt(r.breathing_rate_bpm),
    spo2: "–",
    stress: fmt(r.stress_index, 1),
    voice: "–",
    hba1c: "–",
    score: Math.round(rand(85, 92)),
  };
}

// ---------------------------------------------------------------------------
// Punto de entrada de la medición
// ---------------------------------------------------------------------------
function startMeasurement() {
  if (REAL_MODE) startRealMeasurement();
  else startSimulatedMeasurement();
}

function goToSummary() {
  if (simState) {
    renderSummary(simState.results);
    stopCamera();
  }
  showScreen("results");
}

// ---------------------------------------------------------------------------
// Eventos de UI
// ---------------------------------------------------------------------------
$("btn-start").addEventListener("click", startMeasurement);
$("btn-summary").addEventListener("click", goToSummary);
$("btn-restart").addEventListener("click", startMeasurement);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    if (target === "scan") return startMeasurement();
    if (target === "results" && !simState) return showScreen("landing");
    showScreen(target);
  });
});

document.querySelector(".btn--whatsapp").addEventListener("click", () => {
  alert("Demo: aquí el paciente continuaría su onboarding y plan de salud por WhatsApp.");
});

// Arranque
renderLandingList();
if (REAL_MODE) loadEngine();
