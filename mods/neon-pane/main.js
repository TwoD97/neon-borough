import { skin, artText } from "./theme-tokens.js";
// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, home, shared, setShared, settings, openOverlay } from "herdr";
import { bevel, keycap } from "./controls.js";
import { terminalFrame } from "./frame.js";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.width = 220; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    const labels = {"split-right":"Split right", "split-down":"Split down", zoom:"Zoom pane", unzoom:"Restore pane", close:"Close pane"};
    const ink=artText("mods/crew/art/control-keycap.png",t);
    return keycap(div().id(id).size(24).flex_none().flex().items_center().justify_center(),t)
      .text_color(ink.foreground).tooltip(labels[icon] || icon)
      .hover((s) => s.text_color(t.accent))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/neon-pane/${icon}.svg`).size(16));
  }

  render(cx) {
    const t = skin();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 16, t.muted);
    const st = p.status;
    const pane = p.pane;
    const compact = this.width < 440;
    const narrow = this.width < 340;
    const motion = shared("neon.motion") !== false;
    const tone = st === "blocked" ? t.warning : st === "working" ? t.working : st === "done" ? t.done : t.muted;
    const stateName = st === "blocked" ? "Needs you" : st === "working" ? "Working" : st === "done" ? "Done" : st === "idle" ? "Idle" : "Terminal";
    const identity = bevel(h_flex().flex_1().min_w(0).max_w(compact ? 160 : 240).h(24).px(8).gap(8).items_center(),p.focused,t)
      .when(Boolean(pic) && this.width >= 280, el => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().font_medium().text_color(t.foreground).tooltip(name).child(name));
    let status = div().size(4).flex_none().bg(tone);
    if (st === "working") {
      status = svg("mods/crew/icons/spinner.svg").size(12).flex_none().text_color(tone);
      if (motion) status = status.spin(1100);
    } else if (st === "done") status = svg("mods/crew/icons/check.svg").size(12).flex_none().text_color(tone);
    const content = h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(8)
      .gap(8)
      .min_w(0)
      .items_center()
      .text_size(12)
      .on_size_change((size, cx) => { const width = Math.round(size.width / (settings().zoom || 1)); if (width !== this.width) { this.width = width; cx.notify(); } })
      .on_click(() => run("pane.focus", { pane }))
      .child(identity)
      .when(!compact, el => el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).tooltip(folder(p.cwd)).child(folder(p.cwd))))
      .child(h_flex().flex_none().gap(4).items_center().text_size(12).text_color(tone).tooltip(stateName).child(status)
        .when(!compact, el => el.child(stateName)))
      .child(h_flex().flex_none().gap(4).items_center()
        .child(div().id(`ambience-${pane}`).size(24).flex_none().flex().items_center().justify_center().cursor_pointer()
          .text_color(motion ? t.accent : t.muted).hover(s=>s.bg(t.hover).text_color(t.foreground))
          .tooltip(`Status animations ${motion ? "on" : "off"} · Click to ${motion ? "pause" : "enable"}`)
          .on_click((_e,cx)=>{cx.stop_propagation();setShared("neon.motion",shared("neon.motion") === false);})
          .child(svg("mods/crew/icons/spinner.svg").size(16)))
        .when(narrow, el=>el.child(keycap(div().id(`ph-menu-${pane}`).size(24).flex_none().flex().items_center().justify_center(),t)
          .text_color(artText("mods/crew/art/control-keycap.png",t).foreground).tooltip("Pane actions · split right, split down, zoom or close")
          .on_click((_e,cx)=>{cx.stop_propagation();openOverlay({mod:"my-menu",kind:"popup",frame:"none",width:320,height:292,props:{tab:"pane",target:{pane,terminal:p.terminal || props()?.terminal}}});})
          .child(svg("mods/neon-pane/split-right.svg").size(16))))
        .when(!narrow, el=>el.child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
          .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane })))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
    return terminalFrame(content, { pane, status: st, tone, motion, width: this.width, focused: p.focused });
  }
}
