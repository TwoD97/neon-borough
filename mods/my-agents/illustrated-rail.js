import { div, image } from "gpui-kit";

// Three slices of one uniformly scaled image. The center repeats rather than
// stretching, and all slices are native clips: the illustrated corners and
// screw heads keep their proportions at every sidebar width.
export function illustratedRail(el,path,asset,height) {
  const frame=asset.frame || {x:0,y:0,width:asset.width,height:asset.height};
  const scale=height/frame.height, width=asset.width*scale;
  const left=asset.left*scale,right=asset.right*scale;
  const middle=(asset.tile?.width ?? frame.width-asset.left-asset.right)*scale;
  const middleOffset=(asset.tile?.x ?? frame.x+asset.left)*scale;
  const full=()=>image(path).absolute().top(-frame.y*scale).w(width).h(asset.height*scale);
  const crop=(x,w,offset)=>div().absolute().top(0).left(x).w(w).h(height).overflow_hidden().child(full().left(-offset));
  const center=div().absolute().top(0).left(left).right(right).h(height).overflow_hidden();
  // Sidebar max is480px; leave headroom for standalone previews. Repetition is
  // bounded, static, and does not create any timers or per-frame state writes.
  for(let i=0;i<Math.ceil(640/middle);i++)center.child(crop(i*middle,middle+1,middleOffset));
  return el.relative().min_w(0)
    .child(center)
    .child(crop(0,left+1,frame.x*scale))
    .child(div().absolute().top(0).right(0).w(right+1).h(height).overflow_hidden().child(full().left(-((frame.x+frame.width)*scale-right-1))));
}
