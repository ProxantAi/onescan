// Orquesta un escaneo completo: pide sesión al backend, corre el provider que
// el servidor eligió, y entrega el resultado.
//
// No sabe si corrió la fuente sintética o la real. Esa es la prueba de que el
// patrón wrapper funciona: este archivo no tiene un solo `if (synthetic)`.

import { useCallback, useRef, useState } from 'react';
import type { MetricKey } from '../constants/metrics';
import { formatTime } from '../constants/metrics';
import {
  openScanSession,
  submitScanResults,
  type NormalizedScan,
  type ScanSession,
} from '../services/healthCapture';
import { createProvider } from '../vitals/factory';
import {
  VitalsSetupError,
  type PartialMetrics,
  type ScanEvent,
  type ScanState,
  type ScanSurfaces,
  type SignalQuality,
  type VitalsProvider,
} from '../vitals/types';

const DEFAULT_DURATION_SEC = 30;

const SIGNAL_HINTS: Record<SignalQuality, string> = {
  unknown: 'Mantente quieto unos segundos.',
  no_face: 'Ajusta tu cara dentro del óvalo.',
  short: 'Capturando señal…',
  good: 'Señal estable, no te muevas.',
  bad: 'Señal débil: busca mejor luz.',
  unstable: 'Sostén el dispositivo con firmeza.',
};

export interface ScanTile {
  value: string;
  filled: boolean;
}

export type TileMap = Partial<Record<MetricKey, ScanTile>>;

function fmt(value: number | null | undefined, decimals = 0): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : null;
}

/** Métricas parciales → texto de las tarjetas. Presentación pura: los umbrales y
 *  el score los calcula el backend, no se duplican aquí. */
function tilesFromPartial(metrics: PartialMetrics, previous: TileMap): TileMap {
  const next: TileMap = { ...previous };
  const set = (key: MetricKey, text: string | null) => {
    if (text !== null) next[key] = { value: text, filled: true };
  };

  set('hr', fmt(metrics.heart_rate_bpm));
  set('hrv', fmt(metrics.hrv_sdnn_ms));
  set('resp', fmt(metrics.breathing_rate_bpm));
  set('stress', fmt(metrics.stress_index, 1));
  set('parasym', fmt(metrics.parasympathetic_activity));

  const sys = fmt(metrics.systolic_blood_pressure_mmhg);
  const dia = fmt(metrics.diastolic_blood_pressure_mmhg);
  if (sys !== null && dia !== null) set('bp', `${sys}/${dia}`);

  return next;
}

export interface UseScanResult {
  phase: ScanState;
  /** 'proxant' = la app pinta el óvalo, la malla y la traza; 'sdk' = lo pinta el motor. */
  renderMode: 'proxant' | 'sdk';
  progressPct: number;
  timerLabel: string;
  tiles: TileMap;
  statusHint: string;
  session: ScanSession | null;
  normalized: NormalizedScan | null;
  failureReason: string | null;
  error: string | null;
  isRunning: boolean;
  start: (surfaces: ScanSurfaces) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useScan(): UseScanResult {
  const [phase, setPhase] = useState<ScanState>('idle');
  const [renderMode, setRenderMode] = useState<'proxant' | 'sdk'>('proxant');
  const [progressPct, setProgressPct] = useState(0);
  const [remainingSec, setRemainingSec] = useState(DEFAULT_DURATION_SEC);
  const [tiles, setTiles] = useState<TileMap>({});
  const [statusHint, setStatusHint] = useState(SIGNAL_HINTS.unknown);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [normalized, setNormalized] = useState<NormalizedScan | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerRef = useRef<VitalsProvider | null>(null);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setProgressPct(0);
    setTiles({});
    setNormalized(null);
    setFailureReason(null);
    setError(null);
    setStatusHint(SIGNAL_HINTS.unknown);
    setPhase('idle');
  }, []);

  const handleEvent = useCallback((event: ScanEvent) => {
    switch (event.type) {
      case 'state':
        setPhase(event.state);
        break;
      case 'progress':
        setProgressPct(event.percent);
        setRemainingSec(event.remainingSec);
        break;
      case 'signal':
        setStatusHint(event.hint ?? SIGNAL_HINTS[event.quality]);
        break;
      case 'partial':
        setTiles((previous) => tilesFromPartial(event.metrics, previous));
        break;
      case 'live':
        // Sólo alimenta la traza PPG dentro del provider; la tarjeta de
        // frecuencia se actualiza por 'partial' para no parpadear con el jitter.
        break;
    }
  }, []);

  const start = useCallback(
    async (surfaces: ScanSurfaces) => {
      if (runningRef.current) return;
      runningRef.current = true;
      reset();
      setPhase('preparing');

      let unsubscribe: (() => void) | null = null;

      try {
        // El servidor decide fuente y escenario. El cliente no opina.
        const openedSession = await openScanSession();
        setSession(openedSession);
        setRemainingSec(openedSession.duration_sec || DEFAULT_DURATION_SEC);

        const provider = await createProvider(openedSession.source, {
          shenaiApiKey: import.meta.env.VITE_SHENAI_API_KEY ?? '',
          shenaiUserId: '',
        });
        providerRef.current = provider;
        setRenderMode(provider.renderMode);

        unsubscribe = provider.subscribe(handleEvent);
        await provider.prepare();
        await provider.mount(surfaces);

        const outcome = await provider.start({
          sessionId: openedSession.session_id,
          durationSec: openedSession.duration_sec || DEFAULT_DURATION_SEC,
          replay: openedSession.replay?.native_payload ?? null,
          replayFailure: openedSession.replay?.failure_reason ?? null,
        });

        if (outcome.status === 'failed') {
          setFailureReason(outcome.reason);
        }

        // El resultado se envía SIEMPRE, también cuando falla: los intentos
        // fallidos son la telemetría más útil al desplegar videoselfie en piso.
        const submitted = await submitScanResults({
          sessionId: openedSession.session_id,
          status: outcome.status,
          results: outcome.status === 'finished' ? outcome.results : null,
          failureReason: outcome.status === 'failed' ? outcome.reason : null,
          durationSec: openedSession.duration_sec || DEFAULT_DURATION_SEC,
        });

        setNormalized(submitted.normalized ?? null);
      } catch (caught) {
        const message =
          caught instanceof VitalsSetupError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : String(caught);
        setError(message);
        setPhase('failed');
      } finally {
        unsubscribe?.();
        providerRef.current?.dispose();
        providerRef.current = null;
        runningRef.current = false;
      }
    },
    [handleEvent, reset],
  );

  const cancel = useCallback(() => {
    providerRef.current?.cancel();
  }, []);

  return {
    phase,
    renderMode,
    progressPct,
    timerLabel: formatTime(remainingSec),
    tiles,
    statusHint,
    session,
    normalized,
    failureReason,
    error,
    isRunning: phase === 'preparing' || phase === 'positioning' || phase === 'measuring' ||
      phase === 'finalizing',
    start,
    cancel,
    reset,
  };
}
