/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Clave de Shen.AI para desarrollo local; en producción la manda la sesión. */
  readonly VITE_SHENAI_API_KEY?: string;
  /** Duración por defecto si el backend no está disponible. */
  readonly VITE_SCAN_DURATION_SEC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
