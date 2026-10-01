import test from 'node:test';
import assert from 'node:assert/strict';
import {facePose,PoseGuide} from './pose.mjs';
const pose=(yaw=0,extra={})=>({valid:true,centered:true,sized:true,level:true,x:.5,y:.5,height:.6,yaw,...extra});
function hold(guide,value,start,duration) {
  let state;
  for(let t=start;t<=start+duration;t+=100)state=guide.update(value,t);
  return state;
}
test('all four positions must be held in order before recording is ready',()=>{
  const guide=new PoseGuide();
  assert.equal(hold(guide,pose(-25),0,1000).step,0);
  assert.equal(hold(guide,pose(),1100,700).stage,'left');
  assert.equal(hold(guide,pose(25),1900,600).stage,'right');
  assert.equal(hold(guide,pose(-25),2600,600).stage,'steady');
  assert.equal(hold(guide,pose(),3300,1900).done,false);
  assert.equal(guide.update(pose(),5300).done,true);
});
test('face loss, multiple faces, wrong direction and dropped frames cannot complete a hold',()=>{
  const guide=new PoseGuide();hold(guide,pose(),0,600);
  assert.equal(guide.update({valid:false,reason:'multiple'},700).reason,'multiple');
  assert.equal(hold(guide,pose(),800,600).step,0);
  guide.update(pose(),3000);assert.equal(guide.step,0);
  hold(guide,pose(),3100,600);assert.equal(guide.step,1);
  hold(guide,pose(-25),3800,700);assert.equal(guide.step,1);
  guide.update({valid:false,reason:'missing'},4600);
  guide.update({valid:false,reason:'missing'},6200);assert.equal(guide.step,0);
});
test('movement while back at center restarts the two-second stability period',()=>{
  const guide=new PoseGuide();guide.step=3;
  hold(guide,pose(),0,1900);
  assert.equal(guide.update(pose(0,{x:.54}),2000).done,false);
  assert.equal(hold(guide,pose(0,{x:.54}),2100,1900).done,true);
});
test('out of frame, wrong size, tilt and non-monotonic timestamps never advance',()=>{
  const guide=new PoseGuide();
  for(const value of [pose(0,{centered:false}),pose(0,{sized:false}),pose(0,{level:false})]) {
    assert.equal(hold(guide,value,(guide.last??-100)+100,1000).step,0);
  }
  const last=guide.last;guide.update(pose(),last-1);assert.equal(guide.last,last);
});
test('landmark geometry uses unmirrored data for a mirrored left/right instruction',()=>{
  const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  Object.assign(points[10],{y:.15});Object.assign(points[152],{y:.75});
  Object.assign(points[234],{x:.27});Object.assign(points[454],{x:.73});
  Object.assign(points[33],{x:.35,y:.37,z:.075});Object.assign(points[263],{x:.65,y:.37,z:-.075});
  Object.assign(points[1],{y:.49});
  const result={faceLandmarks:[points]};
  const left=facePose(result);assert.ok(left.valid && left.centered && left.sized && left.level);
  assert.ok(left.yaw>18);
  points[33].z=-.075;points[263].z=.075;assert.ok(facePose(result).yaw < -18);
  assert.equal(facePose({faceLandmarks:[points,points]}).reason,'multiple');
  assert.equal(facePose({faceLandmarks:[]}).valid,false);
  points[1].x=NaN;assert.equal(facePose(result).valid,false);
});
