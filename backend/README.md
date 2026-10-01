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
el video local sin el recorrido de ida y vuelta por WebRTC. MediaPipe prepara la
toma con una secuencia de frente, izquierda, derecha y regreso al centro. Cada
posición debe mantenerse y el regreso requiere dos segundos de estabilidad.
Los giros usan un cambio pequeño respecto a la postura frontal promediada de
cada usuario: entre 10 y 32 unidades angulares del estimador de landmarks,
en lugar de exigir 18–45 desde una referencia absoluta. Estos valores no son
ángulos físicos calibrados. Mantenerse al frente o girar al lado contrario no
completa el paso; perder el rostro reinicia también la referencia frontal.
La detección corre en un worker del navegador, a un máximo de 8 cuadros por
segundo durante la guía y 2 durante la grabación, sobre la misma región visible
de la cámara. Los giros no se incluyen en la grabación. Se graban 20 segundos
por defecto, con una pequeña reserva de 0.15 s para el último cuadro; el menú
permite elegir 30 segundos. Puede detenerse antes, pero menos de 20 segundos no
se analiza. Una ilustración con un giro leve y una flecha curva muestran la
posición a imitar; ambas siguen la misma orientación de la vista en espejo.
La indicación «Así está bien» confirma cuando el giro ya es suficiente.
Durante la captura, la UI avisa
si se pierde el rostro, entra otra persona, se sale del centro, gira la cara
o la exposición del rostro resulta insuficiente/excesiva. Si persiste 2.5 s,
descarta la toma localmente sin enviarla al análisis. Ocultar la pestaña
interrumpe la captura. Si falla el monitor, se indica y los controles del
backend siguen siendo obligatorios. Si no puede cargar la guía, muestra un error y
permite reintentar o subir un video; no afirma que la comprobación pasó.
La toma se envía al terminar, sin un segundo botón de «analizar».

La guía comprueba geometría y seguimiento del rostro, no identidad ni protección
contra fotos o videos. Los umbrales de orientación son operacionales y requieren
validación con usuarios. El indicador de luz usa exposición del rostro
detectado, con la imagen central como respaldo; no afirma calidad de pulso antes
del análisis. La respuesta del backend determina
el rechazo y los consejos. La recuperación distingue errores de captura de una señal de pulso débil tras
una captura aceptada. Permite consultar/exportar las causas y scores de calidad
(SQI/SNR), sin mostrar pulso/HRV rechazados ni señales BVP. Los criterios de
aceptación de los motores se conservan. Un método aceptado puede mostrarse
aunque el otro se rechace; las métricas rechazadas siempre se ocultan. El menú permite cambiar
métodos, aportar una referencia simultánea, subir videos y cerrar la sesión OIDC.

El componente transfiere la grabación por el canal de la sesión de Streamlit al
backend privado. `ui_bridge.py` limita el tamaño a 50 MB, valida Base64, formato,
método y referencia. La UI deduplica el evento y libera el payload al recibir el
resultado. No se guardan videos ni resultados personales de manera persistente.
Requiere un navegador con `getUserMedia` y MediaRecorder (Safari/Chrome modernos).
La guía también requiere Web Workers, ImageBitmap y OffscreenCanvas.
`capture.py` conserva el capturador anterior para compatibilidad, pero la interfaz
nueva ya no usa WebRTC ni reduce la grabación a 320 píxeles. Ambos motores siguen
recibiendo el mismo video normalizado a un máximo de 640 píxeles.

## Pruebas

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests -q
node --test frontend/*.test.mjs
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

Antes de servir la UI ejecuta `python3 install-face-guide.py`. Descarga
`@mediapipe/tasks-vision@1.0.1` y Face Landmarker float16 versión 1 desde sus
fuentes oficiales, verifica SHA-256 y coloca el runtime/modelo en
`frontend/vendor/mediapipe/` (ignorado por Git). Incluye ese directorio en cada
release: todos los assets se sirven desde Selfie, sin CDN ni envío de imágenes
a Google. `MANIFEST.json` contiene los hashes de cada archivo. El paquete declara
licencia Apache-2.0; consulta [la guía y tarjetas de los modelos](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker#models)
para la procedencia y limitaciones de los modelos.

`deploy/onescan-open-api.service` usa el entorno aislado del servidor y
`/opt/onescan/current/backend`. El drop-in `deploy/rppg-ui-override.conf` cambia
únicamente el punto de entrada de la UI y conserva sus variables OIDC originales.
No modifica nginx, el backend original ni los servicios de Labs.

Se guardan releases independientes en `/opt/onescan/releases/`. Antes de activar
el drop-in se verifica `/health`, carga de pesos e inferencia de ambos motores.
Para revertir la UI se retira únicamente el drop-in `onescan.conf` de
`/etc/systemd/system/rppg-ui.service.d/`, se ejecuta `systemctl daemon-reload` y
se reinicia `rppg-ui.service`. Su unidad original conserva la aplicación anterior.
