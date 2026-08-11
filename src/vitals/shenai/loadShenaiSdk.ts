// Carga del motor Shen.AI en runtime.
//
// Los tipos vienen del paquete npm `@shenai/sdk` (devDependency, sólo `import
// type`), pero el BINARIO se sigue cargando por URL desde
// `${BASE_URL}shenai-sdk/index.mjs`. No es un capricho: el SDK está bajo
// licencia y pesa ~34 MB de wasm, así que no se versiona en el repo ni se
// empaqueta en el bundle de la demo — se deposita en `public/shenai-sdk/` en el
// despliegue que tenga clave.
//
// Si quieres probarlo en local, el propio paquete npm trae los archivos:
//   cp -r node_modules/@shenai/sdk public/shenai-sdk
//
// El `new Function` evita que Vite intente resolver la ruta en build (el
// directorio no existe en el repo). Ojo: necesita `unsafe-eval`, así que si
// algún día se añade CSP hay que exceptuar esto o pasar a import dinámico real.

import type { ShenaiSDK } from '@shenai/sdk';
import { VitalsSetupError } from '../types';

type ShenaiModule = { default: (args?: Record<string, unknown>) => Promise<ShenaiSDK> };

const runtimeImport = new Function('url', 'return import(url)') as (
  url: string,
) => Promise<ShenaiModule>;

export function getShenaiSdkUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}shenai-sdk/index.mjs`.replace(/\/{2,}/g, '/');
}

export async function loadShenaiSdk(): Promise<ShenaiSDK> {
  let module: ShenaiModule;
  try {
    module = await runtimeImport(getShenaiSdkUrl());
  } catch (error) {
    throw new VitalsSetupError(
      `No se pudo cargar el motor de análisis desde ${getShenaiSdkUrl()}: ${String(error)}`,
      'sdk_unavailable',
    );
  }

  try {
    return await module.default();
  } catch (error) {
    throw new VitalsSetupError(
      `El motor de análisis no pudo inicializar su runtime: ${String(error)}`,
      'sdk_unavailable',
    );
  }
}
