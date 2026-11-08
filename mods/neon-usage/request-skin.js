import { div } from "gpui-kit";
import { skin } from "./theme-tokens.js";
import { fitting } from "./fittings.js";

export function requestFrame(el,t=skin()) {
  const colors={face:t.surface,edge:t.edge,rail:t.rail};
  return el.relative().min_w(0)
    .child(div().absolute().left(1).right(1).top(10).bottom(10).bg(t.surface))
    .child(div().absolute().left(10).right(10).top(1).bottom(1).bg(t.surface))
    .child(div().absolute().left(10).right(10).top(0).h(1).bg(t.edge))
    .child(div().absolute().left(10).right(10).top(1).h(2).bg(t.rail))
    .child(div().absolute().left(10).right(10).bottom(0).h(1).bg(t.edge))
    .child(div().absolute().left(10).right(10).bottom(1).h(2).bg(t.rail))
    .child(div().absolute().top(10).bottom(10).left(0).w(1).bg(t.edge))
    .child(div().absolute().top(10).bottom(10).right(0).w(1).bg(t.edge))
    .child(fitting("request-tl",10,10,colors,t).absolute().left(0).top(0))
    .child(fitting("request-tr",10,10,colors,t).absolute().right(0).top(0))
    .child(fitting("request-bl",10,10,colors,t).absolute().left(0).bottom(0))
    .child(fitting("request-br",10,10,colors,t).absolute().right(0).bottom(0))
    .child(div().absolute().left(15).top(2).w(24).h(1).bg(t.warning))
    .child(div().absolute().left(43).top(2).w(4).h(1).bg(t.edge))
    .child(div().absolute().right(15).bottom(2).w(24).h(1).bg(t.accent));
}