// Identificador de dispositivo, sin PII.
//
// El kiosco no tiene login, así que esto es lo único que permite agrupar varios
// escaneos del mismo teléfono o tablet. No identifica a una persona y se puede
// borrar limpiando el navegador.

const STORAGE_KEY = 'onescan.device_id';

export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const fresh = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Modo privado o almacenamiento bloqueado: un id efímero sigue sirviendo
    // para correlacionar la sesión y el resultado dentro de la misma visita.
    return crypto.randomUUID();
  }
}
