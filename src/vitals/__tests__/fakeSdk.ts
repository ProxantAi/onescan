// Doble del SDK de Shen.AI.
//
// Existe para poder correr la suite de contrato contra la fuente REAL sin
// licencia ni cámara: recorre la máquina de estados documentada
// (WAITING_FOR_FACE → RUNNING_SIGNAL_SHORT → RUNNING_SIGNAL_GOOD → FINALIZING →
// FINISHED/FAILED) y devuelve un MeasurementResults al terminar.
//
// Es la razón por la que ShenAiProvider recibe `loadSdk` por constructor en vez
// de importarlo directo.

import type { MeasurementResults, ShenaiSDK } from '@shenai/sdk';

const brand = (value: number) => ({ value }) as unknown as never;

export const SAMPLE_RESULTS: MeasurementResults = {
  heart_rate_bpm: 74,
  hrv_sdnn_ms: 48,
  hrv_lnrmssd_ms: 3.5,
  stress_index: 3.1,
  parasympathetic_activity: 58,
  breathing_rate_bpm: 15,
  systolic_blood_pressure_mmhg: 119,
  diastolic_blood_pressure_mmhg: 77,
  cardiac_workload_mmhg_per_sec: 146.7,
  age_years: 36,
  bmi_kg_per_m2: 22.9,
  bmi_category: brand(3),
  weight_kg: 70,
  height_cm: 175,
  quality_metrics: null,
  heartbeats: [],
  average_signal_quality: 0.92,
};

export interface FakeSdkOptions {
  /** cuántos ticks tarda en llegar a FINISHED/FAILED */
  ticksToFinish?: number;
  outcome?: 'finished' | 'failed';
  /** simula un SDK que termina pero no entrega resultados (caso real documentado) */
  resultsAfterFinish?: MeasurementResults | null;
}

const STATES = {
  NOT_STARTED: 0,
  WAITING_FOR_FACE: 1,
  RUNNING_SIGNAL_SHORT: 2,
  RUNNING_SIGNAL_GOOD: 3,
  RUNNING_SIGNAL_BAD: 4,
  RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE: 5,
  FINALIZING: 6,
  FINISHED: 7,
  FAILED: 8,
} as const;

export function createFakeSdk(options: FakeSdkOptions = {}): ShenaiSDK {
  const ticksToFinish = options.ticksToFinish ?? 5;
  const outcome = options.outcome ?? 'finished';
  const results =
    options.resultsAfterFinish === undefined ? SAMPLE_RESULTS : options.resultsAfterFinish;

  let initialized = false;
  let tick = 0;

  const enumOf = (map: Record<string, number>) =>
    Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { value: v }]));

  const fake = {
    getVersion: () => 'fake-1.0.0',
    isInitialized: () => initialized,
    initialize: (
      _apiKey: string,
      _userId: string,
      _settings: unknown,
      onResult: (result: unknown) => void,
    ) => {
      initialized = true;
      onResult({ value: 0 }); // InitializationResult.OK
    },
    deinitialize: () => {
      initialized = false;
    },
    destroyRuntime: () => {},
    attachToCanvas: () => {},
    setOperatingMode: () => {},

    getMeasurementState: () => {
      tick++;
      if (tick >= ticksToFinish) {
        return { value: outcome === 'finished' ? STATES.FINISHED : STATES.FAILED };
      }
      if (tick === 1) return { value: STATES.WAITING_FOR_FACE };
      if (tick === 2) return { value: STATES.RUNNING_SIGNAL_SHORT };
      if (tick === ticksToFinish - 1) return { value: STATES.FINALIZING };
      return { value: STATES.RUNNING_SIGNAL_GOOD };
    },
    getMeasurementProgressPercentage: () => Math.min(100, (tick / ticksToFinish) * 100),
    getRealtimeHeartRate: () => (tick > 1 ? 74 : null),
    getRealtimeMetrics: () => (tick > 2 ? SAMPLE_RESULTS : null),
    getMeasurementResults: () => results,

    InitializationResult: enumOf({
      OK: 0,
      INVALID_API_KEY: 1,
      CONNECTION_ERROR: 2,
      INTERNAL_ERROR: 3,
    }),
    MeasurementState: enumOf(STATES as unknown as Record<string, number>),
    OperatingMode: enumOf({ POSITIONING: 0, MEASURE: 1, SYSTEM_OVERLOADED: 2 }),
    MeasurementPreset: enumOf({ THIRTY_SECONDS_ALL_METRICS: 2 }),
    OnboardingMode: enumOf({ HIDDEN: 0, SHOW_ONCE: 1, SHOW_ALWAYS: 2 }),
  };

  return fake as unknown as ShenaiSDK;
}
