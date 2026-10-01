import test from 'node:test';
import assert from 'node:assert/strict';
import {facePose,PoseGuide,recordingIssue,RecordingMonitor,turnDirection,GuideFeedback} from './pose.mjs';
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
test('small turns work relative to the averaged neutral pose, not a large absolute angle',()=>{
  const guide=new PoseGuide();
  hold(guide,pose(-7),0,700);
  assert.equal(guide.neutralYaw,-7);
  assert.equal(hold(guide,pose(-7),800,700).stage,'left');
  assert.equal(hold(guide,pose(-17),1600,700).stage,'left');
  assert.equal(hold(guide,pose(3),2400,600).stage,'right');
  assert.equal(hold(guide,pose(-17),3100,600).stage,'steady');
  assert.equal(hold(guide,pose(-7),3800,2000).done,true);
});
test('turn cue matches the mirrored preview and disappears at center',()=>{
  assert.equal(turnDirection('left'),'left');assert.equal(turnDirection('right'),'right');
  assert.equal(turnDirection('front'),null);assert.equal(turnDirection('steady'),null);
  const guide=new PoseGuide();hold(guide,pose(5),0,700);
  assert.equal(hold(guide,pose(45),800,600).stage,'left');
  assert.equal(hold(guide,pose(15),1500,600).stage,'right');
  guide.update({valid:false,reason:'missing'},2200);
  guide.update({valid:false,reason:'missing'},3800);
  assert.equal(guide.neutralYaw,null);assert.equal(guide.step,0);
});
test('recording monitor uses real face/exposure data and gives time to recover',()=>{
  assert.equal(recordingIssue(pose(0,{brightness:120})),null);
  assert.equal(recordingIssue(pose(0,{brightness:15})),'poor_lighting');
  assert.equal(recordingIssue(pose(25)),'face_not_front');
  assert.equal(recordingIssue({valid:false,reason:'multiple'}),'multiple_faces');
  assert.equal(recordingIssue(pose(0,{centered:false})),'face_out_of_frame');
  const monitor=new RecordingMonitor();
  assert.equal(monitor.update({valid:false,reason:'missing'},0).stop,false);
  assert.equal(monitor.update({valid:false,reason:'missing'},2000).stop,false);
  assert.equal(monitor.update(pose(),2200).stop,false);
  assert.equal(monitor.update({valid:false,reason:'missing'},2500).stop,false);
  assert.equal(monitor.update({valid:false,reason:'missing'},5000).stop,true);
});
test('final readiness also requires adequate exposure of the actual face',()=>{
  const guide=new PoseGuide();guide.step=3;
  assert.equal(hold(guide,pose(0,{brightness:10}),0,2200).done,false);
  assert.equal(hold(guide,pose(0,{brightness:120}),2300,1900).done,false);
  assert.equal(guide.update(pose(0,{brightness:120}),4300).done,true);
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
  const right=facePose(result);assert.ok(right.valid && right.centered && right.sized && right.level);
  assert.ok(right.yaw < -18);
  points[33].z=-.075;points[263].z=.075;assert.ok(facePose(result).yaw >18);
  assert.equal(facePose({faceLandmarks:[points,points]}).reason,'multiple');
  assert.equal(facePose({faceLandmarks:[]}).valid,false);
  points[1].x=NaN;assert.equal(facePose(result).valid,false);
});
test('projected 3D head rotation agrees with the nose direction on the mirrored screen',()=>{
  // Rotate a virtual face with its nose closer to the camera than its eyes.
  // This independently checks projection + depth sign, rather than assigning
  // z values according to the yaw formula being tested.
  for(const angle of [-18,18]) {
    const a=angle*Math.PI/180;
    const project=(x,y,z)=>({x:.5+x*Math.cos(a)+z*Math.sin(a),y,z:-x*Math.sin(a)+z*Math.cos(a)});
    const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
    points[33]=project(-.15,.37,-.03);points[263]=project(.15,.37,-.03);
    points[1]=project(0,.49,-.12);points[10]=project(0,.15,0);points[152]=project(0,.75,0);
    points[234]=project(-.23,.45,0);points[454]=project(.23,.45,0);
    const value=facePose({faceLandmarks:[points]});
    const mirroredNoseOffset=-(points[1].x-(points[33].x+points[263].x)/2);
    const direction=mirroredNoseOffset<0?'left':'right';
    assert.equal(value.yaw>0?'left':'right',direction);
    const guide=new PoseGuide();hold(guide,pose(),0,700);
    if(direction==='right')hold(guide,pose(18),800,600);
    assert.equal(turnDirection(guide.state('turn').stage),direction);
    assert.equal(hold(guide,value,1500,600).step,direction==='left'?2:3);
  }
});
test('step confirmation stays visible for 900 ms and completed checks survive the next step',()=>{
  const view=new GuideFeedback();
  assert.equal(view.update({step:0,progress:.5},0).confirming,false);
  let result=view.update({step:1,progress:0},700);
  assert.equal(result.completedStep,0);assert.equal(result.progress,1);
  assert.equal(view.update({step:1,progress:0},1500).confirming,true);
  result=view.update({step:1,progress:.5},1600);
  assert.equal(result.confirming,false);assert.equal(result.lastCompleted,0);
  assert.equal(view.update({step:2,progress:0},1900).completedStep,1);
  assert.equal(view.update({step:0,progress:0},2100).confirming,false);
  assert.equal(view.update({step:3,done:true,progress:1},3000).completedStep,3);
  assert.equal(view.update({step:3,done:true,progress:1},5000).confirming,true);
});
