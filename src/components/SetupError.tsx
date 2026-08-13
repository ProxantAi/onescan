interface SetupErrorProps {
  message: string | null;
  onRetry?: () => void;
}

// Se dejó de usar dangerouslySetInnerHTML: los mensajes ahora vienen de errores
// del backend y del SDK, no de literales del código, así que inyectarlos como
// HTML sería un XSS a la espera.
// Una sesión ya usada o vencida no es un problema de configuración, y
// anunciarla así manda a revisar variables de entorno que están bien.
function titleFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('already completed')) return 'Este escaneo ya se hizo';
  if (m.includes('expired')) return 'La liga venció';
  return 'Falta configuración';
}

export function SetupError({ message, onRetry }: SetupErrorProps) {
  if (!message) return null;
  return (
    <div className="setup-error is-visible">
      <div className="setup-error__box">
        <h2>{titleFor(message)}</h2>
        <p>{message}</p>
        {onRetry && (
          <button type="button" className="btn btn--ghost" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}
