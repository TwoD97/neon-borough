import { skin } from "./theme-tokens.js";
import { cornerFitting } from "./controls.js";
import { div, image } from "gpui-kit";
import { theme } from "herdr";
// Native flexible rails and fixed-size illustrated fittings.
export function panelSkin(content) {
  const frame = div().relative().w_full().min_w(0).min_h(0).p(12)
    // Fill the seam under the rails without painting the outer corner cutouts.
    .child(div().absolute().top(7).bottom(7).left(7).right(7).bg(skin().background))
    .child(content);
  frame.child(div().absolute().left(20).right(20).top(1).h(7).bg(skin().metal).border_t(1).border_color(skin().shine));
  frame.child(div().absolute().left(20).right(20).bottom(1).h(7).bg(skin().metal).border_b(1).border_color(skin().shine));
  frame.child(div().absolute().top(20).bottom(20).left(1).w(7).bg(skin().metal).border_l(1).border_color(skin().shine));
  frame.child(div().absolute().top(20).bottom(20).right(1).w(7).bg(skin().metal).border_r(1).border_color(skin().shine));
  frame.child(div().absolute().left(4).top("30%").h("18%").w(2).bg(skin().accent));
  frame.child(div().absolute().right(4).bottom("18%").h("12%").w(2).bg(skin().secondary));
  frame.child(cornerFitting("tl",28).absolute().top(0).left(0).size(28));
  frame.child(cornerFitting("tr",28).absolute().top(0).right(0).size(28));
  frame.child(cornerFitting("bl",28).absolute().bottom(0).left(0).size(28));
  frame.child(cornerFitting("br",28).absolute().bottom(0).right(0).size(28));
  return frame;
}
