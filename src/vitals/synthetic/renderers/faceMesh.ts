// Malla facial animada. Movida tal cual desde useAppController (líneas 103-191),
// con dos cambios: recibe el canvas por parámetro en vez de leer un ref del
// hook, y devuelve su propia función de parada en vez de depender de simRef.

export function startFaceMesh(canvas: HTMLCanvasElement | null): () => void {
  if (!canvas) return () => {};

  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 320;
  const H = canvas.clientHeight || 420;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = W * 0.5;
  const cy = H * (178 / 400);
  const rx = W * (96 / 300);
  const ry = H * (126 / 400);

  const RINGS = 6;
  const rings: Array<Array<{ a: number; f: number }>> = [];
  for (let i = 1; i <= RINGS; i++) {
    const f = i / RINGS;
    const n = 4 + i * 3;
    const arr: Array<{ a: number; f: number }> = [];
    for (let k = 0; k < n; k++) {
      arr.push({ a: (k / n) * Math.PI * 2 + i * 0.4, f });
    }
    rings.push(arr);
  }

  const t0 = performance.now();
  let raf: number | null = null;
  let stopped = false;

  const draw = (now: number) => {
    if (stopped) return;
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const scanY = cy - ry + (Math.sin(t * 1.6) * 0.5 + 0.5) * 2 * ry;

    const pos = rings.map((ring) =>
      ring.map((p) => {
        const j = 1 + Math.sin(t * 2.2 + p.a * 3) * 0.02;
        return {
          x: cx + Math.cos(p.a) * rx * p.f * j,
          y: cy + Math.sin(p.a) * ry * p.f * j,
          a: p.a,
        };
      }),
    );

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,220,205,0.16)';
    for (let i = 0; i < pos.length; i++) {
      const ring = pos[i];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      if (i > 0) {
        const inner = pos[i - 1];
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k];
          const idx = Math.round((a.a / (Math.PI * 2)) * inner.length) % inner.length;
          const b = inner[(idx + inner.length) % inner.length];
          if (b) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    for (const ring of pos) {
      for (const p of ring) {
        const prox = 1 - Math.min(1, Math.abs(p.y - scanY) / (ry * 0.45));
        const g = Math.max(0, prox);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2 + 2 * g, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,235,215,${0.3 + 0.6 * g})`;
        ctx.fill();
      }
    }

    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return () => {
    stopped = true;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
}
