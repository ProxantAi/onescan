// Fuente sintética: reproduce el `MeasurementResults` que el SERVIDOR eligió.
//
// No inventa valores. El backend decide el escenario y manda el payload nativo
// en la respuesta de `POST /health-capture/sessions`; este provider sólo lo
// representa: cámara real, malla, traza PPG y revelado progresivo de métricas
// durante la duración configurada.
//
// Por qué los fixtures no viven aquí: como el escenario lo elige el servidor,
// una copia en el frontend sería una segunda fuente de verdad que se
// desincroniza en cuanto alguien toque un umbral.

import type {
  MeasurementResults,
  PartialMetrics,
  ScanEvent,
  ScanOutcome,
  ScanSurfaces,
  StartOptions,
  VitalsProvider,
} from '../types';
import { seededRng, type Rng } from '../../lib/prng';
import { startCamera, type CameraHandle } from './renderers/camera';
import { startFaceMesh } from './renderers/faceMesh';
import { startPpg } from './renderers/ppg';

/** En qué fracción de la medición aparece cada métrica. Es presentación pura:
 *  reemplaza al viejo REVEAL_AT que vivía en constants/metrics. */
const REVEAL_SCHEDULE: Array<{ at: number; keys: Array<keyof PartialMetrics> }> = [
  { at: 0.1, keys: ['heart_rate_bpm'] },
  { at: 0.28, keys: ['hrv_sdnn_ms'] },
  { at: 0.44, keys: ['systolic_blood_pressure_mmhg', 'diastolic_blood_pressure_mmhg'] },
  { at: 0.6, keys: ['breathing_rate_bpm'] },
  { at: 0.76, keys: ['stress_index'] },
  { at: 0.9, keys: ['parasympathetic_activity'] },
];

/** Secuencia de calidad de señal cuando el escenario va a fallar. */
const FAILING_SIGNAL: Array<{ at: number; quality: 'short' | 'good' | 'bad' | 'unstable' }> = [
  { at: 0, quality: 'short' },
  { at: 0.12, quality: 'good' },
  { at: 0.35, quality: 'bad' },
  { at: 0.52, quality: 'unstable' },
];

const FAIL_AT = 0.62;
const TICK_MS = 200;
const LOCK_DELAY_MS = 1400;

export class SyntheticProvider implements VitalsProvider {
  readonly source = 'synthetic' as const;
  readonly renderMode = 'proxant' as const;

  private listeners = new Set<(event: ScanEvent) => void>();
  private surfaces: ScanSurfaces | null = null;
  private camera: CameraHandle | null = null;
  private stopMesh: (() => void) | null = null;
  private stopPpg: (() => void) | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private liveHr = 0;
  private cancelled = false;
  private settle: ((outcome: ScanOutcome) => void) | null = null;

  prepare(): Promise<void> {
    // Nada que cargar: el payload llega del servidor. Idempotente por definición.
    return Promise.resolve();
  }

  mount(surfaces: ScanSurfaces): Promise<void> {
    this.surfaces = surfaces;
    return Promise.resolve();
  }

  subscribe(listener: (event: ScanEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ScanEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async start(options: StartOptions): Promise<ScanOutcome> {
    this.cancelled = false;
    this.emit({ type: 'state', state: 'preparing' });

    // La cámara es cosmética en esta rama: si el usuario la niega, la demo debe
    // seguir corriendo (así se comportaba la versión original y es lo correcto
    // para un kiosco). En la fuente real, negarla sí es fatal.
    try {
      this.camera = await startCamera(this.surfaces?.video ?? null);
    } catch {
      this.camera = null;
    }

    if (this.cancelled) return { status: 'failed', reason: 'cancelled' };

    this.emit({ type: 'state', state: 'positioning' });
    this.emit({ type: 'signal', quality: 'short', hint: 'Ajusta tu cara dentro del óvalo' });

    return new Promise<ScanOutcome>((resolve) => {
      this.settle = resolve;
      const lockTimer = setTimeout(() => this.runMeasurement(options), LOCK_DELAY_MS);
      this.timers.push(lockTimer);
    });
  }

  private runMeasurement(options: StartOptions): void {
    if (this.cancelled) return;

    if (options.replay == null && options.replayFailure == null) {
      this.finish({ status: 'failed', reason: 'sdk_error' });
      return;
    }

    const willFail = options.replayFailure != null;
    const results = options.replay ?? null;
    const rng: Rng = seededRng(options.sessionId);
    const durationMs = Math.max(1, options.durationSec) * 1000;
    const startedAt = performance.now();
    const revealed = new Set<string>();
    let signalIndex = -1;

    this.emit({ type: 'state', state: 'measuring' });
    this.stopMesh = startFaceMesh(this.surfaces?.faceMesh ?? null);
    this.stopPpg = startPpg(this.surfaces?.ppg ?? null, () => this.liveHr);

    const baseHr = results?.heart_rate_bpm ?? 72;

    const tick = () => {
      if (this.cancelled) return;

      const elapsed = performance.now() - startedAt;
      const p = Math.min(1, elapsed / durationMs);

      this.emit({
        type: 'progress',
        percent: Math.round(p * 100),
        remainingSec: Math.max(0, (durationMs - elapsed) / 1000),
      });

      // Frecuencia instantánea: converge al valor real conforme avanza la
      // medición, igual que hacía la demo original.
      const noise = (1 - p) * 8;
      this.liveHr = baseHr + (rng() - 0.5) * 2 * noise + Math.sin(elapsed / 480) * (1 - p) * 3;
      this.emit({ type: 'live', heartRateBpm: this.liveHr });

      if (willFail) {
        while (signalIndex + 1 < FAILING_SIGNAL.length && p >= FAILING_SIGNAL[signalIndex + 1].at) {
          signalIndex++;
          this.emit({ type: 'signal', quality: FAILING_SIGNAL[signalIndex].quality });
        }
        if (p >= 0.1 && !revealed.has('hr')) {
          revealed.add('hr');
          this.emit({ type: 'partial', metrics: { heart_rate_bpm: Math.round(this.liveHr) } });
        }
        if (p >= FAIL_AT) {
          this.finish({ status: 'failed', reason: options.replayFailure ?? 'signal_too_poor' });
          return;
        }
      } else if (results) {
        if (signalIndex < 0 && p >= 0.14) {
          signalIndex = 0;
          this.emit({ type: 'signal', quality: 'good' });
        }
        // La frecuencia se actualiza en vivo desde el arranque; el resto aparece
        // según el calendario de revelado.
        if (p >= 0.1) {
          this.emit({ type: 'partial', metrics: { heart_rate_bpm: Math.round(this.liveHr) } });
        }
        for (const step of REVEAL_SCHEDULE) {
          if (p < step.at) continue;
          const pending = step.keys.filter((key) => !revealed.has(key));
          if (pending.length === 0) continue;

          const metrics: PartialMetrics = {};
          for (const key of pending) {
            revealed.add(key);
            assignMetric(metrics, results, key);
          }
          this.emit({ type: 'partial', metrics });
        }
      }

      if (p >= 1) {
        if (results) {
          this.emit({ type: 'state', state: 'finalizing' });
          this.emit({ type: 'partial', metrics: fullMetrics(results) });
          this.finish({ status: 'finished', results });
        } else {
          this.finish({ status: 'failed', reason: 'sdk_error' });
        }
        return;
      }

      this.timers.push(setTimeout(tick, TICK_MS));
    };

    tick();
  }

  private finish(outcome: ScanOutcome): void {
    this.stopAnimations();
    this.emit({ type: 'state', state: outcome.status === 'finished' ? 'done' : 'failed' });
    const settle = this.settle;
    this.settle = null;
    settle?.(outcome);
  }

  private stopAnimations(): void {
    this.timers.forEach((id) => clearTimeout(id));
    this.timers = [];
    this.stopMesh?.();
    this.stopPpg?.();
    this.stopMesh = null;
    this.stopPpg = null;
  }

  cancel(): void {
    if (this.settle === null) return;
    this.cancelled = true;
    this.finish({ status: 'failed', reason: 'cancelled' });
  }

  dispose(): void {
    this.cancelled = true;
    this.stopAnimations();
    this.camera?.stop();
    this.camera = null;
    this.listeners.clear();
    this.settle = null;
  }
}

function assignMetric(
  target: PartialMetrics,
  results: MeasurementResults,
  key: keyof PartialMetrics,
): void {
  // Reasignación campo a campo en vez de un spread indexado: mantiene el tipo
  // exacto de cada métrica y evita un cast a any.
  switch (key) {
    case 'heart_rate_bpm':
      target.heart_rate_bpm = results.heart_rate_bpm;
      break;
    case 'hrv_sdnn_ms':
      target.hrv_sdnn_ms = results.hrv_sdnn_ms;
      break;
    case 'breathing_rate_bpm':
      target.breathing_rate_bpm = results.breathing_rate_bpm;
      break;
    case 'systolic_blood_pressure_mmhg':
      target.systolic_blood_pressure_mmhg = results.systolic_blood_pressure_mmhg;
      break;
    case 'diastolic_blood_pressure_mmhg':
      target.diastolic_blood_pressure_mmhg = results.diastolic_blood_pressure_mmhg;
      break;
    case 'stress_index':
      target.stress_index = results.stress_index;
      break;
    case 'parasympathetic_activity':
      target.parasympathetic_activity = results.parasympathetic_activity;
      break;
  }
}

function fullMetrics(results: MeasurementResults): PartialMetrics {
  return {
    heart_rate_bpm: results.heart_rate_bpm,
    hrv_sdnn_ms: results.hrv_sdnn_ms,
    breathing_rate_bpm: results.breathing_rate_bpm,
    systolic_blood_pressure_mmhg: results.systolic_blood_pressure_mmhg,
    diastolic_blood_pressure_mmhg: results.diastolic_blood_pressure_mmhg,
    stress_index: results.stress_index,
    parasympathetic_activity: results.parasympathetic_activity,
  };
}
