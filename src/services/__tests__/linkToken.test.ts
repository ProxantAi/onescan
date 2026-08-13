// La liga que llega por WhatsApp trae `?t=<token>`. Si esto se lee mal, el
// escaneo se guarda como demo anónima: sin paciente, sin Medplum y sin plan.
// Es un fallo silencioso — la app se ve perfectamente bien — así que conviene
// tenerlo fijado.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLinkToken } from '../healthCapture';

function withSearch(search: string) {
  vi.stubGlobal('window', { location: { search } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLinkToken', () => {
  it('lee el token de la liga', () => {
    withSearch('?t=abc-123');
    expect(getLinkToken()).toBe('abc-123');
  });

  it('lo encuentra aunque venga con otros parámetros', () => {
    withSearch('?utm_source=whatsapp&t=abc-123&x=1');
    expect(getLinkToken()).toBe('abc-123');
  });

  it('sin token devuelve null y la demo anónima sigue funcionando', () => {
    withSearch('');
    expect(getLinkToken()).toBeNull();
    withSearch('?dur=15');
    expect(getLinkToken()).toBeNull();
  });

  it('un token vacío o en blanco no cuenta como token', () => {
    withSearch('?t=');
    expect(getLinkToken()).toBeNull();
    withSearch('?t=%20%20');
    expect(getLinkToken()).toBeNull();
  });

  it('no confunde el escenario con el token', () => {
    // El escenario lo decide el servidor: nunca debe salir de la URL.
    withSearch('?scenario=hypertension-v1');
    expect(getLinkToken()).toBeNull();
  });
});
