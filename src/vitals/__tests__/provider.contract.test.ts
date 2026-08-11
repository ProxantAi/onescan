// Suite de CONTRATO: las mismas afirmaciones corren contra la fuente sintética
// y contra la real.
//
// Es el criterio de aceptación del spike hecho ejecutable: "cambiar de synthetic
// a real no modifica la lógica posterior". Si algún día un provider empieza a
// comportarse distinto —lanza en vez de devolver `failed`, emite estados fuera
// de orden, retrocede el progreso—, esto se pone rojo.

import { describe, expect, it } from 'vitest';
import { SyntheticProvider } from '../synthetic/SyntheticProvider';
import { ShenAiProvider } from '../shenai/ShenAiProvider';
import { assertMeasurementResults, type ScanEvent, type ScanSurfaces, type VitalsProvider } from '../types';
import { createFakeSdk, SAMPLE_RESULTS } from './fakeSdk';

const NO_SURFACES: ScanSurfaces = { video: null, faceMesh: null, ppg: null, sdkCanvas: null };

interface Case {
  name: string;
  make: () => VitalsProvider;
  start: (provider: VitalsProvider) => ReturnType<VitalsProvider['start']>;
  expected: 'finished' | 'failed';
}

const DURATION = 1;

const cases: Case[] = [
  {
    name: 'synthetic/completa',
    make: () => new SyntheticProvider(),
    start: (p) =>
      p.start({ sessionId: 'sess-1', durationSec: DURATION, replay: SAMPLE_RESULTS }),
    expected: 'finished',
  },
  {
    name: 'synthetic/poor-signal',
    make: () => new SyntheticProvider(),
    start: (p) =>
      p.start({
        sessionId: 'sess-2',
        durationSec: DURATION,
        replay: SAMPLE_RESULTS,
        replayFailure: 'signal_too_poor',
      }),
    expected: 'failed',
  },
  {
    name: 'shenai/completa',
    make: () =>
      new ShenAiProvider({
        apiKey: 'fake-key',
        userId: '',
        loadSdk: async () => createFakeSdk({ outcome: 'finished' }),
      }),
    start: (p) => p.start({ sessionId: 'sess-3', durationSec: DURATION }),
    expected: 'finished',
  },
  {
    name: 'shenai/falla',
    make: () =>
      new ShenAiProvider({
        apiKey: 'fake-key',
        userId: '',
        loadSdk: async () => createFakeSdk({ outcome: 'failed' }),
      }),
    start: (p) => p.start({ sessionId: 'sess-4', durationSec: DURATION }),
    expected: 'failed',
  },
  {
    name: 'shenai/termina sin resultados',
    make: () =>
      new ShenAiProvider({
        apiKey: 'fake-key',
        userId: '',
        loadSdk: async () =>
          createFakeSdk({ outcome: 'finished', resultsAfterFinish: null }),
      }),
    start: (p) => p.start({ sessionId: 'sess-5', durationSec: DURATION }),
    // El SDK real puede llegar a FINISHED y aun así devolver null. No es una
    // excepción: es una medición fallida.
    expected: 'failed',
  },
];

describe.each(cases)('contrato VitalsProvider: $name', ({ make, start, expected }) => {
  async function run() {
    const provider = make();
    const events: ScanEvent[] = [];
    const unsubscribe = provider.subscribe((event) => events.push(event));

    await provider.prepare();
    await provider.mount(NO_SURFACES);
    const outcome = await start(provider);

    unsubscribe();
    provider.dispose();
    return { provider, events, outcome };
  }

  it('resuelve el desenlace esperado en vez de lanzar', async () => {
    const { outcome } = await run();
    expect(outcome.status).toBe(expected);
  });

  it('los desenlaces exitosos cumplen el contrato MeasurementResults', async () => {
    const { outcome } = await run();
    if (outcome.status !== 'finished') return;
    // Mismo guard para ambas fuentes: si divergen, esto revienta.
    expect(() => assertMeasurementResults(outcome.results)).not.toThrow();
    expect(typeof outcome.results.heart_rate_bpm).toBe('number');
  });

  it('los fallos traen una razón y ningún resultado', async () => {
    const { outcome } = await run();
    if (outcome.status !== 'failed') return;
    expect(outcome.reason).toBeTruthy();
    expect('results' in outcome).toBe(false);
  });

  it('el progreso es monótono y está acotado a 0..100', async () => {
    const { events } = await run();
    const percents = events
      .filter((e): e is Extract<ScanEvent, { type: 'progress' }> => e.type === 'progress')
      .map((e) => e.percent);

    expect(percents.length).toBeGreaterThan(0);
    for (const p of percents) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    const sorted = [...percents].sort((a, b) => a - b);
    expect(percents).toEqual(sorted);
  });

  it('termina en un estado terminal y no emite nada después', async () => {
    const { events } = await run();
    const states = events
      .filter((e): e is Extract<ScanEvent, { type: 'state' }> => e.type === 'state')
      .map((e) => e.state);

    expect(states[0]).toBe('preparing');
    expect(['done', 'failed']).toContain(states[states.length - 1]);
  });

  it('prepare() y dispose() son idempotentes', async () => {
    const provider = make();
    await provider.prepare();
    await provider.prepare();
    await provider.mount(NO_SURFACES);
    provider.dispose();
    expect(() => provider.dispose()).not.toThrow();
  });
}, 20000);

describe('diferencias declaradas entre fuentes', () => {
  it('cada provider declara su superficie de render, y es lo único que cambia', () => {
    expect(new SyntheticProvider().renderMode).toBe('proxant');
    expect(
      new ShenAiProvider({ apiKey: 'k', userId: '', loadSdk: async () => createFakeSdk() })
        .renderMode,
    ).toBe('sdk');
  });

  it('la fuente real exige clave de activación', async () => {
    const provider = new ShenAiProvider({
      apiKey: '',
      userId: '',
      loadSdk: async () => createFakeSdk(),
    });
    await expect(provider.start({ sessionId: 's', durationSec: 1 })).rejects.toThrow(
      /clave de activación/i,
    );
  });
});
