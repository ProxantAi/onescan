import type { RefObject } from 'react';
import { ICONS, METRICS, formatLabel, rgba } from '../constants/metrics';
import type { TileMap } from '../hooks/useScan';
import type { ScanState } from '../vitals/types';

interface ScoreRingProps {
  scoreNum: string;
  ringOffset: number;
  size?: number;
}

function ScoreRing({ scoreNum, ringOffset, size = 56 }: ScoreRingProps) {
  return (
    <div className="ring">
      <svg viewBox="0 0 44 44" width={size} height={size}>
        <circle cx="22" cy="22" r="19" className="ring__bg" />
        <circle cx="22" cy="22" r="19" className="ring__fg" style={{ strokeDashoffset: ringOffset }} />
      </svg>
      <div className="ring__num">
        <strong>{scoreNum}</strong>
        <small>/100</small>
      </div>
    </div>
  );
}

interface ScanScreenProps {
  active: boolean;
  phase: ScanState;
  renderMode: 'proxant' | 'sdk';
  scanTimer: string;
  tiles: TileMap;
  statusHint: string;
  statusValue: string;
  scoreNum: string;
  ringOffset: number;
  summaryDisabled: boolean;
  failureReason: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  faceMeshRef: RefObject<HTMLCanvasElement | null>;
  ppgCanvasRef: RefObject<HTMLCanvasElement | null>;
  mxCanvasRef: RefObject<HTMLCanvasElement | null>;
  onSummary: () => void;
  onRetry: () => void;
}

export function ScanScreen({
  active,
  phase,
  renderMode,
  scanTimer,
  tiles,
  statusHint,
  statusValue,
  scoreNum,
  ringOffset,
  summaryDisabled,
  failureReason,
  videoRef,
  faceMeshRef,
  ppgCanvasRef,
  mxCanvasRef,
  onSummary,
  onRetry,
}: ScanScreenProps) {
  const measuring = phase === 'measuring' || phase === 'finalizing';
  const failed = phase === 'failed';

  // La única ramificación por proveedor en toda la vista, y es puramente
  // presentacional: decide qué superficie de video se muestra. El resto de la
  // pantalla es idéntica en modo sintético y en modo real.
  const cameraClass = [
    'camera',
    renderMode === 'proxant' ? 'camera--host' : 'camera--provider',
    phase !== 'preparing' && phase !== 'idle' && 'camera--locked',
    measuring && 'camera--measuring',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={`screen${active ? ' screen--active' : ''}`} id="screen-scan">
      <div className={cameraClass} id="camera-frame">
        <canvas id="mxcanvas" ref={mxCanvasRef} />
        <video id="sim-video" ref={videoRef} playsInline autoPlay muted />
        <canvas id="face-mesh" ref={faceMeshRef} className="face-mesh" />
        <div className="camera__oval">
          <svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid meet">
            <ellipse cx="150" cy="178" rx="96" ry="126" />
          </svg>
        </div>
        <div className="scanline" />
        <div className="camera__hint">{statusHint}</div>
        <div className="camera__timer">
          <span className="dot" />
          <span id="scan-timer">{scanTimer}</span>
        </div>
        <div className="camera__signal">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              d="M2 12h3l2-6 4 12 3-9 2 3h6"
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Capturando señal…</span>
        </div>
      </div>

      <div className="ppg-strip">
        <canvas id="ppg-canvas" ref={ppgCanvasRef} />
        <span className="ppg-strip__label">PPG · señal en tiempo real</span>
      </div>

      <div className="metrics-card">
        <div className="metrics-card__head">
          <h2>Tus métricas</h2>
          <span className={`metrics-card__live${phase === 'done' ? ' is-final' : ''}`}>
            <span className="metrics-card__live-dot" />
            {phase === 'done' ? 'Resultado' : 'En tiempo real'}
          </span>
        </div>

        <div className="metrics-grid">
          {METRICS.map((m) => {
            const tile = tiles[m.key];
            return (
              <div
                key={m.key}
                className={`tile${tile?.filled ? ' is-filled' : ''}`}
                id={`tile-${m.key}`}
              >
                <span
                  className="tile__icon"
                  style={{ background: rgba(m.color, 0.14), color: m.color }}
                >
                  {ICONS[m.icon](m.color)}
                </span>
                <span className="tile__label">{formatLabel(m.label)}</span>
                <span className="tile__value" style={{ opacity: tile?.filled ? 1 : 0.35 }}>
                  {tile?.value ?? '–'}
                </span>
                <span className="tile__unit">{m.unit}</span>
              </div>
            );
          })}
        </div>

        {failed ? (
          // Señal insuficiente es un desenlace normal del rPPG, no un error del
          // sistema: se ofrece repetir en lugar de mostrar un score inventado.
          <div className="status-card status-card--warn">
            <div className="status-card__text">
              <span className="status-card__label">No pudimos completar la medición</span>
              <strong>
                {failureReason === 'signal_too_poor'
                  ? 'Señal insuficiente'
                  : 'Medición interrumpida'}
              </strong>
              <span className="status-card__hint">
                Busca mejor luz, quédate quieto e inténtalo de nuevo.
              </span>
            </div>
          </div>
        ) : (
          <div className="status-card">
            <div className="status-card__shield">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path
                  d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 12l2.5 2.5 4.5-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="status-card__text">
              <span className="status-card__label">Tu estado general</span>
              <strong>{statusValue}</strong>
              <span className="status-card__hint">{statusHint}</span>
            </div>
            <ScoreRing scoreNum={scoreNum} ringOffset={ringOffset} />
          </div>
        )}

        {failed ? (
          <button type="button" className="btn btn--primary" onClick={onRetry}>
            Repetir medición
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            disabled={summaryDisabled}
            onClick={onSummary}
          >
            Ver resumen completo
          </button>
        )}
      </div>
    </section>
  );
}
