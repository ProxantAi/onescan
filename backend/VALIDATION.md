# Resultado de implementación — 2026-09-30

Implementación activa en https://selfie.proxant.ai/ mediante el release
`/opt/onescan/releases/20260930-open-source-v2`.

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
