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
  // Normalized landmark z uses the same scale as x. Positive yaw means the
  // person's left, shown by a left arrow in the mirrored camera preview.
  const yaw = degrees(Math.atan2(leftEye.z-rightEye.z,eyeWidth));
  const roll = degrees(Math.atan2(rightEye.y-leftEye.y,eyeWidth));
  const eyeY = (leftEye.y+rightEye.y)/2;
  const nosePosition = (nose.y-eyeY)/(chin.y-eyeY);
  const centered = x >= .35 && x <= .65 && y >= .28 && y <= .68;
  const sized = width >= .20 && width <= .72 && height >= .30 && height <= .88;
  const level = Math.abs(roll) <= 14 && nosePosition >= .12 && nosePosition <= .75;
  return {valid:true,x,y,width,height,yaw,roll,centered,sized,level};
}
export const GUIDE_STEPS = ['front','left','right','steady'];
export class PoseGuide {
  constructor() {this.reset();}
  reset() {this.step=0;this.since=null;this.last=null;this.anchor=null;this.missingSince=null;}
  update(pose,now) {
    if (!Number.isFinite(now) || (this.last !== null && now <= this.last)) return this.state('waiting');
    if (this.last !== null && now-this.last > 600) {this.since=null;this.anchor=null;}
    this.last=now;
    if (!pose.valid) {
      this.since=null;this.anchor=null;this.missingSince ??= now;
      if (now-this.missingSince >= 1500) this.step=0;
      return this.state(pose.reason);
    }
    this.missingSince=null;
    if (!pose.centered || !pose.sized || !pose.level) {
      this.since=null;this.anchor=null;
      return this.state(!pose.sized ? pose.height < .30 || pose.width < .20 ? 'closer' : 'farther' : !pose.centered ? 'center' : 'level');
    }
    const stage = GUIDE_STEPS[this.step];
    const aligned = stage==='left' ? pose.yaw >= 18 && pose.yaw <= 45 : stage==='right' ? pose.yaw <= -18 && pose.yaw >= -45 : Math.abs(pose.yaw)<=12;
    if (!aligned) {this.since=null;this.anchor=null;return this.state('turn');}
    if (stage==='steady' && this.anchor && (Math.hypot(pose.x-this.anchor.x,pose.y-this.anchor.y)>.025 || Math.abs(pose.height-this.anchor.height)>.04 || Math.abs(pose.yaw-this.anchor.yaw)>5)) {
      this.since=null;this.anchor=null;
    }
    this.since ??= now; this.anchor ??= pose;
    const hold = stage==='steady' ? 2000 : stage==='front' ? 700 : 600;
    const progress = Math.min(1,(now-this.since)/hold);
    if (progress>=1) {
      if (stage==='steady') return {...this.state('ready'),done:true,progress:1};
      this.step++;this.since=null;this.anchor=null;
      return this.state('turn');
    }
    return {...this.state('hold'),progress};
  }
  state(reason) {return {step:this.step,stage:GUIDE_STEPS[this.step],reason,progress:0,done:false};}
}
