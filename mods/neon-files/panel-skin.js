import { div } from "gpui-kit";
import { skin } from "./theme-tokens.js";
import { fitting, panelBackdrop } from "./fittings.js";

export function panelSkin(content) {
  const t=skin();
  const frame=div().relative().size_full().min_w(0).min_h(0).p(12)
    .child(div().absolute().top(7).bottom(7).left(7).right(7).bg(t.background))
    .child(div().absolute().top(12).bottom(12).left(12).right(12).overflow_hidden().child(panelBackdrop()))
    .child(content.bg("#00000000"));
  frame.child(div().absolute().left(20).right(20).top(1).h(7).bg(t.metal).border_t(1).border_color(t.edge));
  frame.child(div().absolute().left(20).right(20).bottom(1).h(7).bg(t.metal).border_b(1).border_color(t.edge));
  frame.child(div().absolute().top(20).bottom(20).left(1).w(7).bg(t.metal).border_l(1).border_color(t.edge));
  frame.child(div().absolute().top(20).bottom(20).right(1).w(7).bg(t.metal).border_r(1).border_color(t.edge));
  frame.child(div().absolute().left(4).top("30%").h("18%").w(2).bg(t.accent));
  frame.child(div().absolute().right(4).bottom("18%").h("12%").w(2).bg(t.secondary));
  frame.child(fitting("pane-tl",28).absolute().top(0).left(0));
  frame.child(fitting("pane-tr",28).absolute().top(0).right(0));
  frame.child(fitting("pane-bl",28).absolute().bottom(0).left(0));
  frame.child(fitting("pane-br",28).absolute().bottom(0).right(0));
  return frame;
}