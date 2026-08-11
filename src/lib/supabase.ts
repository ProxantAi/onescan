// Cliente de Supabase, misma convención que caredesk-health/src/lib/supabase.ts.
//
// Diferencia deliberada: `persistSession: false`. Esto es un kiosco sin login;
// no hay nada que guardar en localStorage y no queremos arrastrar sesión entre
// pacientes.
//
// Ojo: este módulo LANZA al importarse si faltan las variables. Se importa de
// forma perezosa desde services/healthCapture.ts para que un .env incompleto no
// deje la pantalla en blanco, sino que muestre el aviso de configuración.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Faltan variables de Supabase. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.local',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
