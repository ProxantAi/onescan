import { ICONS, metricByKey, rgba, stripBr, type MetricKey } from '../constants/metrics';

// Muestra por clave, no por índice. El código anterior usaba METRICS[0],
// METRICS[2] y METRICS[7]; al recortar el catálogo a 6 métricas, METRICS[7]
// quedaba undefined y la pantalla reventaba sin que el typecheck lo notara.
const LANDING_SAMPLE: Array<{ key: MetricKey; tag: string }> = [
  { key: 'hr', tag: 'Normal' },
  { key: 'bp', tag: 'Normal' },
  { key: 'hrv', tag: 'Óptimo' },
];

interface LandingScreenProps {
  active: boolean;
  onStart: () => void;
}

export function LandingScreen({ active, onStart }: LandingScreenProps) {
  return (
    <section className={`screen${active ? ' screen--active' : ''}`} id="screen-landing">
      <div className="hero">
        <div className="hero__emblem">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <path
              d="M12 21s-7-4.35-9.5-8.5C.9 9.6 2.3 6 5.6 6c1.9 0 3.2 1 4.4 2.6C11.2 7 12 6 12 6s.8 1 2 2.6C15.2 7 16.5 6 18.4 6 21.7 6 23.1 9.6 21.5 12.5 19 16.65 12 21 12 21z"
              fill="currentColor"
            />
          </svg>
        </div>
        <h1>Checkup Cardiometabólico</h1>
        <p className="hero__sub">Tu salud, tu futuro</p>
        <p className="hero__lede">
          Evalúa tu salud cardiometabólica en minutos con un videoselfie y recibe tu plan
          personalizado.
        </p>

        <ul className="check-list">
          {LANDING_SAMPLE.map(({ key, tag }) => {
            const metric = metricByKey(key);
            return (
              <li key={key}>
                <span
                  className="chip"
                  style={{ background: rgba(metric.color, 0.14), color: metric.color }}
                >
                  {ICONS[metric.icon](metric.color)}
                </span>
                {stripBr(metric.label)}
                <span className="tag tag--good">{tag}</span>
              </li>
            );
          })}
        </ul>

        <button type="button" className="btn btn--primary" onClick={onStart}>
          Iniciar videoselfie
        </button>
        <p className="confidential">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" />
          </svg>
          Resultados 100% confidenciales
        </p>
      </div>
    </section>
  );
}
