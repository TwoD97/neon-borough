import { skin, artText, mix } from "./theme-tokens.js";
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout } from "herdr";
import { bevel, headerFrame, keycap } from "./controls.js";
import { observePaint } from "./theme-observer.js";
import { groupFrame } from "./group-skin.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 180;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

export default class WorkspaceChrome extends View {
  button(id, label, action) {
    const t = skin();
    return keycap(div().id(id).size(26).flex_none().flex().items_center().justify_center()).text_color(artText("mods/crew/art/control-keycap.png").muted).tooltip(id === "search" ? "Search spaces and agents" : "Collapse or expand sidebar").hover(s => s.opacity(0.8).text_color(artText("mods/crew/art/control-keycap.png").foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  render(cx) {
    const t = skin();
    if(!props()?.footer)observePaint(this,cx,t.light);
    const collapsed = narrow();
    const tight = (find(layout(), "sidebar")?.size?.px ?? 320) < 240;
    if (props()?.footer) {
      const row = (id, icon, label, dim, action) => (collapsed ? bevel(h_flex()) : groupFrame(h_flex(),false,t.accent,26,t))
        .id(id).h(26).pl(collapsed ? 6 : 170*26/186-7).pr(collapsed ? 6 : 185*26/186-5.5).gap(14).items_center().cursor_pointer()
        .text_color(dim ? t.muted : t.foreground).hover(s => s.opacity(0.8)).tooltip(label)
        .on_click(action).child(svg(`mods/neon-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().child(label))
          .child(svg("mods/crew/icons/chevron-right.svg").size(11).text_color(t.accent)));
      return v_flex().relative().size_full().bg(skin().chrome).border_t(2).border_color(skin().edge).pl(6).pr(collapsed ? 6 : 10).pt(5).pb(6).gap(4).text_size(12)
        .child(row("settings", "settings", "Settings", false, () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().absolute().top(2).right(5).size(5).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })))
        .child(div().absolute().right(0).top(0).bottom(0).w(4).bg(skin().rail))
        .child(div().absolute().right(1).top(0).bottom(0).w(1).bg(skin().shine));
    }
    const brand = h_flex().size_full().pl(collapsed ? 9 : 12).pr(collapsed ? 9 : 10).gap(5).items_center().text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).gap(tight ? 5 : 8).items_center()
        .child(svg("mods/neon-chrome/herdr-mark.svg").size(tight ? 24 : 31).flex_none().text_color(t.accent))
        .child(v_flex().min_w(0).gap(1)
          .child(div().text_size(tight ? 12 : 14).font_semibold().text_color(t.foreground).child("HERDR"))
          .when(!tight, e => e.child(div().text_size(9).text_color(skin().muted).child("NEON BOROUGH"))))))
      .when(!collapsed && !tight, el => el.child(div().w(1).h(20).mx(5).flex_none().bg(skin().border)))
      .when(!collapsed, el => el.child(this.button("search", svg("mods/neon-chrome/search.svg").size(15), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg("mods/neon-chrome/sidebar.svg").size(15), toggleSidebar)));
    return headerFrame(brand)
      .child(div().absolute().right(0).top(18).bottom(0).w(4).bg(skin().rail))
      .child(div().absolute().right(1).top(18).bottom(0).w(1).bg(skin().shine));
  }
}
