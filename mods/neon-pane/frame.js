import { skin } from "./theme-tokens.js";
import { div, image, svg } from "gpui-kit";

// Square outer geometry matches the native terminal pane; all machining is inset.
export function terminalFrame(content, { pane, status, tone, motion, width, focused }) {
  const working = status === "working";
  const waiting = status === "blocked";
  let signal = div().id(`pane-signal-${pane}-${status || "shell"}-${motion}`)
    .absolute().bottom(1).left(14).h(1).w(working ? 64 : waiting ? 32 : 18)
    .bg(tone).opacity(working || waiting ? 0.8 : 0.4);
  if (motion && working) signal = signal
    .loop("left", { from: 14, to: Math.max(14, width - 88), period: 4200, easing: "ease-in-out" })
    .loop("opacity", { from: 0.35, to: 0.9, period: 2100 });
  if (motion && waiting) signal = signal.loop("opacity", { from: 0.25, to: 0.9, period: 2400 });
  return div().relative().size_full().min_w(0).overflow_hidden().bg(skin().chrome)
    .child(div().absolute().top(0).left(0).right(0).h(3).bg(skin().metal))
    .child(div().absolute().top(3).left(0).right(0).h(1).bg(skin().background))
    .child(div().absolute().top(1).left(18).w(30).h(1).bg(focused ? skin().accent : skin().edge))
    .child(div().absolute().top(1).right(18).w(30).h(1).bg(skin().secondary).opacity(0.65))
    .child(div().absolute().bottom(0).left(0).right(0).h(3).bg(skin().rail))
    .child(div().absolute().bottom(0).left(0).right(0).h(1).bg(skin().edge))
    .child(svg("mods/neon-pane/header-left.svg").text_color(skin().edge).absolute().top(0).left(0).w(12).h(38))
    .child(svg("mods/neon-pane/header-right.svg").text_color(skin().edge).absolute().top(0).right(0).w(12).h(38))
    .child(svg("mods/neon-pane/header-vents.svg").text_color(skin().edge).absolute().top(0).left("46%").w(54).h(6))
    .child(content)
    .child(signal);
}
