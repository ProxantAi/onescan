// Contrato compartido por la fuente sintética y la real.
//
// `MeasurementResults` NO se redefine aquí: se importa del paquete real
// `@shenai/sdk`. Es una devDependency y sólo se usa con `import type`, así que
// TypeScript verifica el contrato en compilación y el build no arrastra los
// 34 MB de wasm. Consecuencia práctica: si el proveedor cambia el shape al
// actualizar el SDK, los fixtures y el provider sintético dejan de compilar —
// que es exactamente la garantía que pide el spike ("la fuente sintética y la
// real deben regresar el mismo tipo").
import type { MeasurementResults } from '@shenai/sdk';

export type { MeasurementResults };

export type ScanSource = 'synthetic' | 'real';

export type FailureReason =
  | 'signal_too_poor'
  | 'no_face'
  | 'cancelled'
  | 'timeout'
  | 'sdk_error';

export type ScanState =
  | 'idle'
  | 'preparing'
  | 'positioning'
  | 'measuring'
  | 'finalizing'
  | 'done'
  | 'failed';

export type SignalQuality = 'unknown' | 'no_face' | 'short' | 'good' | 'bad' | 'unstable';

/** Métricas que la UI puede ir revelando durante la medición. */
export type PartialMetrics = Partial<
  Pick<
    MeasurementResults,
    | 'heart_rate_bpm'
    | 'hrv_sdnn_ms'
    | 'breathing_rate_bpm'
    | 'systolic_blood_pressure_mmhg'
    | 'diastolic_blood_pressure_mmhg'
    | 'stress_index'
    | 'parasympathetic_activity'
  >
>;

export type ScanEvent =
  | { type: 'state'; state: ScanState }
  | { type: 'progress'; percent: number; remainingSec: number }
  | { type: 'signal'; quality: SignalQuality; hint?: string }
  | { type: 'partial'; metrics: PartialMetrics }
  /** frecuencia instantánea con jitter, sólo para animar la traza PPG */
  | { type: 'live'; heartRateBpm: number };

/**
 * Desenlace de una captura.
 *
 * Una medición fallida por señal insuficiente es un resultado legítimo del SDK
 * real (`getMeasurementResults()` puede devolver null tras FINISHED), no una
 * excepción: modelarlo como throw obligaría a un try/catch en cada consumidor y
 * convertiría un caso clínico normal en un error.
 */
export type ScanOutcome =
  | { status: 'finished'; results: MeasurementResults }
  | { status: 'failed'; reason: FailureReason };

/** Superficies de render que la pantalla de escaneo pone a disposición. */
export interface ScanSurfaces {
  video: HTMLVideoElement | null;
  faceMesh: HTMLCanvasElement | null;
  ppg: HTMLCanvasElement | null;
  /** #mxcanvas — donde pinta el motor wasm de Shen.AI */
  sdkCanvas: HTMLCanvasElement | null;
}

export interface StartOptions {
  sessionId: string;
  durationSec: number;
  /** payload nativo a reproducir; sólo lo usa la fuente sintética */
  replay?: MeasurementResults | null;
  /** desenlace forzado del escenario sintético */
  replayFailure?: FailureReason | null;
}

export interface VitalsProvider {
  readonly source: ScanSource;
  /**
   * Qué pinta la interfaz: 'proxant' = óvalo, malla y PPG nuestros;
   * 'sdk' = el motor de Shen.AI pinta su propio canvas.
   *
   * Es un dato declarativo que sólo mueve una clase CSS. Nada de la lógica
   * posterior se ramifica sobre esto.
   */
  readonly renderMode: 'proxant' | 'sdk';

  /** Idempotente: carga wasm o prepara el replay. */
  prepare(): Promise<void>;
  /** Idempotente: engancha las superficies del DOM. */
  mount(surfaces: ScanSurfaces): Promise<void>;
  subscribe(listener: (event: ScanEvent) => void): () => void;
  /** Nunca rechaza por un desenlace de medición; los fallos vuelven en ScanOutcome. */
  start(options: StartOptions): Promise<ScanOutcome>;
  cancel(): void;
  dispose(): void;
}

export class VitalsSetupError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'sdk_unavailable'
      | 'invalid_api_key'
      | 'camera_denied'
      | 'connection_error'
      | 'internal',
  ) {
    super(message);
    this.name = 'VitalsSetupError';
  }
}

/** Guard en runtime, complemento del tipo de `@shenai/sdk`. */
export function assertMeasurementResults(value: unknown): asserts value is MeasurementResults {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('MeasurementResults must be an object');
  }
  const r = value as Record<string, unknown>;
  if (typeof r.heart_rate_bpm !== 'number' || !Number.isFinite(r.heart_rate_bpm)) {
    throw new TypeError('MeasurementResults.heart_rate_bpm must be a finite number');
  }
  if (typeof r.average_signal_quality !== 'number') {
    throw new TypeError('MeasurementResults.average_signal_quality must be a number');
  }
  if (!Array.isArray(r.heartbeats)) {
    throw new TypeError('MeasurementResults.heartbeats must be an array');
  }
}
