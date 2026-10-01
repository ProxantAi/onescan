import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraGuide} from './guide-camera.mjs';

test('final confirmation waits, rechecks readiness and never starts after cancellation or hiding',()=>{
  const names=['window','document','Worker','performance','setTimeout','clearTimeout','setInterval','clearInterval'];
  const originals=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let clock=0,started=0;
  const timers=new Map();
  const later=(fn,delay)=>{const id={};timers.set(id,{fn,at:clock+delay});return id;};
  class WorkerMock {postMessage() {} terminate() {this.terminated=true;}}
  Object.assign(globalThis,{
    window:{Worker:WorkerMock,createImageBitmap:true,OffscreenCanvas:true},Worker:WorkerMock,
    document:{hidden:false,createElement:()=>({getContext:()=>({})})},
    setTimeout:later,clearTimeout:id=>timers.delete(id),setInterval:()=>({}),clearInterval:()=>{},
  });
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
  const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  Object.assign(points[10],{y:.15});Object.assign(points[152],{y:.75});
  Object.assign(points[234],{x:.27});Object.assign(points[454],{x:.73});
  Object.assign(points[33],{x:.35,y:.37});Object.assign(points[263],{x:.65,y:.37});Object.assign(points[1],{y:.49});
  const flush=at=>{clock=at;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}};
  try {
    for(const scenario of ['valid','face-loss','hidden','cancelled','stale']) {
      clock=0;started=0;timers.clear();document.hidden=false;
      const guide=new CameraGuide({}, {onState:()=>{},onReady:()=>started++,onError:()=>{throw new Error('Unexpected worker error');}});
      guide.start();const worker=guide.worker;worker.onmessage({data:{type:'ready'}});guide.guide.step=3;
      const frame=(at,valid=true)=>{clock=at;worker.onmessage({data:{type:'pose',result:{faceLandmarks:valid?[points]:[],brightness:120},timestamp:at}});};
      for(let at=0;at<=2000;at+=100)frame(at);
      assert.equal(started,0,'Final completion must be visible before recording');
      if(scenario==='face-loss')frame(2200,false);
      if(scenario==='hidden')document.hidden=true;
      if(scenario==='cancelled')guide.close();
      if(scenario==='valid')for(let at=2100;at<=2800;at+=100)frame(at);
      flush(2900);
      assert.equal(started,scenario==='valid'?1:0,scenario);
      guide.close();assert.ok(worker.terminated);
    }
  } finally {
    for(const [name,descriptor] of originals) {
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
    }
  }
});
