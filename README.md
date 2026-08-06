# Proxant · Demo de videoselfie (Checkup Cardiometabólico)

Prueba de concepto funcional del **HealthCheck CM por videoselfie**. El usuario
mira a la cámara durante unos segundos y se estiman sus signos vitales a partir
del flujo sanguíneo del rostro (fotopletismografía remota / rPPG).

La interfaz replica el look & feel de la app de Proxant: tema claro, tarjeta
**"Tus métricas"**, indicador de **estado general** con score y navegación
inferior.

## Dos modos

- **Demostración (por defecto)** — usa la **cámara real** del dispositivo
  (videoselfie con encuadre, temporizador, captura de señal y métricas que
  aparecen en tiempo real), pero **no requiere backend ni clave**: las métricas
  se generan localmente en rangos realistas. Funciona con solo `npm start`.
- **Real (`?real=1`)** — usa el motor de videobiometría real (inferencia en el
  dispositivo). Requiere los binarios del motor y una clave de activación.

## Métricas mostradas

Frecuencia cardíaca · Variabilidad (HRV) · Presión arterial · Frecuencia
respiratoria · Saturación de oxígeno · Estrés simpático · Análisis de voz ·
HbA1c · Estado general (score /100).

## Cómo ejecutar (modo demostración, sin requisitos)

1. Instala dependencias: `npm install` (o `yarn`).
2. Arranca el servidor: `npm start`.
3. Abre `http://localhost:3100` en **Google Chrome** y concede permiso de cámara.

Parámetros opcionales de URL:

- `?dur=15` — duración de la medición en segundos (por defecto 30).
- `?real=1` — usa el motor real (ver abajo).

## Modo real

1. Coloca los binarios del motor de videobiometría en esta carpeta como
   `shenai-sdk` (debe quedar `shenai-sdk/index.mjs`).
2. Coloca tu clave de activación en [`app-config.js`](./app-config.js)
   (`API_KEY`) o pásala por la URL: `?apiKey=TU_CLAVE`.
3. Abre la demo con `http://localhost:3100/?real=1`.

> El servidor usa cabeceras `Cross-Origin-Opener-Policy` y
> `Cross-Origin-Embedder-Policy` (ver `serve.json`). La cámara requiere `https`
> o `localhost`.

## Notas

- Es una **demostración**: las estimaciones no constituyen un diagnóstico
  médico. La clasificación de rangos en pantalla es orientativa.
- Personalización (métricas, duración, idioma) en `assets/js/app.js`.
