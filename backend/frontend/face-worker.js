// A classic worker lets MediaPipe import its WASM loader without blocking UI.
let landmarker,canvas,context;
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
        let brightness=null;
        if(result.faceLandmarks.length===1) {
          const points=result.faceLandmarks[0],w=data.bitmap.width,h=data.bitmap.height;
          canvas ??= new OffscreenCanvas(32,32);context ??= canvas.getContext('2d',{willReadFrequently:true});
          const x=Math.max(0,Math.min(points[234].x,points[454].x)*w),y=Math.max(0,points[10].y*h);
          const width=Math.min(w-x,Math.abs(points[454].x-points[234].x)*w),height=Math.min(h-y,(points[152].y-points[10].y)*h);
          if(width>0 && height>0) {
            context.drawImage(data.bitmap,x,y,width,height,0,0,32,32);
            const pixels=context.getImageData(0,0,32,32).data;
            let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;
            brightness=sum/(pixels.length/4);
          }
        }
        self.postMessage({type:'pose',result:{faceLandmarks:result.faceLandmarks,brightness},timestamp:data.timestamp});
      } finally {data.bitmap.close();}
    }
  } catch (error) {
    data.bitmap?.close();
    self.postMessage({type:'error',message:String(error?.message || error)});
  }
};
