// Registro de fuentes de datos vitales.
//
// Es el único lugar del frontend donde se decide qué implementación corre.
// Nada después de este punto vuelve a preguntar "¿sintético o real?": el resto
// del código habla con `VitalsProvider` y con `MeasurementResults`.
//
// Añadir una tercera fuente (Google Health, Apple HealthKit) es registrar otra
// clave aquí; ni la pantalla de escaneo ni el envío al backend cambian.

import type { ScanSource, VitalsProvider } from './types';

export interface ProviderConfig {
  shenaiApiKey: string;
  shenaiUserId: string;
}

type Factory = (config: ProviderConfig) => Promise<VitalsProvider>;

const registry = new Map<ScanSource, Factory>();

export function registerProvider(source: ScanSource, factory: Factory): void {
  registry.set(source, factory);
}

export async function createProvider(
  source: ScanSource,
  config: ProviderConfig,
): Promise<VitalsProvider> {
  const factory = registry.get(source);
  if (!factory) throw new Error(`No vitals provider registered for source "${source}"`);
  return factory(config);
}

// Import dinámico en ambos: mantiene el envoltorio del SDK (y su `new Function`)
// fuera del chunk inicial de la demo, que nunca lo necesita.
registerProvider('synthetic', async () => {
  const { SyntheticProvider } = await import('./synthetic/SyntheticProvider');
  return new SyntheticProvider();
});

registerProvider('real', async (config) => {
  const { ShenAiProvider } = await import('./shenai/ShenAiProvider');
  return new ShenAiProvider({ apiKey: config.shenaiApiKey, userId: config.shenaiUserId });
});
