import { div, image, svg } from "gpui-kit";
import { skin, art } from "./theme-tokens.js";

function at(el,corner) {
  return corner[0]==="t" ? (corner[1]==="l"?el.top(0).left(0):el.top(0).right(0)) : (corner[1]==="l"?el.bottom(0).left(0):el.bottom(0).right(0));
}
export function bevel(el,active=false,t=skin()) {
  const edge=active?t.accent:t.edge, face=active?t.selected:t.raised;
  el=el.relative().cursor_pointer()
    .child(div().absolute().left(1).right(1).top(7).bottom(7).bg(face))
    .child(div().absolute().left(7).right(7).top(1).bottom(1).bg(face))
    .child(div().absolute().left(7).right(7).top(0).h(1).bg(edge))
    .child(div().absolute().left(7).right(7).bottom(0).h(1).bg(edge))
    .child(div().absolute().top(7).bottom(7).left(0).w(1).bg(edge))
    .child(div().absolute().top(7).bottom(7).right(0).w(1).bg(edge));
  for(const corner of ["tl","tr","bl","br"]) {
    el.child(at(svg(`mods/neon-chrome/theme-control-face-${corner}.svg`).absolute().size(7).text_color(face),corner));
    el.child(at(svg(`mods/neon-chrome/theme-control-edge-${corner}.svg`).absolute().size(7).text_color(edge),corner));
  }
  return el.when(active,e=>e.child(div().absolute().bottom(2).left(9).w(16).h(1).bg(t.accent)));
}
export function cornerFitting(corner,size=28,t=skin()) {
  return div().relative().size(size)
    .child(svg(`mods/neon-chrome/theme-pane-metal-${corner}.svg`).absolute().size_full().text_color(t.metal))
    .child(svg(`mods/neon-chrome/theme-pane-edge-${corner}.svg`).absolute().size_full().text_color(t.shine))
    .child(svg(`mods/neon-chrome/theme-pane-accent-${corner}.svg`).absolute().size_full().text_color(t.accent));
}
export function headerFrame(content,t=skin()) {
  return div().relative().size_full().min_w(0).min_h(0)
    .child(div().absolute().top(0).bottom(0).left(10).right(10).bg(t.chrome))
    .child(div().absolute().top(10).bottom(0).left(0).right(0).bg(t.chrome))
    .child(div().absolute().top(0).left(18).right(18).h(3).bg(t.metal))
    .child(div().absolute().bottom(0).left(0).right(0).h(3).bg(t.rail))
    .child(div().absolute().bottom(0).left(0).right(0).h(1).bg(t.edge))
    .child(div().absolute().bottom(1).left(18).w(32).h(1).bg(t.accent))
    .child(div().absolute().bottom(1).right(18).w(24).h(1).bg(t.secondary))
    .child(content)
    .child(cornerFitting("tl",18,t).absolute().top(0).left(0))
    .child(cornerFitting("tr",18,t).absolute().top(0).right(0));
}
export function keycap(el,t=skin()) {
  return el.relative().cursor_pointer()
    .child(image(art("mods/crew/art/control-keycap.png",t)).absolute().top(0).left(0).size_full());
}
