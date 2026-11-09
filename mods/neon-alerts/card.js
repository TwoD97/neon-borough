import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { skin } from "./theme-tokens.js";
import { fitting } from "./fittings.js";

const LEVELS = {
  info: { role: "accent", label: "Notification" },
  success: { role: "done", label: "Completed" },
  warning: { role: "warning", label: "Needs you" },
  error: { role: "danger", label: "Error" },
};

// The native host owns the rounded outer boundary and lifetime. Keep every rail
// inside that curve: no rectangular art spilling beyond rounded corners.
export function notificationCard(p, { activate, dismiss }, palette) {
  const t=skin(palette);
  const level = Object.prototype.hasOwnProperty.call(LEVELS, p.level) ? p.level : "info";
  const tone = {...LEVELS[level],color:t[LEVELS[level].role]};
  const title = String(p.title ?? "Notification");
  const body = String(p.body ?? "");
  return h_flex().id("neon-notification").relative().size_full().min_w(0)
    .rounded(8).overflow_hidden().bg(t.popover)
    .px(14).gap(10).items_center()
    .child(svg("mods/neon-toast/art/frame-face.svg").absolute().inset(3).text_color(t.surface))
    .child(svg("mods/neon-toast/art/frame-edge.svg").absolute().inset(3).text_color(t.edge))
    .child(svg("mods/neon-toast/art/frame-signal.svg").absolute().inset(3).text_color(tone.color))
    .child(div().absolute().left(20).right(42).top(7).h(1).bg(t.rail))
    .child(div().absolute().left(20).top(7).w(38).h(2).bg(tone.color))
    .child(div().absolute().right(22).bottom(7).w(28).h(1).bg(t.secondary))
    .child(h_flex().id("notification-open").flex_1().min_w(0).h_full().gap(11)
      .items_center().cursor_pointer().tooltip([title, body].filter(Boolean).join("\n"))
      .hover(s => s.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); activate(); })
      .child(h_flex().relative().size(32).flex_none().items_center().justify_center()
        .tooltip(tone.label)
        .child(fitting("badge",32,32,{accent:tone.color,face:t.raised,background:t.surface}).absolute())
        .child(p.icon ? image(p.icon).size(18).flex_none()
          : svg(`mods/neon-toast/art/${level}.svg`).size(18).text_color(tone.color)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(8).font_semibold().text_color(tone.color).child(`HERDR / ${tone.label.toUpperCase()}`))
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).truncate().child(title))
        .when(Boolean(body), el => el.child(div().text_size(11).text_color(t.muted).truncate().child(body)))))
    .child(h_flex().id("notification-dismiss").size(22).flex_none().relative()
      .items_center().justify_center()
      .text_color(t.muted).cursor_pointer().tooltip("Dismiss notification")
      .hover(s => s.bg(t.hover).text_color(t.foreground).border_color(t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); dismiss(); })
      .child(fitting("badge",22,22,{accent:tone.color,face:t.raised,background:t.surface}).absolute())
      .child(svg("mods/neon-toast/art/close.svg").size(9)));
}
