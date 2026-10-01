# OneScan: comparación de motores open source

La aplicación recibe un video real de 20–60 segundos y ejecuta open-rppg/FacePhys,
el motor original de rPPG-Toolbox o ambos sobre el mismo video normalizado. La
grabación usa MediaRecorder y conserva los tiempos reales del navegador; acepta videos a 15–60 FPS sin cambiar la
duración. Valida presencia del rostro a lo largo del video, iluminación, movimiento
y calidad de la señal. Los resultados rechazados no contienen pulso ni variabilidad.

La API devuelve estimaciones de pulso y variabilidad, señal BVP, calidad, tiempos
de procesamiento y comparación con una referencia opcional. No devuelve presión
arterial, SpO₂ ni HbA1c. Los umbrales son operacionales, no validación clínica.
La variabilidad obtenida del pulso de cámara tampoco equivale automáticamente a
HRV medida mediante ECG.

## Instalación reproducible

Python 3.10–3.13:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
bash install-open-rppg.sh vendor/open-rppg
export OPEN_RPPG_PATH="$PWD/vendor/open-rppg"
export LEGACY_RPPG_URL=http://127.0.0.1:8000
.venv/bin/python -m uvicorn onescan_api.main:app --host 127.0.0.1 --port 8001 --workers 1
```

El código de open-rppg se fija al commit `4d24237e7b14e17429b49d0334f2282b7d2fd159`.
Su código tiene licencia MIT; los pesos están sujetos a sus licencias originales.
No se redistribuyen los pesos en este repositorio. Esa licencia del código no
establece por sí sola derechos de uso comercial sobre cada modelo.

El motor original sigue corriendo en `rppg-api.service` desde `/opt/rppg-toolbox`.
El nuevo backend usa un entorno aislado y escucha únicamente en loopback. No
se publica como API anónima. Streamlit conserva el login OIDC de Proxant mediante
el helper original y el `EnvironmentFile` del servicio; no se copian secretos al repo.
Los archivos temporales de video se eliminan al terminar y no se guardan resultados
en Supabase/Medplum. El usuario puede descargar su JSON.

## Interfaz móvil y captura

La UI autenticada sirve un componente estático propio desde `frontend/`. Sigue
el diseño aprobado: preparación con consejos, cámara con guía ovalada y contador
circular, y recuperación ilustrada. La cámara se solicita únicamente al pulsar
«Estoy listo». Pide 1280×720 a 30 FPS (según lo que soporte el dispositivo), muestra
el video local sin el recorrido de ida y vuelta por WebRTC, y graba 30 segundos
con MediaRecorder. Puede detenerse antes, pero menos de 20 segundos no se analiza.
La toma se envía al terminar, sin un segundo botón de «analizar».

El indicador de luz usa exposición de la imagen central; no afirma detección de
rostro ni calidad de pulso antes del análisis. La respuesta del backend determina
el rechazo y los consejos. Un método aceptado puede mostrarse aunque el otro se
rechace; las métricas rechazadas siempre se ocultan. El menú permite cambiar
métodos, aportar una referencia simultánea, subir videos y cerrar la sesión OIDC.

El componente transfiere la grabación por el canal de la sesión de Streamlit al
backend privado. `ui_bridge.py` limita el tamaño a 50 MB, valida Base64, formato,
método y referencia. La UI deduplica el evento y libera el payload al recibir el
resultado. No se guardan videos ni resultados personales de manera persistente.
Requiere un navegador con `getUserMedia` y MediaRecorder (Safari/Chrome modernos).
`capture.py` conserva el capturador anterior para compatibilidad, pero la interfaz
nueva ya no usa WebRTC ni reduce la grabación a 320 píxeles. Ambos motores siguen
recibiendo el mismo video normalizado a un máximo de 640 píxeles.

## Pruebas

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests -q
node --test frontend/core.test.mjs
```

Las pruebas de la interfaz requieren `requirements-ui.txt`; el resto corre con
el entorno de la API. Comprueban duración y frecuencia tras remuestrear 15/24/30/60 FPS,
tiempos variables, ausencia de rostro, supresión de métricas de mala calidad,
errores de archivo, exclusión mutua de escaneos y cálculo de errores de referencia.

Para comparar videos con referencias simultáneas, prepara un CSV:

```csv
id,video,reference_bpm,capture_kind
scan-01,video-01.mp4,72,human
integration-test,synthetic.mp4,,synthetic
```

```bash
.venv/bin/python benchmark.py samples.csv --output validation-results/benchmark.json
```

El resumen incluye cantidad aceptada/rechazada, latencia y MAE solo para videos
humanos con referencia. Los fixtures sintéticos nunca se incluyen en el MAE.
Que los motores coincidan no demuestra precisión. Antes de escoger uno deben
compararse condiciones de luz, movimiento, teléfonos y personas diferentes.

## Despliegue en selfie

`deploy/onescan-open-api.service` usa el entorno aislado del servidor y
`/opt/onescan/current/backend`. El drop-in `deploy/rppg-ui-override.conf` cambia
únicamente el punto de entrada de la UI y conserva sus variables OIDC originales.
No modifica nginx, el backend original ni los servicios de Labs.

Se guardan releases independientes en `/opt/onescan/releases/`. Antes de activar
el drop-in se verifica `/health`, carga de pesos e inferencia de ambos motores.
Para revertir la UI se retira únicamente el drop-in `onescan.conf` de
`/etc/systemd/system/rppg-ui.service.d/`, se ejecuta `systemctl daemon-reload` y
se reinicia `rppg-ui.service`. Su unidad original conserva la aplicación anterior.
