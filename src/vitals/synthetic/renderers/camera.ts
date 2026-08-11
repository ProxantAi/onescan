// Acceso a cámara. Movido desde useAppController (líneas 291-305).
//
// A diferencia del original, NO se traga el error: lo propaga como
// VitalsSetupError y deja que el provider decida la política. La fuente
// sintética puede continuar sin video (la demo sigue siendo útil); la real no,
// porque sin cámara no hay medición. Esa diferencia de política es justo la
// razón por la que la cámara vive detrás de la frontera del provider.

import { VitalsSetupError } from '../../types';

export interface CameraHandle {
  stream: MediaStream | null;
  stop: () => void;
}

export async function startCamera(video: HTMLVideoElement | null): Promise<CameraHandle> {
  if (!video) return { stream: null, stop: () => {} };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    throw new VitalsSetupError(
      `No se pudo acceder a la cámara: ${String(error)}`,
      'camera_denied',
    );
  }

  video.srcObject = stream;
  await video.play().catch(() => {});

  return {
    stream,
    stop: () => {
      stream.getTracks().forEach((track) => track.stop());
      video.pause?.();
      video.srcObject = null;
    },
  };
}
