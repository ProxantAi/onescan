# Resultado de implementación — 2026-09-30

Implementación activa en https://selfie.proxant.ai/ mediante el release
`/opt/onescan/releases/20261001-camera-cues-v1`.

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

## Correcciones tras la prueba de usuario — 30 septiembre 2026

La duración predeterminada se redujo a 20 segundos (30 opcionales en el menú),
con una reserva de 0.15 s para evitar quedar debajo del mínimo por el último
cuadro. Se sustituyeron las flechas por un ejemplo de rostro en la misma
orientación que la vista espejo y se añadieron ojos a ambas ilustraciones.

La guía ahora revisa exposición sobre la región detectada del rostro. Durante
la grabación mantiene el worker a 2 FPS para avisar de ausencia/múltiples
rostros, descentramiento, giros o mala exposición. Un problema continuo de
2.5 s interrumpe la captura sin enviar video; ocultar la pestaña también la
interrumpe. No es una medición de calidad fisiológica en vivo. La API conserva
SQI >= 0.5, SNR >= 0 dB, los criterios de rostro/movimiento y supresión de
métricas rechazadas; no se redujeron umbrales para aparentar éxito.

Se corrigió la recuperación: ya no atribuye a luz o movimiento todos los
rechazos de pulso. Si la captura pasó, lo explica por separado y muestra causas
de cálculo/quality scores en detalles descargables, sin pulso/HRV rechazados
ni waveform. La fotografía del mensaje anterior solo demuestra el código
genérico `low_signal_quality`; no contiene los scores de aquella toma y no
permite determinar retrospectivamente cuál falló.

Verificación de regresión: 33 pruebas Python y 14 JavaScript. El harness local
completó una grabación de aproximadamente 20.2 s y recibió una respuesta
sintética de rechazo tras captura aceptada, verificando la nueva explicación
y la ocultación de métricas. Los mocks permanecen fuera del release.

En otra prueba local, los giros se simularon solo para llegar a la etapa de
captura y el modelo real de MediaPipe verificó la fotografía de ejemplo durante
la grabación a 2 FPS. El video resultante conservó 1280×720, 607 cuadros,
20.196 s, 30.055 FPS y un intervalo máximo de 0.066 s. El validador real de
video lo aceptó sin relajar sus controles. Esto verifica rendimiento en esta
máquina, no todos los teléfonos ni calidad fisiológica del fixture estático.

El harness de pérdida de rostro interrumpió la grabación tras una ausencia
persistente, terminó el worker y mostró `no_face` sin emitir ninguna solicitud
de análisis. La prueba utiliza poses sintéticas y valida el flujo de aborto;
sigue pendiente la prueba con cámara física del usuario.

## Giros pequeños y flecha curva — 30 septiembre 2026

Tras la prueba con cámara del usuario se redujo el cambio requerido de yaw del
estimador: de 18–45 respecto a cero a 10–32 respecto a la postura frontal
promediada del usuario. No son ángulos físicos calibrados. Se conserva el orden,
la permanencia de cada posición, la estabilidad frontal de dos segundos y todos
los controles de rostro, exposición, captura y calidad de los motores.

Se añadió una flecha curva junto a un ejemplo de giro más leve, con dirección
coherente con la vista en espejo y texto que confirma cuándo dejar de girar.
16 pruebas JavaScript pasan, incluidas giros pequeños desde una postura neutral
desplazada, rechazo del giro contrario, ausencia de movimiento, sobrepaso del
rango y reinicio de la referencia tras perder el rostro. En el harness local,
una postura neutral de -4 y giros de +12/-12 respecto a ella completaron la
preparación e iniciaron la grabación; se comprobó visualmente la flecha junto al
ejemplo. Los mocks siguen fuera del repositorio y del release. Esta corrección
aún requiere confirmar la comodidad con la cámara física del usuario.

## Flechas sobre cámara y dirección corregida — 1 octubre 2026

Se corrigió la inversión del signo de yaw: el cálculo anterior usaba la
diferencia de profundidad de ojos en el sentido opuesto al de la nariz en
la vista espejo. La convención de profundidad se verificó en la
[documentación oficial de MediaPipe](https://developers.google.com/edge/api/mediapipe/java/com/google/mediapipe/tasks/components/containers/NormalizedLandmark).
La regresión rota/proyecta una cara 3D virtual y comprueba que el sentido de
la nariz en espejo coincide con el paso que acepta el detector y su flecha;
no asigna un resultado de yaw para dar por correcta la fórmula.

La flecha ahora está dentro del recuadro de cámara. Se reemplazó la barra fina
de permanencia por un anillo de 6 px sobre el óvalo, un aviso verde/check de
0.9 s, checks en cada paso y una etiqueta persistente del último paso
completado dentro de la cámara. La captura espera la confirmación final y
solo arranca si sigue recibiendo cuadros válidos/frescos; pérdida de rostro,
cancelación o pestaña oculta cancelan ese arranque pendiente.

19 pruebas JavaScript pasan, incluidos orientación por proyección 3D,
confirmación visible/persistente y arranque diferido válido, con rostro perdido,
cancelado, oculto y con cuadros obsoletos. Los controles fisiológicos y la API
no cambiaron. Falta confirmar la dirección y percepción con la cámara física
del usuario; la comprobación del navegador usa poses sintéticas.

En el harness del navegador se comprobó que un giro opuesto no avanza, que
las flechas izquierda/derecha están dentro de `.camera-view`, que los giros
indicados completan sus pasos y que los avisos de cada paso duran unos 1.0 s
con el muestreo de 8 FPS. La etiqueta `✓ Giro 1 completado` permaneció visible
durante Giro 2, y `✓ Giro 2 completado` durante el regreso al centro.
La grabación comenzó 907 ms después de `Centro listo`, duró aproximadamente
20.2 s y emitió una sola solicitud de análisis al backend simulado del harness.
