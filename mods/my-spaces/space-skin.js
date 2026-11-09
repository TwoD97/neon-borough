import {frameAsset} from "./card-state.js";
import { div, image } from "gpui-kit";
import { skin, art, artText } from "./theme-tokens.js";

export function spaceGeometry(width, tree=false, compact=false) {
  const height=compact?(tree?44:48):(tree?64:72), scale=height/(tree?472:470);
  const path=`mods/my-spaces/art/${tree?"worktree":"space"}-frame.png`;
  return {width,height,scale,path,frame:art(path),ink:artText(path),
    x:tree?16:14,y:tree?110:114,visible:tree?2129:2144,
    left:500*scale,right:125*scale,textLeft:510*scale+8,textRight:125*scale+8,
    socketX:((tree?308:252)-(tree?16:14))*scale, socketY:((tree?350:355)-(tree?110:114))*scale};
}

// Crop transparent canvas margins. The socket and end cap retain one uniform
// scale; only the empty middle rail crops or repeats, so resizing never warps the art.
export function spaceFrame(el, active=false, color=skin().accent, width=240, tree=false, compact=false) {
  const g=spaceGeometry(width,tree,compact), s=g.scale, t=skin();
  // The neon channels switch in the art itself; metal and labels retain full opacity.
  const bitmap=(offset,w=2172*s)=>image(frameAsset(g.frame,active)).absolute().top(-g.y*s).left(offset).w(w).h(724*s);
  const centerSource=600*s;
  const centerStart=800*s;
  const centerWidth=Math.max(1,width-g.left-g.right);
  // GPUI images preserve aspect ratio; crop uniformly scaled strips instead
  // of stretching width independently (which would shrink their height).
  const strips=[];
  for(let offset=0;offset<centerWidth;offset+=centerSource){
    const span=Math.min(centerSource,centerWidth-offset);
    // One logical pixel of bleed covers fractional-DPI clip seams; the outer
    // center viewport still clips the final strip to its exact bounds.
    strips.push(div().absolute().left(offset).top(0).w(span+1).h(g.height).overflow_hidden()
      .child(bitmap(-centerStart)));
  }
  return el.relative().min_w(0)
    .child(div().absolute().left(0).top(0).w(g.left).h(g.height).overflow_hidden().child(bitmap(-g.x*s)))
    .child(div().absolute().left(g.left).right(g.right).top(0).h(g.height).overflow_hidden()
      .children(strips))
    .child(div().absolute().right(0).top(0).w(g.right).h(g.height).overflow_hidden()
      .child(bitmap(-(g.x+g.visible-125)*s)));
}
