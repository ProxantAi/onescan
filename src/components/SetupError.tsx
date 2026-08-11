interface SetupErrorProps {
  message: string | null;
  onRetry?: () => void;
}

// Se dejó de usar dangerouslySetInnerHTML: los mensajes ahora vienen de errores
// del backend y del SDK, no de literales del código, así que inyectarlos como
// HTML sería un XSS a la espera.
export function SetupError({ message, onRetry }: SetupErrorProps) {
  if (!message) return null;
  return (
    <div className="setup-error is-visible">
      <div className="setup-error__box">
        <h2>Falta configuración</h2>
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
