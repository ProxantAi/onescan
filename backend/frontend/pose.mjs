// Head-turn guidance only. This is neither identity verification nor anti-spoofing.
const degrees = radians => radians * 180 / Math.PI;
export function facePose(result) {
  const faces = result?.faceLandmarks || [];
  if (faces.length !== 1) return {valid:false, reason:faces.length > 1 ? 'multiple' : 'missing'};
  const points = faces[0];
  const required = [1,10,33,152,234,263,454].map(i => points[i]);
  if (required.some(p => !p || ![p.x,p.y,p.z].every(Number.isFinite))) return {valid:false,reason:'missing'};
  const [nose,top,leftEye,chin,leftCheek,rightEye,rightCheek] = required;
  const width = Math.abs(rightCheek.x-leftCheek.x), height = chin.y-top.y;
  const x = (leftCheek.x+rightCheek.x)/2, y = (top.y+chin.y)/2;
  const eyeWidth = rightEye.x-leftEye.x;
  if (eyeWidth <= .025 || height <= 0) return {valid:false,reason:'missing'};
  // MediaPipe z grows away from the camera. With unmirrored input, an eye
  // closer to the camera has a smaller z. Correct the sign so positive yaw
  // turns the nose left in the mirrored preview, matching the LEFT cue.
  const yaw = degrees(Math.atan2(rightEye.z-leftEye.z,eyeWidth));
  const roll = degrees(Math.atan2(rightEye.y-leftEye.y,eyeWidth));
  const eyeY = (leftEye.y+rightEye.y)/2;
  const nosePosition = (nose.y-eyeY)/(chin.y-eyeY);
  const centered = x >= .35 && x <= .65 && y >= .28 && y <= .68;
  const sized = width >= .20 && width <= .72 && height >= .30 && height <= .88;
  const level = Math.abs(roll) <= 14 && nosePosition >= .12 && nosePosition <= .75;
  return {valid:true,x,y,width,height,yaw,roll,centered,sized,level,brightness:result.brightness};
}
export const GUIDE_STEPS = ['front','left','right','steady'];
// Landmark yaw is an estimate, not a calibrated physical angle. A small change
// from the user's own neutral pose is enough for this preparation step.
export const TURN_MIN = 10, TURN_MAX = 32;
export function turnDirection(stage) {
  return stage==='left'?'left':stage==='right'?'right':null;
}
export class GuideFeedback {
  constructor() {this.reset();}
  reset() {this.lastStep=0;this.completed=-1;this.until=0;}
  update(state,now) {
    if(state.step<this.lastStep)this.reset();
    const completed=state.done?3:state.step>this.lastStep?state.step-1:null;
    if(completed!==null && completed!==this.completed) {this.completed=completed;this.until=now+900;}
    this.lastStep=state.step;
    const confirming=Boolean(state.done || now<this.until);
    return {confirming,completedStep:confirming?this.completed:null,lastCompleted:this.completed,progress:confirming?1:state.progress};
  }
}
export class PoseGuide {
  constructor() {this.reset();}
  reset() {this.step=0;this.since=null;this.last=null;this.anchor=null;this.missingSince=null;this.neutralYaw=null;this.frontSum=0;this.frontCount=0;}
  update(pose,now) {
    if (!Number.isFinite(now) || (this.last !== null && now <= this.last)) return this.state('waiting');
    if (this.last !== null && now-this.last > 600) {this.since=null;this.anchor=null;}
    this.last=now;
    if (!pose.valid) {
      this.since=null;this.anchor=null;this.missingSince ??= now;
      if (now-this.missingSince >= 1500) {this.step=0;this.neutralYaw=null;}
      return this.state(pose.reason);
    }
    this.missingSince=null;
    if (!pose.centered || !pose.sized || !pose.level) {
      this.since=null;this.anchor=null;
      return this.state(!pose.sized ? pose.height < .30 || pose.width < .20 ? 'closer' : 'farther' : !pose.centered ? 'center' : 'level');
    }
    const stage = GUIDE_STEPS[this.step];
    if(stage==='steady' && Number.isFinite(pose.brightness) && (pose.brightness<40 || pose.brightness>225)) {
      this.since=null;this.anchor=null;return this.state('light');
    }
    const relativeYaw=pose.yaw-(this.neutralYaw??0);
    const aligned = stage==='left' ? relativeYaw >= TURN_MIN && relativeYaw <= TURN_MAX : stage==='right' ? relativeYaw <= -TURN_MIN && relativeYaw >= -TURN_MAX : Math.abs(pose.yaw)<=12 && (stage!=='steady' || Math.abs(relativeYaw)<=8);
    if (!aligned) {this.since=null;this.anchor=null;return this.state('turn');}
    if (stage==='steady' && this.anchor && (Math.hypot(pose.x-this.anchor.x,pose.y-this.anchor.y)>.025 || Math.abs(pose.height-this.anchor.height)>.04 || Math.abs(pose.yaw-this.anchor.yaw)>5)) {
      this.since=null;this.anchor=null;
    }
    if(this.since===null && stage==='front') {this.frontSum=0;this.frontCount=0;}
    this.since ??= now; this.anchor ??= pose;
    if(stage==='front') {this.frontSum+=pose.yaw;this.frontCount++;}
    const hold = stage==='steady' ? 2000 : stage==='front' ? 700 : 600;
    const progress = Math.min(1,(now-this.since)/hold);
    if (progress>=1) {
      if (stage==='steady') return {...this.state('ready'),done:true,progress:1};
      if(stage==='front')this.neutralYaw=this.frontSum/this.frontCount;
      this.step++;this.since=null;this.anchor=null;
      return this.state('turn');
    }
    return {...this.state('hold'),progress};
  }
  state(reason) {return {step:this.step,stage:GUIDE_STEPS[this.step],reason,progress:0,done:false};}
}
export function recordingIssue(pose) {
  if(!pose.valid)return pose.reason==='multiple'?'multiple_faces':'no_face';
  if(Number.isFinite(pose.brightness) && (pose.brightness<40 || pose.brightness>225))return 'poor_lighting';
  if(!pose.centered || !pose.sized)return 'face_out_of_frame';
  if(!pose.level || Math.abs(pose.yaw)>15)return 'face_not_front';
  return null;
}
export class RecordingMonitor {
  constructor() {this.code=null;this.since=null;}
  update(pose,now) {
    const code=recordingIssue(pose);
    if(code!==this.code) {this.code=code;this.since=code?now:null;}
    return {code,stop:Boolean(code && now-this.since>=2500)};
  }
}
