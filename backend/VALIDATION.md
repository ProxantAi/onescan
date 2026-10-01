# Resultado de implementación — 2026-09-30

Implementación activa en https://selfie.proxant.ai/ mediante el release
`/opt/onescan/releases/20260930-face-guide-v1`.

## Verificado

- 21 pruebas pasaron en macOS/Python 3.12: normalización a 15/24/30/60 FPS,
  tiempos variables, conservación de frecuencia, tiempos WebRTC entre batches,
  control de calidad, estados independientes entre escaneos, unidades pNN50,
  referencias, archivos inválidos, concurrencia y UI sin métricas rechazadas.
- En Linux/Python 3.10 pasaron 20 pruebas de la API/captura; se omitió la prueba
  de Streamlit porque ese entorno es independiente del runtime de la UI.
- La UI también se probó por separado con el runtime real del servidor mediante
  Streamlit AppTest. El helper de autenticación se sustituyó solo dentro de ese
  proceso de prueba, sin alterar el helper ni el servicio desplegado.
- La URL pública muestra `Proxant Selfie · Open Source` y conserva el acceso
  mediante Proxant Auth. No se ejecutó un inicio de sesión con credenciales nuevas.
- Los servicios `rppg-ui`, `rppg-api` y `onescan-open-api` están activos. Los
  backends escuchan en loopback; no se añadieron rutas API anónimas a nginx.
- El endpoint desplegado ejecutó FacePhys y EfficientPhys sobre un mismo fixture
  sintético de 20 segundos y rechazó un video sin rostro sin devolver pulso/HRV.

## Integración con fixture sintético

Se utilizó la fotografía pública de astronauta incluida en scikit-image, con una
modulación de color controlada. `tests/make_integration_fixture.py` permite
reproducirla. Es una prueba de funcionamiento, no un video humano de validación.

| Motor | Modelo usado | Procesamiento en el servicio desplegado |
|---|---|---|
| open-rppg | FacePhys.rlap | 4.018 s |
| rPPG-Toolbox | EfficientPhys | 7.156 s |

Ambos completaron inferencia sin recurrir a datos simulados como resultados de
respaldo. La entrada fue sintética; sus estimaciones no prueban precisión
fisiológica. Estos tiempos corresponden a una muestra y no a un benchmark general.

## Pendiente de medir

Se necesitan grabaciones humanas con referencia simultánea para determinar
error de pulso, tasa de rechazo y comportamiento en distintos teléfonos,
iluminación y movimiento. `benchmark.py` calcula MAE solo sobre esas referencias
humanas y excluye fixtures sintéticos. Tampoco se ha probado la cámara física de
un teléfono mediante el navegador en esta sesión.

Los resultados aún son experimentales. El nuevo flujo no entrega presión
arterial, SpO₂ ni HbA1c, ni se conecta a Supabase/Medplum de dev o producción.
Los JSON se descargan desde la UI; los videos temporales se eliminan al terminar.

## Recuperación

La aplicación anterior y su backend permanecen en `/opt/rppg-toolbox`. La unidad
original `rppg-ui.service` se conserva; solo se añadió el drop-in
`/etc/systemd/system/rppg-ui.service.d/onescan.conf`. Retirando ese drop-in y
recargando/reiniciando `rppg-ui.service` se recupera el punto de entrada anterior.
Las dependencias nuevas están aisladas en
`/home/daniel.esqueda/onescan-work/venv`; no se actualizaron las de la aplicación
anterior ni se modificaron los servicios de Labs.

## Rediseño móvil — 30 septiembre 2026

Se implementó la propuesta visual aprobada: guía de preparación, pantalla de
captura con óvalo/contador circular y recuperación con dos consejos ilustrados.
La comparación se conserva dentro del menú y de los resultados, sin controles
técnicos en la pantalla de grabación.

La vista previa ahora es local. MediaRecorder pide 1280×720/30 FPS y envía los
bytes originales al terminar los 30 segundos, sin el recorte previo a 320 px del
capturador de WebRTC. La API conserva todos sus controles de calidad y la misma
normalización para ambos motores. El indicador durante la toma evalúa únicamente
la exposición; la señal fisiológica y la presencia de rostro se evalúan después.

Verificación: 32 pruebas Python y 6 pruebas JavaScript; se comprobaron el canal
de Streamlit, decodificación de Base64, un solo envío por captura, supresión de
resultados rechazados y bloqueo de la interfaz antes del login OIDC. En una
instancia local aislada se completó una grabación real de MediaRecorder usando
un flujo sintético de canvas, se transmitió y se recibió una respuesta de rechazo
de prueba. El archivo se conservó a 1280×720, duró 29.96 s y tuvo 27.23 FPS de
promedio. Un intervalo de 0.66 s ocasionó correctamente rechazo por cuadros
perdidos al pasarlo por el validador real. No se relajó ese umbral para hacer pasar
el fixture. Los mocks de cámara/login/API existen únicamente en el harness local,
fuera del repositorio y del release desplegado.

Esto verifica transporte y comportamiento de interfaz. No establece precisión
con personas ni garantiza 720p/30 FPS en todos los dispositivos. Sigue pendiente
la validación con videos humanos y referencias simultáneas.

## Guía de movimientos — 30 septiembre 2026

Se añadió una preparación con detección real de MediaPipe: frente, izquierda,
derecha y regreso al centro con dos segundos de estabilidad. Los giros no se
graban ni se envían al backend; el worker se termina antes de iniciar el video
de pulso. Una posición incorrecta, cuadros discontinuos o múltiples rostros no
completan el paso. La pérdida de rostro durante 1.5 segundos reinicia la guía.
Los errores de carga/tiempo se muestran explícitamente, y cancelar libera cámara
y worker sin comenzar una grabación.

Verificación: 32 pruebas Python y 11 JavaScript. MediaPipe 1.0.1 y el modelo
oficial Face Landmarker float16 v1 se ejecutaron en un worker del navegador
contra la fotografía pública oficial `mediapipe-assets/portrait.jpg`: detectó
un rostro, estimó una orientación frontal y devolvió cero rostros con una imagen
vacía. Los assets se descargan con versiones y SHA-256 fijos y se sirven desde
Selfie; no se solicita un CDN durante la captura.

En un harness local aislado, con cámara de canvas y respuestas de pose
sintéticas, se verificó que el worker terminara antes de construir/iniciar
MediaRecorder, que el video se enviara una sola vez al terminar los 30 segundos
y que cancelar la guía no iniciara una nueva grabación. El harness no forma
parte del código ni del release. Estas pruebas validan funcionamiento, no
resistencia a suplantación ni precisión con movimientos humanos. Sigue
pendiente probar los giros con cámaras físicas y diferentes dispositivos.
