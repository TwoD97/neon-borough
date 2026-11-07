import { skin } from "./theme-tokens.js";
import { div, image, svg } from "gpui-kit";

// Decorative rail inside the Agents block. No handlers or layout height are
// introduced, so the native Spaces/Agents resize boundary keeps its hit area.
export function sectionSeparator() {
  return div().absolute().top(0).left(0).right(4).h(7).overflow_hidden()
    .flex().justify_center().items_start()
    .child(div().absolute().top(0).left(12).right(12).h(1).bg(skin().shine))
    .child(div().absolute().top(1).left(12).right(12).h(3).bg(skin().metal))
    .child(div().absolute().top(4).left(12).right(12).h(1).bg(skin().background))
    .child(div().absolute().top(2).left(19).w(18).h(1).bg(skin().accent))
    .child(div().absolute().top(2).right(19).w(12).h(1).bg(skin().secondary))
    .child(svg("mods/my-agents/art/separator-left.svg").text_color(skin().edge).absolute().top(0).left(0).w(12).h(7))
    .child(svg("mods/my-agents/art/separator-right.svg").text_color(skin().edge).absolute().top(0).right(0).w(12).h(7))
    .child(svg("mods/my-agents/art/separator-grip.svg").text_color(skin().edge).w(44).h(7).flex_none());
}
