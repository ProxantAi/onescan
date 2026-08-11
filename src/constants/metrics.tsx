import type { JSX } from 'react';

export const RING_LEN = 2 * Math.PI * 19;

export const ICONS = {
  heart: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17">
      <path
        d="M12 20s-6-3.7-8.5-7.3C2 10.4 3.2 7.5 6 7.5c1.7 0 2.8.9 3.9 2.3C11 8.4 12 7.5 12 7.5s1 .9 2.1 2.3C16.2 8.4 17.3 7.5 19 7.5c2.8 0 4 2.9 2.5 5.2C19 16.3 12 20 12 20z"
        fill={c}
      />
    </svg>
  ),
  pulse: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
      <path
        d="M3 12h3l2-5 3.5 10L15 9l1.5 3H21"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  drop: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17">
      <path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z" fill={c} />
    </svg>
  ),
  wind: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
      <path
        d="M3 8h9a2.3 2.3 0 1 0-2.3-2.3M3 16h13a2.3 2.3 0 1 1-2.3 2.3M3 12h7"
        stroke={c}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  bars: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
      <path d="M6 20v-7M12 20V6M18 20v-5" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
  leaf: (c: string) => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none">
      <path
        d="M5 19c0-7 5-12 14-12 0 9-5 13-11 13-1.5 0-3-.4-3-1z"
        stroke={c}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 18c2-4 5-6 8-7" stroke={c} strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
} as const;

export type IconName = keyof typeof ICONS;

/**
 * Claves de métrica. Coinciden exactamente con las que devuelve el backend en
 * `normalized.metrics`.
 *
 * Se quitaron SpO2, Análisis de Voz y HbA1c: el SDK de Shen.AI no las entrega,
 * así que en modo real salían siempre como "–" mientras en modo demo se
 * inventaban. Mostrar una métrica que la fuente real nunca podrá llenar rompe la
 * promesa de que cambiar sintético→real no cambia nada.
 *
 * En su lugar entra Actividad Parasimpática, que sí viene del SDK. La carga
 * cardiaca y la calidad de señal también vienen, pero no son legibles para un
 * paciente de farmacia: van en la sección de detalle del resumen, no en la
 * rejilla principal.
 */
export type MetricKey = 'hr' | 'hrv' | 'bp' | 'resp' | 'stress' | 'parasym';

export interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  color: string;
  icon: IconName;
}

export const METRICS: MetricDef[] = [
  { key: 'hr', label: 'Frecuencia\nCardíaca', unit: 'lpm', color: '#FF5C6C', icon: 'heart' },
  { key: 'hrv', label: 'Variabilidad\n(HRV)', unit: 'ms', color: '#2D9CDB', icon: 'pulse' },
  { key: 'bp', label: 'Presión\nArterial', unit: 'mmHg', color: '#F2994A', icon: 'drop' },
  { key: 'resp', label: 'Frecuencia\nRespiratoria', unit: 'rpm', color: '#EC6A9C', icon: 'wind' },
  { key: 'stress', label: 'Estrés\nSimpático', unit: '', color: '#13B6A2', icon: 'bars' },
  { key: 'parasym', label: 'Actividad\nParasimpática', unit: '%', color: '#7C6CF0', icon: 'leaf' },
];

/** Búsqueda por clave. El código anterior indexaba METRICS[7] a mano, lo que se
 *  rompía en silencio al recortar el catálogo. */
export function metricByKey(key: MetricKey): MetricDef {
  const found = METRICS.find((m) => m.key === key);
  if (!found) throw new Error(`Unknown metric key: ${key}`);
  return found;
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function formatLabel(label: string): JSX.Element[] {
  return label.split('\n').map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {line}
    </span>
  ));
}

export function stripBr(s: string): string {
  return s.replace(/\n/g, ' ');
}

/** mm:ss. El original fijaba "00:" en duro, así que un preset de 45 o 60
 *  segundos habría mostrado "00:45" y "00:60". */
export function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Tono → clase CSS del tag. Antes todos los tags eran verdes en duro, así que
 *  un resultado hipertenso se veía igual de sano que uno normal. */
export function toneClass(tone: string | undefined): string {
  switch (tone) {
    case 'good':
      return 'tag--good';
    case 'warn':
      return 'tag--warn';
    case 'bad':
      return 'tag--bad';
    default:
      return 'tag--muted';
  }
}

/** El backend manda `level`; el tono de color se deriva aquí porque es presentación. */
export function levelTone(level: string | undefined): string {
  switch (level) {
    case 'optimal':
    case 'normal':
      return 'good';
    case 'elevated':
    case 'low':
      return 'warn';
    case 'high':
      return 'bad';
    default:
      return 'muted';
  }
}
