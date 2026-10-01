// A classic worker lets MediaPipe import its WASM loader without blocking UI.
let landmarker;
self.onmessage = async ({data}) => {
  try {
    if (data.type==='init') {
      const {FilesetResolver,FaceLandmarker} = await import('./vendor/mediapipe/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(new URL('./vendor/mediapipe/wasm',self.location.href).href);
      landmarker = await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:new URL('./vendor/mediapipe/face_landmarker.task',self.location.href).href,delegate:'CPU'},
        runningMode:'VIDEO',numFaces:2,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,minTrackingConfidence:.6,
      });
      self.postMessage({type:'ready'});
    } else if (data.type==='frame' && landmarker) {
      try {
        const result = landmarker.detectForVideo(data.bitmap,data.timestamp);
        self.postMessage({type:'pose',result:{faceLandmarks:result.faceLandmarks},timestamp:data.timestamp});
      } finally {data.bitmap.close();}
    }
  } catch (error) {
    data.bitmap?.close();
    self.postMessage({type:'error',message:String(error?.message || error)});
  }
};
