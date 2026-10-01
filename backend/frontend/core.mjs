export const TARGET_SECONDS = 20;
// Leave one frame of margin at the boundary without displaying a longer timer.
export const STOP_SECONDS = TARGET_SECONDS + .15;
export const MIN_SECONDS = 20;
export const MAX_BYTES = 50 * 1024 * 1024;
export const REASONS = {
  face_guide_unavailable: ['No pudimos iniciar la guía del rostro.', 'Actualiza Safari o Chrome y vuelve a intentar.', 'También puedes subir un video desde el menú.'],
  face_guide_timeout: ['No pudimos completar los movimientos.', 'Imita el giro que muestra la guía.', 'Vuelve al centro y mantente quieto.'],
  face_not_front: ['Tu rostro dejó de mirar al frente.', 'Mira a la cámara durante la captura.', 'Los giros terminan antes de grabar.'],
  face_out_of_frame: ['Tu rostro salió del centro de la toma.', 'Mantén el rostro dentro del óvalo.', 'Apoya el teléfono a la altura de tus ojos.'],
  capture_interrupted: ['La captura se interrumpió.', 'Mantén esta pantalla abierta mientras grabas.', 'La captura dura 20 segundos.'],
  no_face: ['No pudimos ver tu rostro durante toda la toma.', 'Coloca el teléfono a la altura de tus ojos.', 'Mantén tu rostro dentro del óvalo.'],
  multiple_faces: ['Apareció más de un rostro.', 'Graba sin otras personas en cámara.', 'Mantén tu rostro centrado.'],
  poor_lighting: ['Necesitamos más luz sobre tu rostro.', 'Busca una luz uniforme frente a ti.', 'Evita ventanas detrás de ti.'],
  excessive_motion: ['La imagen tuvo demasiado movimiento.', 'Apoya el teléfono a la altura de tus ojos.', 'Evita hablar y mover la cabeza.'],
  capture_too_slow: ['La cámara perdió demasiados cuadros.', 'Mejora la luz y cierra otras aplicaciones.', 'Apoya el teléfono durante la grabación.'],
  video_too_short: ['La toma fue demasiado corta.', 'Graba durante al menos 20 segundos.', 'La captura termina sola a los 20 segundos.'],
  low_signal_quality: ['El análisis no encontró un pulso suficientemente claro.', 'Usa luz natural uniforme frente a ti.', 'Prueba una toma más larga desde el menú.'],
  engine_error: ['No pudimos completar el análisis.', 'Espera unos momentos y vuelve a intentar.', 'Si continúa, prueba el otro método en el menú.'],
  unavailable: ['El análisis no está disponible por ahora.', 'Espera unos momentos antes de repetir.', 'Puedes volver a analizar un video desde el menú.'],
  busy: ['Hay otra captura en análisis.', 'Espera a que termine antes de repetir.', 'Intenta nuevamente en unos momentos.'],
  timeout: ['El análisis está tardando demasiado.', 'Espera antes de volver a intentarlo.', 'El servicio puede seguir procesando tu toma.'],
  camera_denied: ['Necesitamos permiso para usar tu cámara.', 'Permite la cámara en tu navegador.', 'Después vuelve a intentar la captura.'],
  camera_missing: ['No encontramos una cámara disponible.', 'Conecta una cámara o libera la que estés usando.', 'También puedes subir un video desde el menú.'],
  invalid_video: ['No pudimos leer esta grabación.', 'Usa un video de 20 a 60 segundos.', 'Formatos admitidos: MP4, MOV y WebM.'],
};
export function acceptedResults(data) {
  return (data?.results || []).filter(x => x.accepted === true && Number.isFinite(x.heart_rate_bpm) && x.heart_rate_bpm >= 30 && x.heart_rate_bpm <= 220);
}
export function rejection(data) {
  const code = data?.error?.code || data?.capture_quality?.reason || (data?.results || []).find(x => !x.accepted)?.reason || 'low_signal_quality';
  const hints = REASONS[code] || REASONS.low_signal_quality;
  const capturePassed = data?.capture_quality?.accepted === true;
  const context = code==='low_signal_quality' ? capturePassed ? 'El rostro, la luz y el movimiento pasaron la revisión. La señal de pulso no alcanzó el criterio del análisis.' : 'Preparar el rostro no garantiza una señal de pulso suficiente.' : {
    poor_lighting:'La revisión detectó exposición insuficiente o excesiva.',
    no_face:'El rostro no se pudo seguir de forma continua.',
    multiple_faces:'La toma debe contener un solo rostro.',
    excessive_motion:'La posición del rostro cambió demasiado durante el video.',
    capture_too_slow:'La grabación perdió cuadros; no es un diagnóstico de iluminación.',
    engine_error:'Un método no pudo completar su cálculo. Esto puede ser un problema del servicio.',
  }[code] || 'Sigue estas recomendaciones antes de intentar otra vez.';
  return {code, message: data?.error?.message || hints[0], hints: hints.slice(1),context};
}
export function diagnostics(data) {
  // Do not expose rejected vital estimates or signal traces in recovery.
  return {video:data?.video,capture_quality:data?.capture_quality,error:data?.error,
    results:(data?.results || []).map(x=>({engine:x.engine,model_used:x.model_used,accepted:x.accepted,reason:x.reason,quality:x.quality,processing_seconds:x.processing_seconds,warnings:x.warnings}))};
}
export function chooseMime(Recorder) {
  return ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(x => Recorder.isTypeSupported(x)) || '';
}
export function canAnalyzeCapture(seconds, bytes) {
  return seconds >= MIN_SECONDS && bytes > 0 && bytes <= MAX_BYTES;
}
export function waveformPath(values) {
  const clean = (values || []).filter(Number.isFinite);
  if (clean.length < 2) return '';
  const step = Math.max(1, Math.ceil(clean.length / 120));
  const samples = clean.filter((_, i) => i % step === 0);
  const min = Math.min(...samples), span = Math.max(...samples) - min || 1;
  return samples.map((x, i) => `${i ? 'L' : 'M'}${(i * 300 / (samples.length - 1)).toFixed(1)},${(54 - (x - min) * 48 / span).toFixed(1)}`).join(' ');
}
