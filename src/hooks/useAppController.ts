// Navegación de la demo. Todo lo que era medición, cámara, animación y
// resultados vive ahora en useScan y en la capa vitals/.
//
// El archivo original tenía 463 líneas y mezclaba las cinco cosas. También leía
// `?real=1`, `?dur=` y `?apiKey=` en el ámbito del módulo, es decir una sola vez
// al importar: no se podía configurar nada en runtime y el paciente elegía el
// modo desde la URL. Ambas cosas desaparecen: el modo lo decide el backend.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RING_LEN } from '../constants/metrics';
import { useScan } from './useScan';
import type { ScanSurfaces } from '../vitals/types';

type Screen = 'landing' | 'scan' | 'results';

export function useAppController() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [hasMeasurement, setHasMeasurement] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const faceMeshRef = useRef<HTMLCanvasElement | null>(null);
  const ppgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mxCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const scan = useScan();

  const showScreen = useCallback((name: Screen) => {
    setScreen(name);
    document.querySelector('.app__body')?.scrollTo(0, 0);
  }, []);

  const startMeasurement = useCallback(() => {
    showScreen('scan');
    const surfaces: ScanSurfaces = {
      video: videoRef.current,
      faceMesh: faceMeshRef.current,
      ppg: ppgCanvasRef.current,
      sdkCanvas: mxCanvasRef.current,
    };
    void scan.start(surfaces);
  }, [scan, showScreen]);

  // Sólo se considera que hay medición cuando el backend confirmó y devolvió el
  // normalizado; así el resumen nunca se abre con datos a medias.
  useEffect(() => {
    if (scan.phase === 'done' && scan.normalized) setHasMeasurement(true);
  }, [scan.phase, scan.normalized]);

  const goToSummary = useCallback(() => {
    if (hasMeasurement) showScreen('results');
  }, [hasMeasurement, showScreen]);

  const handleTabClick = useCallback(
    (target: string) => {
      if (target === 'scan') {
        startMeasurement();
        return;
      }
      if (target === 'results' && !hasMeasurement) {
        showScreen('landing');
        return;
      }
      showScreen(target as Screen);
    },
    [hasMeasurement, showScreen, startMeasurement],
  );

  const handleWhatsapp = useCallback(() => {
    alert('Demo: aquí el paciente continuaría su onboarding y plan de salud por WhatsApp.');
  }, []);

  useEffect(() => () => scan.cancel(), [scan.cancel]);

  const score = scan.normalized?.score ?? null;
  const ringOffset = score === null ? RING_LEN : RING_LEN * (1 - score / 100);

  return {
    screen,
    activeTab: screen,
    hasMeasurement,
    scan,
    score,
    ringOffset,
    videoRef,
    faceMeshRef,
    ppgCanvasRef,
    mxCanvasRef,
    startMeasurement,
    goToSummary,
    handleTabClick,
    handleWhatsapp,
  };
}
