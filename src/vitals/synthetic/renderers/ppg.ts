// Traza PPG en tiempo real. Movida desde useAppController (líneas 193-232).
// La frecuencia instantánea llega por callback en vez de leerse de simRef, para
// que el renderer no sepa nada del proveedor que lo alimenta.

/** Forma de onda de pulso: pico sistólico + muesca dicrótica. */
export function ppgWave(t: number): number {
  const systolic = Math.exp(-Math.pow((t - 0.18) / 0.1, 2));
  const dicrotic = 0.32 * Math.exp(-Math.pow((t - 0.46) / 0.12, 2));
  return systolic + dicrotic - 0.14;
}

export function startPpg(
  canvas: HTMLCanvasElement | null,
  getHeartRate: () => number,
): () => void {
  if (!canvas) return () => {};

  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 400;
  const H = canvas.clientHeight || 64;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const N = Math.max(160, Math.floor(W));
  const data: number[] = new Array(N).fill(H / 2);
  let phase = 0;
  let last = performance.now();
  let raf: number | null = null;
  let stopped = false;

  const draw = (now: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const hr = getHeartRate() > 0 ? getHeartRate() : 72;
    phase += (hr / 60) * dt;
    data.push(H / 2 - ppgWave(phase % 1) * (H * 0.34));
    if (data.length > N) data.shift();

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#34e3c4';
    ctx.shadowColor = 'rgba(52,227,196,0.8)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / N) * W;
      if (i === 0) ctx.moveTo(x, data[i]);
      else ctx.lineTo(x, data[i]);
    }
    ctx.stroke();

    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return () => {
    stopped = true;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  };
}
