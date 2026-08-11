// PRNG determinista (mulberry32) para el jitter cosmético del escaneo sintético.
//
// La demo original usaba Math.random() en todas partes, incluido el score — que
// salía aleatorio incluso en modo real. Aquí lo único que queda aleatorio es el
// temblor de la traza PPG, y va sembrado por sesión para que el mismo escaneo se
// reproduzca igual: un escenario debe ser reproducible, dice el spike.

export type Rng = () => number;

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(text: string): Rng {
  return mulberry32(hashSeed(text));
}
