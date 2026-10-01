import {facePose,PoseGuide} from './pose.mjs';

export class CameraGuide {
  constructor(video,{onState,onReady,onError}) {
    Object.assign(this,{video,onState,onReady,onError});
    this.guide=new PoseGuide();this.closed=false;this.inFlight=false;
    this.canvas=document.createElement('canvas');
    this.context=this.canvas.getContext('2d');
  }
  start() {
    if (!window.Worker || !window.createImageBitmap || !window.OffscreenCanvas) {this.fail();return;}
    this.worker=new Worker(new URL('./face-worker.js',import.meta.url));
    this.timeout=setTimeout(()=>this.fail(),25000);
    this.worker.onerror=()=>this.fail();
    this.worker.onmessage=({data})=>{
      if(this.closed)return;
      if(data.type==='ready') {
        clearTimeout(this.timeout);
        this.deadline=performance.now()+90000;
        this.onState(this.guide.state('missing'));
        this.timer=setInterval(()=>this.sample(),125);
      } else if(data.type==='pose') {
        this.inFlight=false;clearTimeout(this.watchdog);
        if(document.hidden) {this.guide.reset();clearTimeout(this.readyTimer);this.readyTimer=null;return;}
        const pose=facePose(data.result);
        if(this.monitoring) {this.onMonitor(pose,data.timestamp);return;}
        const state=this.guide.update(pose,data.timestamp);
        this.onState({...state,brightness:pose.brightness});
        // Keep the final confirmation visible. Continue checking fresh frames
        // during the delay; losing readiness cancels the pending start.
        if(state.done)this.readyPoseAt=data.timestamp;
        if(state.done && !this.readyTimer) {
          this.readyTimer=setTimeout(()=>{
            this.readyTimer=null;
            if(this.closed)return;
            if(document.hidden) {this.guide.reset();return;}
            if(performance.now()-this.readyPoseAt>600) {this.guide.since=null;this.guide.anchor=null;return;}
            clearInterval(this.timer);this.timer=null;this.onReady();
          },900);
        } else if(!state.done && this.readyTimer) {clearTimeout(this.readyTimer);this.readyTimer=null;}
      } else if(data.type==='error') this.fail();
    };
    this.worker.postMessage({type:'init'});
  }
  monitor(callback) {
    this.monitoring=true;this.onMonitor=callback;this.deadline=Infinity;
    clearInterval(this.timer);this.timer=setInterval(()=>this.sample(),500);
  }
  async sample() {
    if(this.closed || this.inFlight || document.hidden || this.video.readyState<2)return;
    if(performance.now()>this.deadline) {this.fail('face_guide_timeout');return;}
    this.inFlight=true;
    const worker=this.worker;
    try {
      // Match object-fit:cover so "centered" means inside the visible preview.
      const {videoWidth:w,videoHeight:h}=this.video;
      const box=this.video.getBoundingClientRect(),ratio=box.width/box.height;
      const cropW=Math.min(w,h*ratio),cropH=Math.min(h,w/ratio);
      this.canvas.width=360;this.canvas.height=Math.round(360/ratio);
      this.context.drawImage(this.video,(w-cropW)/2,(h-cropH)/2,cropW,cropH,0,0,this.canvas.width,this.canvas.height);
      const bitmap=await createImageBitmap(this.canvas);
      if(this.closed) {bitmap.close();return;}
      this.watchdog=setTimeout(()=>this.fail(),5000);
      worker.postMessage({type:'frame',bitmap,timestamp:performance.now()},[bitmap]);
    } catch {if(!this.closed)this.fail();}
  }
  fail(code='face_guide_unavailable') {
    if(this.closed)return;
    this.close();this.onError(code);
  }
  close() {
    this.closed=true;clearInterval(this.timer);clearTimeout(this.timeout);clearTimeout(this.watchdog);clearTimeout(this.readyTimer);this.readyTimer=null;
    this.worker?.terminate();this.worker=null;
    this.canvas.width=this.canvas.height=0;
  }
}
