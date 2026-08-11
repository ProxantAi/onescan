import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// El motor wasm de Shen.AI necesita SharedArrayBuffer, que sólo existe en un
// contexto aislado (crossOriginIsolated). Estas cabeceras lo consiguen en dev y
// preview.
//
// OJO: esto NO cubre producción. El build es estático, así que el servidor que
// sirva la demo (nginx/Caddy) debe emitir las mismas cabeceras o el modo real
// fallará SÓLO en producción. Es el riesgo de despliegue más fácil de pasar por
// alto de todo este cambio.
const coopHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3100,
    headers: coopHeaders,
  },
  preview: {
    port: 3100,
    headers: coopHeaders,
  },
});
