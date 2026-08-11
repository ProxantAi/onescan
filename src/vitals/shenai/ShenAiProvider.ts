// Fuente real: el motor de videobiometría de Shen.AI.
//
// Implementa la MISMA interfaz que la fuente sintética y devuelve el MISMO tipo
// (`MeasurementResults`), que es el criterio de aceptación del spike: cambiar de
// sintético a real no debe tocar nada aguas abajo.
//
// Dos diferencias deliberadas respecto al código original de la demo:
//
// 1. `showUserInterface: false`. Antes el SDK pintaba su propia interfaz encima
//    de `#mxcanvas` MIENTRAS los overlays de la app (óvalo, temporizador, chip de
//    señal) seguían dibujándose sobre ella — se veía duplicado. Cediendo sólo el
//    video, el óvalo, la malla, la traza y la rejilla de la app son la única
//    interfaz en ambos modos, y las dos fuentes se ven idénticas.
//
// 2. Se sondea `getMeasurementState()` en vez de confiar en `eventCallback`. El
//    código original guardaba `initializedRef` y saltaba `initialize()` en el
//    segundo escaneo, así que seguía disparando el `eventCallback` capturado la
//    primera vez — con los setters de React de aquella pasada. Un segundo
//    escaneo real actualizaba estado muerto. Sondear elimina la clausura.

import type { MeasurementResults, ShenaiSDK } from '@shenai/sdk';
import {
  VitalsSetupError,
  type ScanEvent,
  type ScanOutcome,
  type ScanSurfaces,
  type SignalQuality,
  type StartOptions,
  type VitalsProvider,
} from '../types';
import { loadShenaiSdk } from './loadShenaiSdk';

const POLL_MS = 200;
const SDK_CANVAS_ID = 'mxcanvas';

export interface ShenAiProviderConfig {
  apiKey: string;
  userId: string;
  /** inyectable para poder probar el ciclo de vida con un doble */
  loadSdk?: () => Promise<ShenaiSDK>;
}

export class ShenAiProvider implements VitalsProvider {
  readonly source = 'real' as const;
  readonly renderMode = 'sdk' as const;

  private listeners = new Set<(event: ScanEvent) => void>();
  private sdk: ShenaiSDK | null = null;
  private preparing: Promise<void> | null = null;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private settle: ((outcome: ScanOutcome) => void) | null = null;

  constructor(private readonly config: ShenAiProviderConfig) {}

  /** Idempotente: memoiza la promesa para sobrevivir al doble montaje de StrictMode. */
  prepare(): Promise<void> {
    if (!this.preparing) {
      this.preparing = (async () => {
        const load = this.config.loadSdk ?? loadShenaiSdk;
        this.sdk = await load();
      })();
    }
    return this.preparing;
  }

  async mount(surfaces: ScanSurfaces): Promise<void> {
    await this.prepare();
    if (surfaces.sdkCanvas) {
      this.sdk?.attachToCanvas(`#${SDK_CANVAS_ID}`, true);
    }
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

    await this.prepare();
    const sdk = this.sdk;
    if (!sdk) throw new VitalsSetupError('El motor de análisis no está disponible', 'sdk_unavailable');

    if (!this.config.apiKey) {
      throw new VitalsSetupError(
        'Falta la clave de activación de Shen.AI (VITE_SHENAI_API_KEY o la sesión del backend)',
        'invalid_api_key',
      );
    }

    await this.initializeOnce(sdk);
    if (this.cancelled) return { status: 'failed', reason: 'cancelled' };

    sdk.setOperatingMode(sdk.OperatingMode.MEASURE);
    this.emit({ type: 'state', state: 'measuring' });

    return new Promise<ScanOutcome>((resolve) => {
      this.settle = resolve;
      this.startPolling(sdk, options);
    });
  }

  private initializeOnce(sdk: ShenaiSDK): Promise<void> {
    if (sdk.isInitialized()) {
      sdk.setOperatingMode(sdk.OperatingMode.POSITIONING);
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      sdk.initialize(
        this.config.apiKey,
        this.config.userId,
        {
          language: 'es',
          hideShenaiLogo: true,
          // La app pinta su propia interfaz; el SDK sólo aporta el video.
          showUserInterface: false,
          showFacePositioningOverlay: false,
          showVisualWarnings: false,
          showSignalQualityIndicator: false,
          showStartStopButton: false,
          enableSummaryScreen: false,
          enableStartAfterSuccess: false,
          measurementPreset: sdk.MeasurementPreset.THIRTY_SECONDS_ALL_METRICS,
          onboardingMode: sdk.OnboardingMode.HIDDEN,
        },
        (result) => {
          // Se compara `.value` y no la referencia. Los enums del SDK son objetos
          // envueltos, y dar por hecho que siempre devuelve la MISMA instancia es
          // frágil: basta con que el motor construya el resultado en vez de
          // reutilizar la constante para que un `===` diga "error interno" ante
          // una inicialización correcta. Ya se comparaba así MeasurementState.
          if (result.value === sdk.InitializationResult.OK.value) {
            resolve();
            return;
          }
          if (result.value === sdk.InitializationResult.INVALID_API_KEY.value) {
            reject(new VitalsSetupError('Clave de activación inválida', 'invalid_api_key'));
            return;
          }
          if (result.value === sdk.InitializationResult.CONNECTION_ERROR.value) {
            reject(
              new VitalsSetupError(
                'No hay conexión para validar la licencia del motor',
                'connection_error',
              ),
            );
            return;
          }
          reject(new VitalsSetupError('Error interno del motor de análisis', 'internal'));
        },
      );
    });
  }

  private startPolling(sdk: ShenaiSDK, options: StartOptions): void {
    let lastQuality: SignalQuality | null = null;
    let lastPercent = -1;

    const tick = () => {
      if (this.cancelled) return;

      const state = sdk.getMeasurementState();
      const quality = signalFor(sdk, state);
      if (quality && quality !== lastQuality) {
        lastQuality = quality;
        this.emit({ type: 'signal', quality });
      }

      // El progreso se emite monótono: el SDK puede devolver valores que
      // retroceden al recuperarse de una mala racha de señal, y una barra que
      // va hacia atrás parece un error.
      const raw = sdk.getMeasurementProgressPercentage();
      const percent = Math.max(lastPercent, Math.min(100, Math.max(0, Math.round(raw))));
      if (percent !== lastPercent) {
        lastPercent = percent;
        this.emit({
          type: 'progress',
          percent,
          remainingSec: Math.max(0, ((100 - percent) / 100) * options.durationSec),
        });
      }

      const hr = sdk.getRealtimeHeartRate();
      if (typeof hr === 'number' && hr > 0) {
        this.emit({ type: 'live', heartRateBpm: hr });
      }

      // Métricas parciales en vivo: hacen que en modo real las tarjetas se vayan
      // llenando igual que en sintético, en vez de saltar de golpe al final como
      // hacía la demo original.
      const partial = sdk.getRealtimeMetrics(10);
      if (partial) {
        this.emit({
          type: 'partial',
          metrics: {
            heart_rate_bpm: partial.heart_rate_bpm,
            hrv_sdnn_ms: partial.hrv_sdnn_ms,
            breathing_rate_bpm: partial.breathing_rate_bpm,
            systolic_blood_pressure_mmhg: partial.systolic_blood_pressure_mmhg,
            diastolic_blood_pressure_mmhg: partial.diastolic_blood_pressure_mmhg,
            stress_index: partial.stress_index,
            parasympathetic_activity: partial.parasympathetic_activity,
          },
        });
      }

      if (state.value === sdk.MeasurementState.FINALIZING.value) {
        this.emit({ type: 'state', state: 'finalizing' });
      }

      if (state.value === sdk.MeasurementState.FAILED.value) {
        this.finish({ status: 'failed', reason: 'signal_too_poor' });
        return;
      }

      if (state.value === sdk.MeasurementState.FINISHED.value) {
        let results: MeasurementResults | null = null;
        try {
          results = sdk.getMeasurementResults();
        } catch {
          results = null;
        }
        // Terminar sin resultados es un desenlace legítimo del SDK, no un error.
        this.finish(
          results
            ? { status: 'finished', results }
            : { status: 'failed', reason: 'signal_too_poor' },
        );
        return;
      }

      this.poll = setTimeout(tick, POLL_MS);
    };

    tick();
  }

  private finish(outcome: ScanOutcome): void {
    this.stopPolling();
    this.emit({ type: 'state', state: outcome.status === 'finished' ? 'done' : 'failed' });
    const settle = this.settle;
    this.settle = null;
    settle?.(outcome);
  }

  private stopPolling(): void {
    if (this.poll !== null) clearTimeout(this.poll);
    this.poll = null;
  }

  cancel(): void {
    if (this.settle === null) return;
    this.cancelled = true;
    this.finish({ status: 'failed', reason: 'cancelled' });
  }

  dispose(): void {
    this.cancelled = true;
    this.stopPolling();
    // deinitialize() deja vivo el runtime para poder volver a inicializar; no se
    // llama destroyRuntime() porque haría irrecuperable un segundo escaneo.
    try {
      this.sdk?.deinitialize();
    } catch {
      /* el motor ya podía estar caído */
    }
    this.listeners.clear();
    this.settle = null;
  }
}

function signalFor(sdk: ShenaiSDK, state: { value: number }): SignalQuality | null {
  const S = sdk.MeasurementState;
  switch (state.value) {
    case S.WAITING_FOR_FACE.value:
      return 'no_face';
    case S.RUNNING_SIGNAL_SHORT.value:
      return 'short';
    case S.RUNNING_SIGNAL_GOOD.value:
      return 'good';
    case S.RUNNING_SIGNAL_BAD.value:
      return 'bad';
    case S.RUNNING_SIGNAL_BAD_DEVICE_UNSTABLE.value:
      return 'unstable';
    default:
      return null;
  }
}
