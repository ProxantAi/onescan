// El logo se importa como módulo en vez de referenciar "/assets/img/...".
// Antes vivía en la raíz del repo, que Vite sirve en dev pero NO copia al build:
// el logo ya estaba roto en producción y fallaba en silencio. Importándolo,
// Vite lo versiona, reescribe la URL bajo cualquier `base`, y si el archivo
// falta el build se cae en vez de publicar una imagen rota.
import logoUrl from '../assets/proxant-logo.png';

export function AppBar() {
  return (
    <header className="appbar">
      <button className="appbar__icon" aria-label="Menú" type="button">
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <img className="appbar__logo" src={logoUrl} alt="Proxant" />
      <button className="appbar__icon" aria-label="Ayuda" type="button">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path
            d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
        </svg>
      </button>
    </header>
  );
}
