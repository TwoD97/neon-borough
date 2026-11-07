import { div, image } from "gpui-kit";
import { skin, art } from "./theme-tokens.js";
import { fitting } from "./fittings.js";

// Native faces and semantic vector layers share exact seven-pixel chamfers.
export function bevel(el, active = false, t=skin()) {
  const face=active?t.selected:t.raised, edge=active?t.accent:t.edge;
  return el.relative().cursor_pointer()
    .child(div().absolute().left(1).right(1).top(7).bottom(7).bg(face))
    .child(div().absolute().left(7).right(7).top(1).bottom(1).bg(face))
    .child(div().absolute().left(7).right(7).top(0).h(1).bg(edge))
    .child(div().absolute().left(7).right(7).bottom(0).h(1).bg(edge))
    .child(div().absolute().top(7).bottom(7).left(0).w(1).bg(edge))
    .child(div().absolute().top(7).bottom(7).right(0).w(1).bg(edge))
    .child(fitting("control-tl",7,7,{face,edge,accent:t.accent},t).absolute().top(0).left(0))
    .child(fitting("control-tr",7,7,{face,edge,accent:t.accent},t).absolute().top(0).right(0))
    .child(fitting("control-bl",7,7,{face,edge,accent:t.accent},t).absolute().bottom(0).left(0))
    .child(fitting("control-br",7,7,{face,edge,accent:t.accent},t).absolute().bottom(0).right(0))
    .when(active,e=>e.child(div().absolute().bottom(2).left(9).w(16).h(1).bg(t.accent)));
}
export function headerFrame(content,t=skin()) {
  return div().relative().size_full().min_w(0).min_h(0)
    .child(div().absolute().top(0).bottom(0).left(10).right(10).bg(t.chrome))
    .child(div().absolute().top(10).bottom(0).left(0).right(0).bg(t.chrome))
    .child(div().absolute().top(0).left(18).right(18).h(3).bg(t.rail))
    .child(div().absolute().bottom(0).left(18).right(18).h(1).bg(t.edge))
    .child(content)
    .child(fitting("pane-tl",18,18,{},t).absolute().top(0).left(0))
    .child(fitting("pane-tr",18,18,{},t).absolute().top(0).right(0));
}
export function keycap(el,t=skin()) { return bevel(el,false,t); }