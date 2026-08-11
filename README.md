# Proxant · Demo de videoselfie (Checkup Cardiometabólico)

Prueba de concepto funcional del **HealthCheck CM por videoselfie**. El usuario
mira a la cámara unos segundos y se estiman sus signos vitales a partir del flujo
sanguíneo del rostro (fotopletismografía remota / rPPG).

## Arquitectura: proveedores intercambiables

La demo está construida sobre un **patrón wrapper**, para que dejar de usar el
backend simulado y pasar al SDK real de Shen.AI no obligue a rehacer el flujo:

```
POST /health-capture/sessions      → el SERVIDOR decide fuente y escenario
        ↓
   VitalsProvider ──┬── SyntheticProvider  (reproduce el fixture del servidor)
                    └── ShenAiProvider     (@shenai/sdk, motor wasm en el cliente)
        ↓ MeasurementResults  ← MISMO TIPO en ambas ramas
        ↓
POST /health-capture/sessions/:id/results   → Supabase guarda nativo + normalizado
```

La regla que hace barato el cambio: **nada después del provider sabe cuál corrió.**
`src/hooks/useScan.ts` no tiene un solo `if (synthetic)`. Lo único que varía es
una clase CSS, derivada de `provider.renderMode`, que decide qué superficie de
video se muestra.

El tipo `MeasurementResults` **no se redefine**: se importa de `@shenai/sdk` con
`import type`. Los tipos se borran en el build (el bundle no arrastra los 34 MB
de wasm) pero el compilador verifica que la fuente sintética cumple el contrato
real. Si el proveedor cambia el shape, deja de compilar.

| Carpeta | Qué hay |
|---|---|
| `src/vitals/types.ts` | El contrato: `VitalsProvider`, `ScanEvent`, `ScanOutcome` |
| `src/vitals/factory.ts` | Registro de fuentes (añadir Google Health = registrar otra clave) |
| `src/vitals/synthetic/` | Provider de replay + renderers (cámara, malla, traza PPG) |
| `src/vitals/shenai/` | Provider real sobre el SDK + carga del motor wasm |
| `src/services/healthCapture.ts` | Cliente de la Edge Function |
| `src/hooks/useScan.ts` | Orquesta sesión → provider → envío |

**Los umbrales clínicos y el score viven sólo en el backend**
(`supabase-backend/volumes/functions/health-capture/adapters/`). El frontend
consume el bloque `normalized` que devuelve la ingesta. Tenerlos también aquí
sería garantía de que las dos copias se desincronicen.

## Escenarios sintéticos

Los decide el servidor (`tenant_features.config` con `feature_key = 'health_scan'`),
nunca la URL: el paciente no debe poder elegir su resultado. Los fixtures viven
en el backend.

`normal-v1` · `hypertension-v1` · `tachycardia-stress-v1` · `incomplete-v1` ·
`poor-signal-v1` (medición fallida: pide repetir el escaneo).

## Stack

React 19 · Vite 6 · TypeScript (`strict`) · Supabase JS · Vitest

## Cómo ejecutar

1. `npm install`
2. `cp .env.example .env.local` y rellena `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
   (en local, Kong escucha en `http://localhost:8000`).
3. `npm start` y abre `http://localhost:3100` en **Google Chrome**, concediendo cámara.

| Comando | Descripción |
|---|---|
| `npm start` / `npm run dev` | Servidor de desarrollo en el puerto 3100 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Suite de contrato (misma suite contra ambos providers) |
| `npm run build` | Typecheck + build de producción en `dist/` |

## Modo real

El modo lo activa el backend devolviendo `source: "real"` en la sesión; ya no
existe `?real=1`.

1. Coloca los binarios del motor en `public/shenai-sdk/` (debe quedar
   `public/shenai-sdk/index.mjs`). El paquete npm ya los trae:
   `cp -r node_modules/@shenai/sdk public/shenai-sdk`
2. Pon la clave de activación en `VITE_SHENAI_API_KEY` (sólo para desarrollo;
   en producción la entrega el backend dentro de la sesión).

> **Aviso de despliegue.** El motor wasm necesita `SharedArrayBuffer`, que sólo
> existe en un contexto aislado. `vite.config.ts` emite `Cross-Origin-Opener-Policy`
> y `Cross-Origin-Embedder-Policy` en dev y preview, pero **eso no cubre
> producción**: el build es estático, así que nginx/Caddy debe emitir las mismas
> cabeceras. Si no, el modo sintético funciona en producción y el real falla
> sólo ahí.

## Notas

- Es una **demostración**: las estimaciones no constituyen un diagnóstico médico.
  La clasificación de rangos es orientativa y está bajo revisión clínica
  (`adapters/ranges.ts`, constante `BP_STANDARD`).
- Sólo se muestran métricas que el SDK real entrega. SpO2, análisis de voz y
  HbA1c se retiraron: Shen.AI no las devuelve, así que en modo real salían
  siempre vacías mientras en modo demo se inventaban.
