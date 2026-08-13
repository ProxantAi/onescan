import {
  ICONS,
  METRICS,
  levelTone,
  rgba,
  stripBr,
  toneClass,
} from '../constants/metrics';
import type { NormalizedScan } from '../services/healthCapture';

interface ResultsScreenProps {
  active: boolean;
  normalized: NormalizedScan | null;
  ringOffset: number;
  isSynthetic: boolean;
  planUrl: string | null;
  onRestart: () => void;
  onWhatsapp: () => void;
}

function display(value: number | null, secondary: number | null): string {
  if (value === null) return '–';
  if (secondary !== null) return `${value}/${secondary}`;
  return String(value);
}

export function ResultsScreen({
  active,
  normalized,
  ringOffset,
  isSynthetic,
  planUrl,
  onRestart,
  onWhatsapp,
}: ResultsScreenProps) {
  const score = normalized?.score ?? null;
  const verdict = normalized?.verdict;

  return (
    <section className={`screen${active ? ' screen--active' : ''}`} id="screen-results">
      <div className="summary">
        <div className="summary__hero">
          <div className="ring ring--lg">
            <svg viewBox="0 0 44 44" width="84" height="84">
              <circle cx="22" cy="22" r="19" className="ring__bg" />
              <circle
                cx="22"
                cy="22"
                r="19"
                className="ring__fg"
                style={{ strokeDashoffset: ringOffset }}
              />
            </svg>
            <div className="ring__num">
              <strong>{score === null ? '--' : score}</strong>
              <small>/100</small>
            </div>
          </div>
          {/* El veredicto lo calcula el backend a partir del score. Antes era el
              literal "Óptimo" en el JSX, así que un resultado hipertenso se
              anunciaba como óptimo. */}
          <h2>
            Tu estado general es <span>{verdict?.label ?? '—'}</span>
          </h2>
          <p className="hero__lede">
            {verdict?.hint ??
              'Estos son tus signos vitales estimados. Un médico de Proxant los valida y construye tu plan de salud personalizado.'}
          </p>
        </div>

        {normalized && (
          <ul className="result-list">
            {METRICS.map((m) => {
              const metric = normalized.metrics[m.key];
              const tone = levelTone(metric?.level);
              return (
                <li key={m.key}>
                  <span
                    className="chip"
                    style={{ background: rgba(m.color, 0.14), color: m.color }}
                  >
                    {ICONS[m.icon](m.color)}
                  </span>
                  <span className="rl-label">{stripBr(m.label)}</span>
                  <span className="rl-right">
                    <span className="rl-value">
                      {display(metric?.value ?? null, metric?.secondary ?? null)}
                      {m.unit && <small>{m.unit}</small>}
                    </span>
                    <span className={`tag ${toneClass(tone)}`}>{metric?.label ?? 'Sin dato'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {normalized && (
          <div className="summary__advanced">
            <h3>Detalle</h3>
            <ul>
              <li>
                <span>Calidad de señal</span>
                <strong>{Math.round(normalized.advanced.average_signal_quality * 100)}%</strong>
              </li>
              {normalized.advanced.cardiac_workload_mmhg_per_sec !== null && (
                <li>
                  <span>Carga cardiaca</span>
                  <strong>{normalized.advanced.cardiac_workload_mmhg_per_sec} mmHg/s</strong>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="plan-card">
          <h3>{planUrl ? 'Tu plan de salud está listo' : 'Recibe tu plan de salud personalizado'}</h3>
          <p>
            {planUrl
              ? 'Ya incluimos estos resultados en tu plan. También te lo mandamos por WhatsApp.'
              : 'Continúa por WhatsApp, sin descargar ninguna app. Seguimiento 24/7 y recordatorios de tu CareTracker.'}
          </p>
          {planUrl ? (
            <a className="btn btn--whatsapp" href={planUrl}>
              Ver mi plan de salud
            </a>
          ) : (
            <button type="button" className="btn btn--whatsapp" onClick={onWhatsapp}>
              Continuar por WhatsApp
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onRestart}>
            Repetir checkup
          </button>
        </div>

        <p className="disclaimer">
          Demostración. Las estimaciones no sustituyen una valoración médica profesional.
          {isSynthetic && ' Los datos mostrados son sintéticos.'}
        </p>
      </div>
    </section>
  );
}
