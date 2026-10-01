export const TARGET_SECONDS = 30;
export const MIN_SECONDS = 20;
export const MAX_BYTES = 50 * 1024 * 1024;
export const REASONS = {
  face_guide_unavailable: ['No pudimos iniciar la guía del rostro.', 'Actualiza Safari o Chrome y vuelve a intentar.', 'También puedes subir un video desde el menú.'],
  face_guide_timeout: ['No pudimos completar los movimientos.', 'Gira suavemente siguiendo las flechas.', 'Vuelve al centro y mantente quieto.'],
  no_face: ['No pudimos ver tu rostro durante toda la toma.', 'Coloca el teléfono a la altura de tus ojos.', 'Mantén tu rostro dentro del óvalo.'],
  multiple_faces: ['Apareció más de un rostro.', 'Graba sin otras personas en cámara.', 'Mantén tu rostro centrado.'],
  poor_lighting: ['Necesitamos más luz sobre tu rostro.', 'Busca una luz uniforme frente a ti.', 'Evita ventanas detrás de ti.'],
  excessive_motion: ['La imagen tuvo demasiado movimiento.', 'Apoya el teléfono a la altura de tus ojos.', 'Evita hablar y mover la cabeza.'],
  capture_too_slow: ['La cámara perdió demasiados cuadros.', 'Mejora la luz y cierra otras aplicaciones.', 'Apoya el teléfono durante la grabación.'],
  video_too_short: ['La toma fue demasiado corta.', 'Graba durante al menos 20 segundos.', 'La captura termina sola a los 30 segundos.'],
  low_signal_quality: ['No pudimos obtener una señal suficiente.', 'Coloca el teléfono a la altura de tus ojos.', 'Quédate quieto durante la grabación.'],
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
  return {code, message: data?.error?.message || hints[0], hints: hints.slice(1)};
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
