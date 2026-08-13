// Cliente de la Edge Function `health-capture`.
//
// Dos llamadas: abrir sesión y entregar el resultado. El escenario y la fuente
// los decide el SERVIDOR — aquí no se lee ningún query param, a propósito: el
// spike exige que el paciente no pueda elegir su escenario.

import { getDeviceId } from '../lib/deviceId';
import type { MeasurementResults, ScanSource, FailureReason } from '../vitals/types';

const FUNCTION_NAME = 'health-capture';

/** Clasificaciones que calcula el backend. El frontend no duplica umbrales
 *  clínicos: tenerlos en dos lenguajes es garantía de que se desincronicen. */
export interface NormalizedMetric {
  value: number | null;
  secondary: number | null;
  unit: string;
  level: 'low' | 'optimal' | 'normal' | 'elevated' | 'high' | 'unknown';
  label: string;
}

export interface NormalizedScan {
  schema_version: number;
  ranges_version: number;
  bp_standard: string;
  metrics: Record<string, NormalizedMetric>;
  score: number | null;
  verdict: { label: string; hint: string; tone: string };
  advanced: {
    cardiac_workload_mmhg_per_sec: number | null;
    hrv_lnrmssd_ms: number | null;
    bmi_kg_per_m2: number | null;
    bmi_category: string | null;
    average_signal_quality: number;
  };
  coherence_warnings: string[];
}

export interface ScanSession {
  session_id: string;
  tenant_id: string;
  source: ScanSource;
  scenario: string | null;
  duration_sec: number;
  status: string;
  expires_at: string;
  linked_to_health_plan?: boolean;
  /** presente sólo en sesiones sintéticas: el payload nativo a reproducir */
  replay?: {
    outcome: 'finished' | 'failed';
    failure_reason: FailureReason | null;
    native_payload: MeasurementResults | null;
  };
}

export interface SubmitResult {
  scan_id: string;
  measurement_status: 'finished' | 'failed';
  is_synthetic?: boolean;
  plan_url?: string | null;
  plan_message?: string | null;
  retryable?: boolean;
  failure_reason?: string | null;
  normalized: NormalizedScan | null;
}

async function getClient() {
  // Import perezoso: lib/supabase.ts lanza al cargarse si faltan las env vars, y
  // queremos que eso llegue como error manejable, no como pantalla en blanco.
  const { supabase } = await import('../lib/supabase');
  return supabase;
}

/** `functions.invoke` esconde el cuerpo del error en `context`; sin esto sólo se
 *  ve "Edge Function returned a non-2xx status code". Mismo helper que usa
 *  caredesk-health en services/enrollments.ts. */
async function describeError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* el cuerpo no era JSON */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function getLinkToken(): string | null {
  const token = new URLSearchParams(window.location.search).get('t');
  return token && token.trim().length > 0 ? token.trim() : null;
}

export async function openScanSession(): Promise<ScanSession> {
  const supabase = await getClient();
  const token = getLinkToken();

  const { data, error } = token
    ? await supabase.functions.invoke<ScanSession & { ok: boolean }>(
        `${FUNCTION_NAME}/sessions/by-token/${encodeURIComponent(token)}`,
        { method: 'GET' },
      )
    : await supabase.functions.invoke<ScanSession & { ok: boolean }>(
        `${FUNCTION_NAME}/sessions`,
        { body: { device_id: getDeviceId() } },
      );

  if (error) throw new Error(await describeError(error));
  if (!data) throw new Error('El backend no devolvió una sesión de escaneo');
  return data;
}

export async function fetchScanSession(sessionId: string): Promise<ScanSession> {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke<ScanSession & { ok: boolean }>(
    `${FUNCTION_NAME}/sessions/${sessionId}`,
    { method: 'GET' },
  );

  if (error) throw new Error(await describeError(error));
  if (!data) throw new Error('Sesión de escaneo no encontrada');
  return data;
}

export interface SubmitInput {
  sessionId: string;
  status: 'finished' | 'failed';
  results: MeasurementResults | null;
  failureReason: FailureReason | null;
  durationSec: number;
  sdkVersion?: string | null;
}

export async function submitScanResults(input: SubmitInput): Promise<SubmitResult> {
  const supabase = await getClient();
  const { data, error } = await supabase.functions.invoke<SubmitResult & { ok: boolean }>(
    `${FUNCTION_NAME}/sessions/${input.sessionId}/results`,
    {
      body: {
        measurement_status: input.status,
        native_payload: input.results,
        failure_reason: input.failureReason,
        provider_version: input.sdkVersion ?? null,
        captured_at: new Date().toISOString(),
        client: {
          user_agent: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          locale: navigator.language,
          duration_sec: input.durationSec,
        },
      },
    },
  );

  if (error) throw new Error(await describeError(error));
  if (!data) throw new Error('El backend no confirmó el resultado');
  return data;
}
