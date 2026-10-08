// Draw in CSS pixels so resizing never distorts the stroke or dash lengths.
export function ovalPath(width,height,inset=5) {
  if(width<=inset*2 || height<=inset*2)return null;
  const x=width/2,y=height/2,rx=x-inset,ry=y-inset;
  return `M ${x} ${inset} A ${rx} ${ry} 0 1 1 ${x} ${height-inset} A ${rx} ${ry} 0 1 1 ${x} ${inset}`;
}
export function ringProgress(value) {
  const progress=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
  return {offset:100*(1-progress),opacity:progress>0?1:0};
}
export class FaceRing {
  constructor(element) {
    this.element=element;
    this.progress=element.querySelector('#guide-ring');
    this.observer=new ResizeObserver(entries=>{
      const {width,height}=entries[0].contentRect,path=ovalPath(width,height);
      if(!path)return;
      element.querySelector('svg').setAttribute('viewBox',`0 0 ${width} ${height}`);
      for(const line of element.querySelectorAll('path'))line.setAttribute('d',path);
    });
    this.observer.observe(element);
    this.update(0);
  }
  update(value) {
    const {offset,opacity}=ringProgress(value);
    this.progress.style.strokeDashoffset=offset;
    this.progress.style.opacity=opacity;
  }
}
